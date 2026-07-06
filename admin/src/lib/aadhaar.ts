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
// PRIVACY: the full 12-digit Aadhaar number is treated as a transient
// secret. It exists only:
//   1. Inside Vision's OCR text response, in-memory.
//   2. Inside `parseAadhaar()`'s local variables while it extracts fields.
// The public `extractAadhaar()` function returns ONLY the masked form
// (xxxxxxxx1234). We never log, return, or persist the raw number.
//
// Do NOT import this file from client code — it's server-only. Next.js
// will refuse a client build if @/lib/aadhaar is imported into a
// "use client" component. Keep it inside /api/... routes only.

import sharp from "sharp";
import { uploadBuffer } from "@/lib/gcs";
import { visionDocumentText, visionDetectFaceBox } from "@/lib/vision-server";

const AADHAAR_FILE_MAX = 6 * 1024 * 1024;   // safety cap on request bodies
const FACE_PADDING_PCT = 0.15;

// ── Types ────────────────────────────────────────────────────────────

export type AadhaarFields = {
  name:           string | null;
  dob:            string | null;
  gender:         string | null;
  aadhaar_masked: string | null;
  care_of:        string | null;
  address:        string | null;
};

export type FaceCropResult = {
  storage_path: string | null;   // GCS object path of the cropped face, or null if none detected
};

// ── Public API ────────────────────────────────────────────────────────

// Runs DOCUMENT_TEXT_DETECTION against the file and returns parsed
// Aadhaar fields with the number MASKED. Never returns raw OCR text or
// the full number. Callers use the masked field for persistence.
export async function extractAadhaar(
  buffer: Buffer,
  mimeType: string,
): Promise<AadhaarFields> {
  if (buffer.length > AADHAAR_FILE_MAX) {
    throw new Error(`aadhaar_file_too_large_${buffer.length}`);
  }
  const text = await visionDocumentText(buffer, mimeType);
  return parseAadhaar(text);
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
  const aadhaar_masked = maskAadhaar(rawDigits);

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

  // Name: first line that is (a) mostly letters, (b) not a common
  // Aadhaar noise label, (c) appears BEFORE the DOB line if we found one.
  // Falls back to the strongest name-shaped candidate anywhere in the text.
  const noise = /(government|india|unique|identification|aadhaar|male|female|dob|year of birth|address|s\/o|d\/o|c\/o|w\/o|h\/o|पहचान|आधार|भारत|सरकार)/i;
  const nameCandidates = lines.filter((l) => {
    if (l.length < 3 || l.length > 60) return false;
    if (noise.test(l)) return false;
    // Require at least two words made of letters (rules out numbers-only
    // strings and single tokens like "MALE").
    const alphaWords = l.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z.'-]+$/.test(w));
    return alphaWords.length >= 2;
  });
  const name = nameCandidates.length > 0 ? cleanValue(nameCandidates[0]) : null;

  // Address: heuristic — everything between an "Address" label and the
  // next Aadhaar number or PIN code. Aadhaar cards typically print the
  // address across 2-4 lines between these landmarks.
  let address: string | null = null;
  const addrIdx = text.search(/Address\s*[:\-]/i);
  if (addrIdx >= 0) {
    const tail = text.slice(addrIdx).replace(/^Address\s*[:\-]\s*/i, "");
    // Cut at the Aadhaar number, at a stray "VID :" label, or at 500 chars.
    const cutAt = Math.min(
      indexOrEnd(tail, /\b\d{4}\s?\d{4}\s?\d{4}\b/),
      indexOrEnd(tail, /VID\s*[:\-]/i),
      500,
    );
    address = cleanValue(tail.slice(0, cutAt).replace(/\s+/g, " "));
    if (address.length < 8) address = null;
  }

  return {
    name,
    dob,
    gender,
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
