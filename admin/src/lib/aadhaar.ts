// Server-only helpers for Aadhaar KYC extraction.
//
// This module runs inside Next.js API routes (Node runtime) and calls
// the Google Cloud Vision REST API directly — same endpoint + API-key
// auth as the Deno Edge Functions in backend/supabase/functions/extract-*
// (see extract-pan/index.ts for the pattern we mirror here).
//
// Environment:
//   GOOGLE_VISION_API_KEY — required. Same key that powers the Edge
//   Function OCRs; needs to be set on Cloud Run as a plain env var.
//
// AADHAAR NUMBER HANDLING (product decision, 2026-07): the parser
// returns BOTH the full 12-digit number (`aadhaar_number`) and the
// masked form (`aadhaar_masked`, xxxxxxxx####). KYC requires the full
// number; the masked form stays populated for display-facing surfaces.
// epc_applications is admin-only via RLS — the full number is never
// exposed to EPC or borrower accounts. Never log the full number.
//
// Do NOT import this file from client code — it's server-only. Next.js
// will refuse a client build if @/lib/aadhaar is imported into a
// "use client" component. Keep it inside /api/... routes only.

import sharp from "sharp";
import { uploadBuffer } from "@/lib/gcs";
import { visionDocumentText, visionDetectFaceBox } from "@/lib/vision-server";
import { isValidAadhaar, sanitizeIndianAddress } from "@/lib/doc-validation";
import { geminiExtract, type GeminiImage } from "@/lib/gemini-extract";

const AADHAAR_FILE_MAX = 6 * 1024 * 1024;   // safety cap on request bodies
const FACE_PADDING_PCT = 0.15;

// ── Types ────────────────────────────────────────────────────────────

export type AadhaarFields = {
  name:           string | null;
  dob:            string | null;
  gender:         string | null;
  aadhaar_number: string | null;   // full 12 digits — see header note
  aadhaar_masked: string | null;   // xxxxxxxx#### — derived from the full number
  care_of:        string | null;
  address:        string | null;
};

export type FaceCropResult = {
  storage_path: string | null;   // GCS object path of the cropped face, or null if none detected
};

// ── Public API ────────────────────────────────────────────────────────

// Runs DOCUMENT_TEXT_DETECTION against the file and returns parsed
// Aadhaar fields (with the number MASKED) alongside the raw OCR text.
// The raw text is stored server-side under ocr_raw_text so parser
// misses on real documents can be debugged without re-uploading.
//
// PRIVACY: the raw text may contain the unmasked 12-digit Aadhaar
// number. Route callers persist this under an admin-only-RLS column
// on epc_applications. The client-side masked field remains the only
// value the borrower's account ever exposes.
export async function extractAadhaar(
  buffer: Buffer,
  mimeType: string,
): Promise<{ fields: AadhaarFields; raw_text: string }> {
  if (buffer.length > AADHAAR_FILE_MAX) {
    throw new Error(`aadhaar_file_too_large_${buffer.length}`);
  }
  const text = await visionDocumentText(buffer, mimeType);
  return { fields: parseAadhaar(text), raw_text: text };
}

// ── Gemini (AI) extraction — the faithful primary reader ─────────────────────
// Sends BOTH Aadhaar sides to Gemini with a strict "copy only what's printed,
// else null" prompt. Returns validated fields, or null on any failure (caller
// then falls back to the Vision+regex parseAadhaar above). Applies the same
// Verhoeff / gender normalisation so the output stays trustworthy.
const AADHAAR_SCHEMA = {
  type: "OBJECT",
  properties: {
    name:           { type: "STRING", nullable: true },
    dob:            { type: "STRING", nullable: true },
    gender:         { type: "STRING", nullable: true },
    aadhaar_number: { type: "STRING", nullable: true },
    care_of:        { type: "STRING", nullable: true },
    address:        { type: "STRING", nullable: true },
  },
};
const AADHAAR_PROMPT =
  "You are reading an Indian Aadhaar card (front and/or back images). Extract ONLY values literally printed and legible on the card. If a field is not clearly present, return null — never guess, infer, or invent, and never return a phone-camera watermark, app name, or 'Government of India' as the name. " +
  "name = the person's full name. aadhaar_number = the 12-digit number. dob = date of birth exactly as printed. gender = Male, Female, or Transgender. care_of = the S/O, D/O, W/O or C/O name. address = the full postal address exactly as printed in English, ending with the 6-digit PIN code.";

function normalizeGender(g: string | null | undefined): string | null {
  if (!g) return null;
  const s = g.toLowerCase();
  if (s.includes("female") || s.includes("महिला")) return "Female";
  if (s.includes("male") || s.includes("पुरुष")) return "Male";
  if (s.includes("trans")) return "Transgender";
  return null;
}

export async function geminiExtractAadhaar(images: GeminiImage[]): Promise<AadhaarFields | null> {
  const g = await geminiExtract<Partial<AadhaarFields>>({
    images, prompt: AADHAAR_PROMPT, schema: AADHAAR_SCHEMA, label: "aadhaar",
  });
  if (!g) return null;
  const digits = (g.aadhaar_number || "").replace(/\D/g, "");
  const validNum = digits.length === 12 && isValidAadhaar(digits) ? digits : null;
  const fields: AadhaarFields = {
    name:           g.name?.trim() || null,
    dob:            g.dob?.trim() || null,
    gender:         normalizeGender(g.gender),
    aadhaar_number: validNum,
    aadhaar_masked: validNum ? maskAadhaar(validNum) : null,
    care_of:        g.care_of?.trim() || null,
    address:        g.address?.trim() || null, // Gemini output is faithful — trust it
  };
  // Consider it a real result only if it got at least a name or a valid number.
  return fields.name || fields.aadhaar_number ? fields : null;
}

// Attempts to detect a face on the FRONT-side buffer and, if one is
// found, crops it (with padding) and uploads to GCS. Returns the
// storage path or null.
//
// Skipped entirely for PDFs — Vision's face detection works on images,
// and we don't want a PDF rasterization dependency (poppler etc).
export async function cropAndUploadFace(
  buffer: Buffer,
  mimeType: string,
  applicationId: string,
): Promise<FaceCropResult> {
  if (!mimeType.startsWith("image/")) {
    return { storage_path: null };
  }
  const box = await visionDetectFaceBox(buffer);
  if (!box) return { storage_path: null };

  // Rotate first (EXIF-normalize) so our extract coordinates match the
  // orientation Vision saw.
  const normalized = await sharp(buffer).rotate().toBuffer();
  const meta = await sharp(normalized).metadata();
  const W = meta.width  ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return { storage_path: null };

  const padX = Math.round((box.width  ?? 0) * FACE_PADDING_PCT);
  const padY = Math.round((box.height ?? 0) * FACE_PADDING_PCT);
  const left   = Math.max(0, box.left  - padX);
  const top    = Math.max(0, box.top   - padY);
  const width  = Math.min(W - left, (box.width  ?? 0) + 2 * padX);
  const height = Math.min(H - top,  (box.height ?? 0) + 2 * padY);
  if (width <= 0 || height <= 0) return { storage_path: null };

  const cropped = await sharp(normalized)
    .extract({ left, top, width, height })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  const path = `applications/${applicationId}/aadhaar_face/${Date.now()}.jpg`;
  await uploadBuffer(path, cropped, "image/jpeg");
  return { storage_path: path };
}

// Mask helper exposed for the route to use on raw candidate strings.
// Example: mask("123456789012") -> "xxxxxxxx9012".
export function maskAadhaar(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 12) return null;
  return "xxxxxxxx" + digits.slice(-4);
}

// ── Internals — Aadhaar text parser ──────────────────────────────────

// Best-effort parser tuned to standard Indian Aadhaar cards. Not a
// certified extractor — the returned fields are shown back to the admin
// for verification before persistence.
export function parseAadhaar(text: string): AadhaarFields {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 12-digit Aadhaar number (usually printed as 3 groups of 4).
  const numberMatch = text.match(/\b(\d{4})\s?(\d{4})\s?(\d{4})\b/);
  const rawDigits   = numberMatch ? (numberMatch[1] + numberMatch[2] + numberMatch[3]) : null;
  // Only accept a number that passes the Aadhaar Verhoeff check-digit. A
  // mis-read (any wrong digit) fails it, so it's rejected rather than shown as
  // a real number the admin might trust.
  const aadhaar_number = rawDigits && isValidAadhaar(rawDigits) ? rawDigits : null;
  const aadhaar_masked = aadhaar_number ? maskAadhaar(aadhaar_number) : null;

  // DOB: prefer explicit "DOB" label. Fall back to "Year of Birth".
  const dobLabelMatch =
    text.match(/DOB\s*[:\-]?\s*([0-3]?\d[\/\-.][0-1]?\d[\/\-.]\d{2,4})/i) ||
    text.match(/Date\s*of\s*Birth\s*[:\-]?\s*([0-3]?\d[\/\-.][0-1]?\d[\/\-.]\d{2,4})/i);
  const yobMatch = text.match(/Year\s*of\s*Birth\s*[:\-]?\s*(\d{4})/i);
  const dob = dobLabelMatch ? dobLabelMatch[1] : yobMatch ? yobMatch[1] : null;

  // Gender
  let gender: string | null = null;
  if (/\b(male|पुरुष)\b/i.test(text) && !/\bfemale\b/i.test(text)) gender = "Male";
  else if (/\b(female|महिला)\b/i.test(text)) gender = "Female";
  else if (/\btransgender\b/i.test(text)) gender = "Transgender";

  // Care of — S/O, D/O, C/O, W/O, H/O
  const coMatch = text.match(/(?:S|D|C|W|H)\s*[\/\\.]\s*O\s*[:\-]?\s*([A-Za-z][A-Za-z\s.]{1,80})/i);
  const care_of = coMatch ? cleanValue(coMatch[1]) : null;

  // Name: a 2–4 word all-letters line that isn't an Aadhaar label OR a
  // phone-camera watermark ("Powered by … Camera", "Shot on …", brand names),
  // which OCR otherwise picks up as the name. Preference goes to a candidate
  // that sits ABOVE the identity block (DOB / gender / number) — the real name
  // is printed there, while watermarks sit at the photo's edge.
  const noise = /(government|india|unique|identification|authority|aadhaar|male|female|\bdob\b|year of birth|address|s\/o|d\/o|c\/o|w\/o|h\/o|powered\s*by|\bcamera\b|shot\s*on|redmi|vivo|\boppo\b|samsung|oneplus|realme|\bpoco\b|iphone|huawei|xiaomi|motorola|\bmobile\b|\bvid\b|enrol|download|पहचान|आधार|भारत|सरकार)/i;
  const isNameLine = (l: string): boolean => {
    if (l.length < 3 || l.length > 40) return false;
    if (noise.test(l)) return false;
    if (/\d/.test(l)) return false;                 // names carry no digits
    const words = l.split(/\s+/);
    if (words.length < 2 || words.length > 4) return false;
    return words.every((w) => /^[A-Za-z][A-Za-z.'-]+$/.test(w)); // every word is a word
  };
  const nameCandidates = lines.filter(isNameLine);
  // Index where the identity block begins (DOB / gender / 12-digit number).
  const idIdx = lines.findIndex(
    (l) => /\b(DOB|Date of Birth|Year of Birth)\b/i.test(l) ||
           /\b\d{4}\s?\d{4}\s?\d{4}\b/.test(l) ||
           /\b(male|female|पुरुष|महिला)\b/i.test(l),
  );
  const above = idIdx >= 0 ? nameCandidates.filter((c) => lines.indexOf(c) < idIdx) : [];
  const picked = above.length > 0 ? above[above.length - 1] : (nameCandidates[0] ?? null);
  const name = picked ? cleanValue(picked) : null;

  // Address: heuristic — everything between an "Address" label and the
  // address end. An Indian address ENDS at its 6-digit PIN code, so we cut
  // right AFTER the first pincode (keeping it). This drops the card-footer
  // artifacts that OCR otherwise appends past the address — the "Download
  // Date", the UIDAI helpline "1947", "help@uidai", "www.uidai", "VID", etc.
  // (see the Tonk / 304001 sample). A footer-token strip is applied as a
  // belt-and-suspenders pass for cards where no pincode is detected.
  let address: string | null = null;
  const addrIdx = text.search(/Address\s*[:\-]/i);
  if (addrIdx >= 0) {
    const tail = text.slice(addrIdx).replace(/^Address\s*[:\-]\s*/i, "");
    // First 6-digit PIN code → keep the pincode, drop everything after it.
    const pinM = tail.match(/\b\d{6}\b/);
    const pinCut = pinM ? (pinM.index as number) + pinM[0].length : tail.length;
    // Cut at the earliest of: pincode-end, the Aadhaar number, a "VID:" label,
    // or 500 chars.
    const cutAt = Math.min(
      pinCut,
      indexOrEnd(tail, /\b\d{4}\s?\d{4}\s?\d{4}\b/),
      indexOrEnd(tail, /VID\s*[:\-]/i),
      500,
    );
    // Strip any residual footer tokens (only bites when no pincode was found).
    const stripped = tail
      .slice(0, cutAt)
      .replace(/\b(?:Download\s*Da[lt]e|help@uidai|www\.uidai|\bVID\b|\b1947\b)\b.*/is, "");
    // Sanity-gate the result: keep only the English portion, and require it to
    // look like a real Indian address (contains a PIN code). If it doesn't,
    // return null instead of the random words OCR sometimes leaves here.
    address = sanitizeIndianAddress(cleanValue(stripped.replace(/\s+/g, " ")));
  }

  return {
    name,
    dob,
    gender,
    aadhaar_number,
    aadhaar_masked,
    care_of,
    address,
  };
}

function cleanValue(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/[,.;:]+$/, "");
}

function indexOrEnd(haystack: string, needle: RegExp): number {
  const i = haystack.search(needle);
  return i < 0 ? haystack.length : i;
}
