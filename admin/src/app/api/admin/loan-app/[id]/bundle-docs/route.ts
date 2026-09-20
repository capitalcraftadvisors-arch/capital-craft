// POST  /api/admin/loan-app/[id]/bundle-docs   — bulk document upload + auto-split
// PATCH /api/admin/loan-app/[id]/bundle-docs   — reclassify one already-split doc
//
// The loan intake chatbot lets the RM drop ONE combined PDF (PAN, Aadhaar
// front/back, e-bill, bank statement, rooftop photo — and optionally the
// co-applicant's PAN/Aadhaar) OR several separate files at once. This route
// classifies each document, splits a combined PDF into clean per-document
// files, stores every split under the SAME GCS folder + epc_applications
// `_path` column + user_application_docs row the corresponding per-doc route
// already uses, and extracts all fields in one pass.
//
// The quotation / proforma invoice is intentionally NOT handled here — Gemini
// tags it "other" and we skip it; it stays its own separate step, unchanged.
//
// Storage/column parity (MUST match the per-doc routes):
//   applicant_pan            → GCS applications/{id}/borrower_pan  + user_application_docs(borrower_pan) + borrower_pan (no path col)
//   applicant_aadhaar_front  → GCS applications/{id}/aadhaar_front + aadhaar_front_path (+ aadhaar_face_path)
//   applicant_aadhaar_back   → GCS applications/{id}/aadhaar_back  + aadhaar_back_path
//   ebill                    → GCS applications/{id}/loan_docs/ebill + ebill_path
//   bank_statement           → GCS applications/{id}/bank_statement  + bank_statement_path
//   rooftop_photo            → GCS applications/{id}/borrower_photo   + user_application_docs(borrower_photo) + rooftop_photo_path
//   applicant_photo          → GCS applications/{id}/customer_photo   + user_application_docs(customer_photo) + customer_photo_path
//   coapp_pan                → GCS applications/{id}/coapp_pan   + coapp_pan_path
//   coapp_aadhaar_front      → GCS applications/{id}/aadhaar_front + coapp_aadhaar_front_path (+ coapp_aadhaar_face_path)
//   coapp_aadhaar_back       → GCS applications/{id}/aadhaar_back  + coapp_aadhaar_back_path
//
// ROBUSTNESS: any per-file failure is skipped (reported in `skipped`), never a
// 500 for the whole request — the chat falls back to the one-by-one turns.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer, getSignedReadUrl, downloadBuffer } from "@/lib/gcs";
import { geminiExtract } from "@/lib/gemini-extract";
import { geminiExtractPan, geminiExtractBankStatement, geminiExtractEbill } from "@/lib/doc-extractors";
import { geminiExtractAadhaar, cropAndUploadFace, maskAadhaar } from "@/lib/aadhaar";
import { isValidPan, isValidIfsc, isValidAadhaar } from "@/lib/doc-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DIMENSION = 1100; // smaller image → far faster Gemini read (fewer vision tiles); still readable for KYC
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function safeName(fileName: string, fallback: string): string {
  return (fileName || fallback).replace(/[^\w.\-]+/g, "_").slice(0, 80) || fallback;
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ── Document types + filing metadata ─────────────────────────────────────────
type DocType =
  | "applicant_pan" | "applicant_aadhaar_front" | "applicant_aadhaar_back"
  | "ebill" | "bank_statement" | "rooftop_photo" | "applicant_photo"
  | "coapp_pan" | "coapp_aadhaar_front" | "coapp_aadhaar_back" | "other";

type Filing = {
  folder: string;             // GCS subfolder under applications/{id}/
  pathCol?: string;           // epc_applications `_path` column to point at the file
  uploadedAtCol?: string;     // matching `_uploaded_at` column, set to now()
  docRowCategory?: string;    // user_application_docs category to register (openDoc viewer)
  replaceDocRow?: boolean;    // delete existing rows of that category first (PAN parity)
};

const FILING: Record<Exclude<DocType, "other">, Filing> = {
  applicant_pan:           { folder: "borrower_pan",  docRowCategory: "borrower_pan", replaceDocRow: true },
  applicant_aadhaar_front: { folder: "aadhaar_front", pathCol: "aadhaar_front_path" },
  applicant_aadhaar_back:  { folder: "aadhaar_back",  pathCol: "aadhaar_back_path" },
  ebill:                   { folder: "loan_docs/ebill", pathCol: "ebill_path", uploadedAtCol: "ebill_uploaded_at" },
  bank_statement:          { folder: "bank_statement",  pathCol: "bank_statement_path", uploadedAtCol: "bank_statement_uploaded_at" },
  rooftop_photo:           { folder: "borrower_photo",  pathCol: "rooftop_photo_path", uploadedAtCol: "rooftop_photo_uploaded_at", docRowCategory: "borrower_photo", replaceDocRow: true },
  applicant_photo:         { folder: "customer_photo",  pathCol: "customer_photo_path", docRowCategory: "customer_photo", replaceDocRow: true },
  coapp_pan:               { folder: "coapp_pan",   pathCol: "coapp_pan_path" },
  coapp_aadhaar_front:     { folder: "aadhaar_front", pathCol: "coapp_aadhaar_front_path" },
  coapp_aadhaar_back:      { folder: "aadhaar_back",  pathCol: "coapp_aadhaar_back_path" },
};
const ALLOWED_TYPES = new Set<DocType>([...Object.keys(FILING) as DocType[], "other"]);

// A per-type normalized field bag (subset filled per type).
type Normalized = {
  pan?: string | null; name?: string | null; father_name?: string | null; dob?: string | null;
  aadhaar_number?: string | null; gender?: string | null; care_of?: string | null; address?: string | null;
  monthly_bill_amount?: number | null; discom_name?: string | null; ca_number?: string | null;
  ebill_address_line?: string | null; ebill_name?: string | null;
  account_holder?: string | null; bank_name?: string | null; account_no?: string | null;
  ifsc?: string | null; account_type?: string | null; mobile?: string | null; email?: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) { const n = Number(v.replace(/[,₹\s]/g, "")); return isFinite(n) ? n : null; }
  return null;
};

// Validate + normalize the raw fields Gemini returned for one document.
function normalizeFields(type: DocType, raw: Record<string, unknown>): Normalized {
  const panRaw = (str(raw.pan) || "").toUpperCase().replace(/\s/g, "");
  const ifscRaw = (str(raw.ifsc) || "").toUpperCase().replace(/\s/g, "");
  const aadhaarDigits = (str(raw.aadhaar_number) || "").replace(/\D/g, "");
  return {
    pan: isValidPan(panRaw) ? panRaw : null,
    name: str(raw.name),
    father_name: str(raw.father_name),
    dob: str(raw.dob),
    aadhaar_number: aadhaarDigits.length === 12 && isValidAadhaar(aadhaarDigits) ? aadhaarDigits : null,
    gender: normGender(str(raw.gender)),
    care_of: str(raw.care_of),
    address: str(raw.address),
    monthly_bill_amount: num(raw.monthly_bill_amount),
    discom_name: str(raw.discom_name),
    ca_number: str(raw.ca_number),
    ebill_address_line: str(raw.ebill_address_line),
    ebill_name: str(raw.ebill_name),
    account_holder: str(raw.account_holder),
    bank_name: str(raw.bank_name),
    account_no: (str(raw.account_no) || "").replace(/\s/g, "") || null,
    ifsc: isValidIfsc(ifscRaw) ? ifscRaw : null,
    account_type: str(raw.account_type),
    mobile: (() => { const m = (str(raw.mobile) || "").replace(/\D/g, ""); return m.length >= 10 ? m.slice(-10) : null; })(),
    email: str(raw.email),
  };
}
function normGender(g: string | null): string | null {
  if (!g) return null;
  const s = g.toLowerCase();
  if (s.includes("female") || s.includes("महिला")) return "Female";
  if (s.includes("male") || s.includes("पुरुष")) return "Male";
  if (s.includes("trans")) return "Transgender";
  return null;
}

// The epc_applications columns a type writes (so reclassify can clear the old
// type's data). *_uploaded_at / *_path are added by the caller from FILING.
const TYPE_FIELD_COLS: Record<Exclude<DocType, "other">, string[]> = {
  applicant_pan: ["borrower_pan", "borrower_father_name"],
  applicant_aadhaar_front: ["aadhaar_number", "aadhaar_name", "aadhaar_gender", "aadhaar_dob", "aadhaar_face_path"],
  applicant_aadhaar_back: ["aadhaar_care_of", "aadhaar_address"],
  ebill: ["monthly_bill_amount", "discom_name", "ca_number", "ebill_address_line", "ebill_name"],
  bank_statement: ["bank_statement_method", "bank_account_holder", "bank_name", "bank_account_no", "bank_ifsc", "bank_account_type", "bank_mobile", "bank_email"],
  rooftop_photo: [],
  applicant_photo: [],
  coapp_pan: ["coapp_pan", "coapp_name", "coapp_father_name", "coapp_dob"],
  coapp_aadhaar_front: ["coapp_aadhaar_number", "coapp_aadhaar_name", "coapp_aadhaar_gender", "coapp_aadhaar_dob", "coapp_aadhaar_face_path"],
  coapp_aadhaar_back: ["coapp_aadhaar_care_of", "coapp_aadhaar_address"],
};

// Write one detected/reclassified document into the epc_applications patch
// (db, real types + only non-empty) and the chat form patch (all strings, the
// same keys mapExtract in intake/page.tsx produces). `facePath` is passed in
// for aadhaar fronts (cropped separately). Returns a one-line summary.
function applyDoc(
  type: DocType, storagePath: string, f: Normalized,
  db: Record<string, unknown>, form: Record<string, string>,
  facePath: string | null,
): string {
  const setDb = (k: string, v: unknown) => { if (v !== null && v !== undefined && v !== "") db[k] = v; };
  const nowIso = new Date().toISOString();
  const filing = type === "other" ? null : FILING[type];
  if (filing?.pathCol) { setDb(filing.pathCol, storagePath); form[filing.pathCol] = storagePath; }
  if (filing?.uploadedAtCol) { setDb(filing.uploadedAtCol, nowIso); form[filing.uploadedAtCol] = nowIso; }

  switch (type) {
    case "applicant_pan": {
      setDb("borrower_pan", f.pan); if (f.pan) form.borrower_pan = f.pan;
      if (f.name) { form._pan_name = f.name; form.borrower_name = f.name; setDb("borrower_name", f.name); }
      if (f.father_name) { setDb("borrower_father_name", f.father_name); form.borrower_father_name = f.father_name; }
      if (f.dob) form.borrower_dob = f.dob; // DOB flows to DB via the client's coerced update-fields path
      return `PAN ${f.pan || "—"}${f.name ? " · " + f.name : ""}`;
    }
    case "applicant_aadhaar_front": {
      const numOut = f.aadhaar_number ?? maskAadhaar(f.aadhaar_number ?? "");
      if (numOut) { setDb("aadhaar_number", numOut); form.aadhaar_number = numOut; }
      if (f.name) { setDb("aadhaar_name", f.name); form.aadhaar_name = f.name; form.borrower_name = f.name; setDb("borrower_name", f.name); }
      if (f.gender) { setDb("aadhaar_gender", f.gender); form.aadhaar_gender = f.gender; }
      if (f.dob) { form.aadhaar_dob = f.dob; form.borrower_dob = f.dob; }
      if (facePath) { setDb("aadhaar_face_path", facePath); form.aadhaar_face_path = facePath; }
      return `Aadhaar ${numOut || "—"}${f.name ? " · " + f.name : ""}`;
    }
    case "applicant_aadhaar_back": {
      if (f.care_of) { setDb("aadhaar_care_of", f.care_of); form.aadhaar_care_of = f.care_of; }
      if (f.address) { setDb("aadhaar_address", f.address); form.aadhaar_address = f.address; }
      return `Aadhaar back${f.address ? " · " + f.address.slice(0, 40) : ""}`;
    }
    case "ebill": {
      setDb("monthly_bill_amount", f.monthly_bill_amount);
      if (f.monthly_bill_amount != null) form.monthly_bill_amount = String(f.monthly_bill_amount);
      if (f.discom_name) { setDb("discom_name", f.discom_name); form.discom_name = f.discom_name; }
      if (f.ca_number) { setDb("ca_number", f.ca_number); form.ca_number = f.ca_number; }
      if (f.ebill_address_line) { setDb("ebill_address_line", f.ebill_address_line); form.ebill_address_line = f.ebill_address_line; }
      if (f.ebill_name) { setDb("ebill_name", f.ebill_name); form.ebill_name = f.ebill_name; }
      return `E-bill${f.monthly_bill_amount != null ? " ₹" + f.monthly_bill_amount : ""}${f.discom_name ? " · " + f.discom_name : ""}`;
    }
    case "bank_statement": {
      setDb("bank_statement_method", "manual_epdf"); form.bank_statement_method = "manual_epdf";
      if (f.account_holder) { setDb("bank_account_holder", f.account_holder); form.bank_account_holder = f.account_holder; }
      if (f.bank_name) { setDb("bank_name", f.bank_name); form.bank_name = f.bank_name; }
      if (f.account_no) { setDb("bank_account_no", f.account_no); form.bank_account_no = f.account_no; }
      if (f.ifsc) { setDb("bank_ifsc", f.ifsc); form.bank_ifsc = f.ifsc; }
      if (f.account_type) { setDb("bank_account_type", f.account_type); form.bank_account_type = f.account_type; }
      if (f.mobile) { setDb("bank_mobile", f.mobile); form.bank_mobile = f.mobile; }
      if (f.email) { setDb("bank_email", f.email); form.bank_email = f.email; }
      return `Bank ${f.bank_name || "—"}${f.account_no ? " · A/C " + f.account_no : ""}`;
    }
    case "rooftop_photo": return "Rooftop photo";
    case "applicant_photo": return "Applicant photo";
    case "coapp_pan": {
      if (f.pan) { setDb("coapp_pan", f.pan); form.coapp_pan = f.pan; }
      if (f.name) { setDb("coapp_name", f.name); form.coapp_name = f.name; }
      if (f.father_name) { setDb("coapp_father_name", f.father_name); form.coapp_father_name = f.father_name; }
      if (f.dob) form.coapp_dob = f.dob;
      form._has_coapp = "1";
      return `Co-app PAN ${f.pan || "—"}${f.name ? " · " + f.name : ""}`;
    }
    case "coapp_aadhaar_front": {
      const numOut = f.aadhaar_number ?? maskAadhaar(f.aadhaar_number ?? "");
      if (numOut) { setDb("coapp_aadhaar_number", numOut); form.coapp_aadhaar_number = numOut; }
      if (f.name) { setDb("coapp_aadhaar_name", f.name); form.coapp_aadhaar_name = f.name; setDb("coapp_name", f.name); form.coapp_name = f.name; }
      if (f.gender) { setDb("coapp_aadhaar_gender", f.gender); form.coapp_aadhaar_gender = f.gender; }
      if (f.dob) { form.coapp_aadhaar_dob = f.dob; form.coapp_dob = f.dob; }
      if (facePath) { setDb("coapp_aadhaar_face_path", facePath); form.coapp_aadhaar_face_path = facePath; }
      form._has_coapp = "1";
      return `Co-app Aadhaar ${numOut || "—"}${f.name ? " · " + f.name : ""}`;
    }
    case "coapp_aadhaar_back": {
      if (f.care_of) { setDb("coapp_aadhaar_care_of", f.care_of); form.coapp_aadhaar_care_of = f.care_of; }
      if (f.address) { setDb("coapp_aadhaar_address", f.address); form.coapp_aadhaar_address = f.address; }
      form._has_coapp = "1";
      return `Co-app Aadhaar back${f.address ? " · " + f.address.slice(0, 40) : ""}`;
    }
    default: return "Other document";
  }
}

// Register (or replace) a user_application_docs row for the doc-row-backed
// categories (borrower_pan / customer_photo / borrower_photo), exactly as the
// per-doc routes do. Best-effort — a row failure never fails the upload.
async function registerDocRow(
  supabase: SupabaseClient, appId: string, filing: Filing,
  storagePath: string, fileName: string, mime: string,
) {
  if (!filing.docRowCategory) return;
  try {
    if (filing.replaceDocRow) {
      await supabase.from("user_application_docs").delete().eq("application_id", appId).eq("category", filing.docRowCategory);
    }
    const { error } = await supabase.from("user_application_docs").insert({
      application_id: appId, category: filing.docRowCategory, storage_path: storagePath,
      file_name: fileName, mime_type: mime, uploaded_by: "admin",
    });
    if (error) console.warn("[bundle-docs] doc row insert:", filing.docRowCategory, error.message);
  } catch (e) {
    console.warn("[bundle-docs] doc row error:", (e as Error)?.message);
  }
}

// Compress an image the same way /api/upload + the extract routes do. PDFs
// pass through untouched.
async function compressImage(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true }).toBuffer();
}

// ── Combined classify + extract schema/prompt (ONE call per file) ────────────
const STR = { type: "STRING", nullable: true } as const;
const NUM = { type: "NUMBER", nullable: true } as const;
const BUNDLE_SCHEMA = {
  type: "OBJECT",
  properties: {
    documents: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          source_index: NUM, type: STR, page_start: NUM, page_end: NUM,
          // PAN
          pan: STR, father_name: STR,
          // shared (PAN + Aadhaar)
          name: STR, dob: STR,
          // Aadhaar
          aadhaar_number: STR, gender: STR, care_of: STR, address: STR,
          // e-bill
          monthly_bill_amount: NUM, discom_name: STR, ca_number: STR, pincode: STR, ebill_address_line: STR, ebill_name: STR,
          // bank
          account_holder: STR, bank_name: STR, account_no: STR, ifsc: STR, account_type: STR, mobile: STR, email: STR,
        },
      },
    },
  },
};
const BUNDLE_PROMPT =
  "You are given one or more document files, numbered from 0 in the order provided. Read ALL of the files in this request. For EVERY distinct Indian KYC / loan document you find across all files, add one entry to the `documents` array — do not skip any file. " +
  "For each entry set: source_index = the 0-based number of the FILE the document came from; page_start and page_end = the 1-indexed page range within THAT file (use 1 and 1 for a single-page image); type = EXACTLY one of: applicant_pan, applicant_aadhaar_front, applicant_aadhaar_back, ebill, bank_statement, rooftop_photo, applicant_photo, coapp_pan, coapp_aadhaar_front, coapp_aadhaar_back, other; and the fields for that type. " +
  "Most files contain exactly one document (one entry). A single file (e.g. a combined PDF) may contain several — then return one entry per document, all with that file's source_index. " +
  "Extract ONLY what is literally printed; if a field is absent, return null — never guess or invent. Fields per type: " +
  "PAN card (applicant_pan / coapp_pan): pan = 10-char PAN, name = cardholder name, father_name, dob. " +
  "Aadhaar (applicant_aadhaar_front / applicant_aadhaar_back / coapp_aadhaar_front / coapp_aadhaar_back): the FRONT carries name, aadhaar_number (12 digits), dob, gender (Male/Female/Transgender); the BACK carries care_of (S/O, D/O, W/O, C/O) and address (full, ending with the 6-digit PIN). Return the front and back as SEPARATE documents when both are present. " +
  "Electricity bill (ebill): monthly_bill_amount (plain number), discom_name, ca_number (consumer/CA/account number), pincode, ebill_address_line, ebill_name (name the bill is in). " +
  "Bank statement / passbook / cancelled cheque (bank_statement): account_holder, bank_name, account_no, ifsc (11-char), account_type (Savings/Current), mobile, email. " +
  "A rooftop or solar-site photograph is rooftop_photo. A person's passport-style face photo is applicant_photo. " +
  "A quotation / proforma invoice / cost estimate is 'other' (it is handled separately). Classify anything you cannot place as 'other'. " +
  "The first PAN/Aadhaar person is the applicant; a clearly second person's PAN/Aadhaar is the co-applicant (coapp_*).";

type RawDoc = Record<string, unknown> & { type?: string; page_start?: number; page_end?: number; source_index?: number };

// ── Name-based applicant / co-applicant assignment ───────────────────────────
// Normalize a person's name for fuzzy matching: lowercase, strip honorifics,
// drop punctuation, collapse whitespace.
function normPersonName(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).toLowerCase()
    .replace(/\b(m\/s|mr|mrs|ms|smt|shri|sri|kumari|km|dr|late)\.?\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}
// Rough similarity between two NORMALIZED names. Higher = closer; <=0 means "no
// meaningful signal" so the caller keeps Gemini's own applicant/co-app guess.
function nameMatchScore(a: string, b: string): number {
  if (!a || !b) return -1;
  if (a === b) return 100;
  const ta = a.split(" ").filter(Boolean);
  const tb = b.split(" ").filter(Boolean);
  const setA = new Set(ta);
  let shared = 0; for (const t of tb) if (setA.has(t)) shared++;
  if (shared > 0) return 40 + shared * 10 + (ta[0] && ta[0] === tb[0] ? 15 : 0);
  if (a.includes(b) || b.includes(a)) return 30;
  return -1;
}
// Whether a doc carries a name we can match on (PAN / Aadhaar front).
function isNameBearing(type: DocType): boolean {
  return type === "applicant_pan" || type === "coapp_pan"
    || type === "applicant_aadhaar_front" || type === "coapp_aadhaar_front";
}
// A short confidence label for the client review (matched by name vs. Gemini's guess).
function nameConfidence(type: DocType, name: string | null, appName: string, coName: string): string | null {
  if (!isNameBearing(type)) return null;
  if (!name) return "unnamed";
  if (!appName && !coName) return "gemini";
  const n = normPersonName(name);
  const sa = appName ? nameMatchScore(n, appName) : -1;
  const sc = coName ? nameMatchScore(n, coName) : -1;
  return (sa > 0 || sc > 0) ? "name_matched" : "gemini";
}

// One classified-but-not-yet-stored document, held so we can reassign the
// person (applicant vs co-applicant) by name BEFORE choosing the GCS folder.
type Pending = {
  file: File; isPdf: boolean; srcPdf: PDFDocument | null; pageCount: number;
  scanBuffer: Buffer; scanMime: string;
  raw: RawDoc; type: Exclude<DocType, "other">; fields: Normalized;
};

// Run an async map with a concurrency cap — files/docs process in parallel (so
// N separate files no longer read one-after-another and stack up to minutes),
// but never more than `limit` at once (keeps Gemini/GCS from being hammered).
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, worker));
  return results;
}

// ── POST — classify, split, store, extract ───────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return err("At least one file is required.", 400);
    // Optional applicant / co-applicant names → drive per-person assignment below.
    const rawAppName = form.get("applicant_name");
    const rawCoName = form.get("coapp_name");
    const appName = normPersonName(typeof rawAppName === "string" ? rawAppName : "");
    const coName = normPersonName(typeof rawCoName === "string" ? rawCoName : "");

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: app, error: loadErr } = await supabase
      .from("epc_applications").select("id, current_step, epc_business_id").eq("id", appId).maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app) return err("Loan application not found.", 404);
    if (claims.business_type !== "admin" && app.epc_business_id !== claims.business_id) return err("forbidden", 403);

    const documents: Array<Record<string, unknown>> = [];
    const skipped: Array<{ file_name: string; reason: string }> = [];
    const dbPatch: Record<string, unknown> = {};
    const formPatch: Record<string, string> = {};

    // ── Phase 1: read each file with its OWN focused Gemini call, run in
    // PARALLEL (capped). One big call over all files was too slow and returned
    // empty; per-file calls stay small (one file each → fast, reliable JSON) and
    // fire concurrently. Images are shrunk first (MAX_DIMENSION) so each read is
    // quick. Files can be PDF / JPEG / PNG, in any order.
    const perFile = await mapLimit(files, 6, async (file, fi): Promise<{ pend: Pending[]; skip: Array<{ file_name: string; reason: string }> }> => {
      const fileLabel = file.name || "file";
      const pend: Pending[] = [];
      const skip: Array<{ file_name: string; reason: string }> = [];
      try {
        if (!ACCEPTED.has(file.type)) { skip.push({ file_name: fileLabel, reason: "Unsupported file type" }); return { pend, skip }; }
        const input = Buffer.from(await file.arrayBuffer());
        const isPdf = file.type.includes("pdf");
        const scanBuffer = isPdf ? input : await compressImage(input);
        const scanMime = isPdf ? "application/pdf" : "image/jpeg";

        const result = await geminiExtract<{ documents?: RawDoc[] }>({
          images: [{ buffer: scanBuffer, mime: scanMime }], prompt: BUNDLE_PROMPT, schema: BUNDLE_SCHEMA, label: "bundle",
        });
        const docs = Array.isArray(result?.documents) ? result!.documents! : [];
        if (docs.length === 0) {
          skip.push({ file_name: fileLabel, reason: "Couldn't read this as a known document — please add it one at a time." });
          return { pend, skip };
        }
        let srcPdf: PDFDocument | null = null;
        let pageCount = 1;
        if (isPdf) { srcPdf = await PDFDocument.load(input, { ignoreEncryption: true }); pageCount = srcPdf.getPageCount(); }
        for (const d of docs) {
          const rawType = String(d.type || "other").trim() as DocType;
          const type: DocType = ALLOWED_TYPES.has(rawType) ? rawType : "other";
          if (type === "other") continue; // quotation / unknown → separate step, not stored here
          d.source_index = fi; // keep same-file docs grouped for the name-assignment sort
          pend.push({ file, isPdf, srcPdf, pageCount, scanBuffer, scanMime, raw: d, type, fields: normalizeFields(type, d) });
        }
      } catch (e) {
        console.error("[bundle-docs] file failed:", fileLabel, (e as Error)?.message);
        skip.push({ file_name: fileLabel, reason: "Couldn't process this file." });
      }
      return { pend, skip };
    });
    const pendings: Pending[] = [];
    for (const r of perFile) { pendings.push(...r.pend); skipped.push(...r.skip); }
    // Group same-file docs together, in page order, so the name-assignment phase
    // (Aadhaar-back follows the nearest preceding front in the same file) works.
    pendings.sort((a, b) => (Number(a.raw.source_index) || 0) - (Number(b.raw.source_index) || 0) || (Number(a.raw.page_start) || 0) - (Number(b.raw.page_start) || 0));

    // ── Phase 2: name-based person assignment (overrides Gemini's applicant_/
    // coapp_ guess when names are provided). PAN + Aadhaar-front carry a name and
    // are matched directly; the nameless Aadhaar-back follows the nearest
    // preceding front in the SAME source file. The e-bill is always the applicant's.
    if (appName || coName) {
      const personFor = (name: string | null | undefined): "app" | "co" | null => {
        const n = normPersonName(name || "");
        if (!n) return null;
        const sa = appName ? nameMatchScore(n, appName) : -1;
        const sc = coName ? nameMatchScore(n, coName) : -1;
        if (sa <= 0 && sc <= 0) return null;   // no signal → keep Gemini's guess
        if (sc <= 0) return "app";
        if (sa <= 0) return "co";
        return sa >= sc ? "app" : "co";
      };
      let lastPerson: "app" | "co" | null = null;
      let lastFile: File | null = null;
      for (const p of pendings) {
        if (p.file !== lastFile) { lastPerson = null; lastFile = p.file; }
        if (p.type === "applicant_pan" || p.type === "coapp_pan") {
          const person = personFor(p.fields.name) ?? (p.type === "coapp_pan" ? "co" : "app");
          p.type = person === "co" ? "coapp_pan" : "applicant_pan";
        } else if (p.type === "applicant_aadhaar_front" || p.type === "coapp_aadhaar_front") {
          const person = personFor(p.fields.name) ?? (p.type.startsWith("coapp") ? "co" : "app");
          p.type = person === "co" ? "coapp_aadhaar_front" : "applicant_aadhaar_front";
          lastPerson = person;
        } else if (p.type === "applicant_aadhaar_back" || p.type === "coapp_aadhaar_back") {
          const person = lastPerson ?? (p.type.startsWith("coapp") ? "co" : "app");
          p.type = person === "co" ? "coapp_aadhaar_back" : "applicant_aadhaar_back";
        }
      }
    }

    // ── Phase 3: split, store, register, extract-apply each pending doc —
    // CONCURRENTLY (capped). Each task builds its own field-patch delta; deltas
    // merge after (no shared-mutation races), and `documents` keeps input order.
    const phase3 = await mapLimit(pendings, 6, async (p, seq) => {
      const type = p.type;
      const filing = FILING[type];
      try {
        let outBuffer: Buffer;
        let outMime: string;
        let pStart = 1, pEnd = 1;
        if (p.isPdf && p.srcPdf) {
          pStart = clamp(Math.round(Number(p.raw.page_start) || 1), 1, p.pageCount);
          pEnd = clamp(Math.round(Number(p.raw.page_end) || pStart), pStart, p.pageCount);
          const out = await PDFDocument.create();
          const indices = [];
          for (let pg = pStart - 1; pg <= pEnd - 1; pg++) indices.push(pg);
          const copied = await out.copyPages(p.srcPdf, indices);
          copied.forEach((pg) => out.addPage(pg));
          outBuffer = Buffer.from(await out.save());
          outMime = "application/pdf";
        } else {
          outBuffer = p.scanBuffer; outMime = p.scanMime; pStart = 1; pEnd = 1;
        }

        const path = `applications/${appId}/${filing.folder}/${Date.now()}_${seq}_${safeName(p.file.name, type)}`;
        await uploadBuffer(path, outBuffer, outMime);
        await registerDocRow(supabase, appId, filing, path, p.file.name || type, outMime);

        // Aadhaar face crop (image only, non-fatal) — mirrors extract-aadhaar.
        let facePath: string | null = null;
        if ((type === "applicant_aadhaar_front" || type === "coapp_aadhaar_front") && outMime.startsWith("image/")) {
          try { facePath = (await cropAndUploadFace(outBuffer, outMime, appId)).storage_path; }
          catch (e) { console.warn("[bundle-docs] face crop:", (e as Error)?.message); }
        }

        const dDb: Record<string, unknown> = {};
        const dForm: Record<string, string> = {};
        const summary = applyDoc(type, path, p.fields, dDb, dForm, facePath);

        let signed: string | null = null;
        if (outMime.startsWith("image/")) { try { signed = await getSignedReadUrl(path, 3600); } catch { /* non-fatal */ } }

        return {
          skipped: null as { file_name: string; reason: string } | null,
          document: {
            type, category: filing.folder, storage_path: path, mime_type: outMime,
            file_name: p.file.name || type, page_start: pStart, page_end: pEnd, summary, signed_url: signed,
            name: p.fields.name || null, name_confidence: nameConfidence(type, p.fields.name ?? null, appName, coName),
          } as Record<string, unknown> | null,
          dDb, dForm,
        };
      } catch (e) {
        console.error("[bundle-docs] doc failed:", (e as Error)?.message);
        return {
          skipped: { file_name: p.file.name || type, reason: "Couldn't file this document." } as { file_name: string; reason: string } | null,
          document: null as Record<string, unknown> | null,
          dDb: {} as Record<string, unknown>, dForm: {} as Record<string, string>,
        };
      }
    });
    for (const r of phase3) {
      if (r.skipped) { skipped.push(r.skipped); continue; }
      if (r.document) { documents.push(r.document); Object.assign(dbPatch, r.dDb); Object.assign(formPatch, r.dForm); }
    }

    // Persist the extracted fields + `_path` columns to epc_applications. Mirror
    // update-fields' self-heal: retry without DOB/date columns if a coercion
    // rejects the whole patch, so one bad date never loses everything.
    if (Object.keys(dbPatch).length) {
      dbPatch.last_updated_by_user_id = claims.business_id;
      let { error: upErr } = await supabase.from("epc_applications").update(dbPatch).eq("id", appId);
      if (upErr) {
        console.warn("[bundle-docs] update retry (dropping dates):", upErr.message);
        const safe = { ...dbPatch };
        for (const k of Object.keys(safe)) if (/_uploaded_at$|_dob$/.test(k)) delete safe[k];
        ({ error: upErr } = await supabase.from("epc_applications").update(safe).eq("id", appId));
        if (upErr) console.error("[bundle-docs] epc_applications update failed:", upErr.message);
      }
    }

    return NextResponse.json({ ok: true, documents, skipped, form: formPatch });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bundle-docs] error:", msg);
    return err(msg, 500);
  }
}

// ── PATCH — reclassify one already-split doc to a corrected type ──────────────
// Body: { storage_path, mime_type, file_name, from_type, to_type }
// Keeps the split file where it is (no GCS move) and re-points the correct
// `_path` column / doc row at it, clears the old type's columns, and re-OCRs
// the file for the new type's fields. Returns a `form` patch (new keys set,
// old keys cleared to "") for the chat to merge.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const storagePath = String(body.storage_path || "");
    const mime = String(body.mime_type || "");
    const fileName = String(body.file_name || "document");
    const fromType = String(body.from_type || "") as DocType;
    const toType = String(body.to_type || "") as DocType;
    if (!storagePath) return err("storage_path is required.", 400);
    if (!ALLOWED_TYPES.has(toType)) return err("Invalid target type.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: app, error: loadErr } = await supabase
      .from("epc_applications").select("id, epc_business_id").eq("id", appId).maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app) return err("Loan application not found.", 404);
    if (claims.business_type !== "admin" && app.epc_business_id !== claims.business_id) return err("forbidden", 403);

    const dbPatch: Record<string, unknown> = {};
    const formPatch: Record<string, string> = {};

    // 1) Clear the OLD type's columns (path + fields) — both DB (→null) and form (→"").
    if (fromType && fromType !== "other" && FILING[fromType]) {
      const oldFiling = FILING[fromType];
      const clearCols = [...TYPE_FIELD_COLS[fromType]];
      if (oldFiling.pathCol) clearCols.push(oldFiling.pathCol);
      if (oldFiling.uploadedAtCol) clearCols.push(oldFiling.uploadedAtCol);
      for (const c of clearCols) { dbPatch[c] = null; formPatch[c] = ""; }
      // Remove the old doc row if this file was registered under a category.
      if (oldFiling.docRowCategory) {
        try { await supabase.from("user_application_docs").delete().eq("application_id", appId).eq("category", oldFiling.docRowCategory).eq("storage_path", storagePath); }
        catch { /* best-effort */ }
      }
    }

    // 2) Re-OCR the file for the NEW type, then file it there (reusing the same
    //    stored object — no re-upload/move).
    let summary = "Reclassified";
    if (toType !== "other") {
      const filing = FILING[toType];
      await registerDocRow(supabase, appId, filing, storagePath, fileName, mime || "application/octet-stream");

      let fields: Normalized = {};
      let facePath: string | null = null;
      try {
        const buf = await downloadBuffer(storagePath);
        const gImg = [{ buffer: buf, mime: mime || (storagePath.endsWith(".pdf") ? "application/pdf" : "image/jpeg") }];
        if (toType === "applicant_pan" || toType === "coapp_pan") {
          const g = await geminiExtractPan(gImg);
          if (g) fields = { pan: g.pan, name: g.name, father_name: g.father_name, dob: g.dob };
        } else if (toType.includes("aadhaar")) {
          const g = await geminiExtractAadhaar(gImg);
          if (g) fields = { aadhaar_number: g.aadhaar_number ?? g.aadhaar_masked, name: g.name, dob: g.dob, gender: g.gender, care_of: g.care_of, address: g.address };
          if ((toType === "applicant_aadhaar_front" || toType === "coapp_aadhaar_front") && (mime || "").startsWith("image/")) {
            try { facePath = (await cropAndUploadFace(buf, mime, appId)).storage_path; } catch { /* non-fatal */ }
          }
        } else if (toType === "bank_statement") {
          const g = await geminiExtractBankStatement(gImg);
          if (g) fields = { account_holder: g.account_holder, bank_name: g.bank_name, account_no: g.account_no, ifsc: g.ifsc, account_type: g.account_type, mobile: g.mobile, email: g.email };
        } else if (toType === "ebill") {
          const g = await geminiExtractEbill(gImg);
          if (g) fields = { monthly_bill_amount: g.monthly_bill_amount, discom_name: g.discom_name, ca_number: g.ca_number, ebill_address_line: g.ebill_address_line, ebill_name: g.ebill_name };
        }
      } catch (e) {
        console.warn("[bundle-docs] reclassify re-OCR:", (e as Error)?.message);
      }
      summary = applyDoc(toType, storagePath, fields, dbPatch, formPatch, facePath);
    }

    if (Object.keys(dbPatch).length) {
      dbPatch.last_updated_by_user_id = claims.business_id;
      let { error: upErr } = await supabase.from("epc_applications").update(dbPatch).eq("id", appId);
      if (upErr) {
        const safe = { ...dbPatch };
        for (const k of Object.keys(safe)) if (/_uploaded_at$|_dob$/.test(k)) delete safe[k];
        ({ error: upErr } = await supabase.from("epc_applications").update(safe).eq("id", appId));
        if (upErr) console.error("[bundle-docs] reclassify update failed:", upErr.message);
      }
    }

    return NextResponse.json({ ok: true, type: toType, summary, form: formPatch });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bundle-docs] reclassify error:", msg);
    return err(msg, 500);
  }
}
