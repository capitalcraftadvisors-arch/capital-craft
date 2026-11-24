// EPC onboarding chat · the script — every question in order — plus the small
// helpers the page uses with it (field labels, the submit's required set, prefill keys).

import type { Choice, Form } from "@/components/chat/types";
import type { UploadSlot } from "@/components/chat/DocDock";
import { EMAIL_RE, PAN_RE, GSTIN_RE } from "@/lib/validators";

// A turn is one thing the chat asks/does. `when` gates conditional turns.
export type Turn = {
  id: string;
  bot: string;
  kind: "mobile" | "text" | "choice" | "docs" | "confirmacct" | "bankstatements" | "stakeholders" | "references" | "submit";
  field?: string;      // form key (and, for text/choice, usually the epc_business column)
  filledBy?: string;   // which form key marks this turn "already filled" (edit-skip)
  placeholder?: string;
  optional?: boolean;
  choices?: Choice[];
  validate?: (v: string) => string | null;
  when?: (f: Form) => boolean;
  // Maps an answer → the epc_business column patch to write.
  write?: (v: string, f: Form) => Record<string, unknown>;
  // Step (1..7) reached once this turn completes — bumps current_step so an
  // abandoned profile lands on the board's "Doc Uploaded" column.
  step?: number;
  // docs turn:
  uploads?: (UploadSlot & { category: string })[];
  replace?: boolean;              // pass replace=true (unique-index categories)
  ocr?: "pan" | "gst" | "cheque"; // OCR run on the FIRST slot's file
  docLabel?: string;
  filledCats?: string[];          // categories that mark this doc turn present
};

const DESIGNATION_CHOICES: Choice[] = [
  { value: "Partner", label: "Partner" },
  { value: "Director", label: "Director" },
  { value: "Proprietor", label: "Proprietor" },
  { value: "Owner", label: "Owner" },
  { value: "Manager", label: "Manager" },
  { value: "Other", label: "Other" },
];
const BUSINESS_CHOICES: Choice[] = [
  { value: "proprietorship", label: "Proprietorship" },
  { value: "pvt_ltd", label: "Private Limited" },
  { value: "partnership", label: "Partnership" },
  { value: "llp", label: "LLP" },
];
const SURYA_CHOICES: Choice[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "other", label: "Other" },
];

export function extraDocLabel(bt?: string): string | null {
  if (bt === "partnership") return "Partnership Deed";
  if (bt === "pvt_ltd") return "Certificate of Incorporation (COI)";
  if (bt === "llp") return "LLP Agreement";
  return null;
}

export const SCRIPT: Turn[] = [
  // ── Create ──
  { id: "mobile", kind: "mobile", bot: "Let's onboard a new EPC partner. What's their 10-digit mobile number?", when: (f) => f._has_id !== "1" },

  // ── Step 1 · Identity ──
  { id: "contact_name", kind: "text", bot: "Who's the main point of contact? (first & last name)", field: "contact_name", placeholder: "Full name", step: 2,
    validate: (v) => (v.trim().length < 2 ? "Enter the contact's name." : null), write: (v) => ({ contact_name: v.trim() }) },
  { id: "contact_email", kind: "text", bot: "Their email ID?", field: "contact_email", placeholder: "name@example.com", step: 2,
    validate: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? null : "Enter a valid email or skip."), optional: true, write: (v) => ({ contact_email: v.trim() }) },
  { id: "contact_designation", kind: "choice", bot: "What's their designation?", field: "_designation_choice", filledBy: "contact_designation", choices: DESIGNATION_CHOICES, step: 2,
    write: (v) => (v === "Other" ? {} : { contact_designation: v }) },
  { id: "designation_other", kind: "text", bot: "Please specify the designation.", field: "contact_designation", placeholder: "e.g. CEO", step: 2,
    when: (f) => f._designation_choice === "Other", write: (v) => ({ contact_designation: v.trim() }) },

  // ── Step 2 · Business ──
  { id: "business_type", kind: "choice", bot: "What kind of business entity is it?", field: "business_type", choices: BUSINESS_CHOICES, step: 2,
    write: (v) => ({ business_type: v }) },
  { id: "pan_doc", kind: "docs", bot: "Upload the business PAN card — I'll read it.", docLabel: "Business PAN", step: 2,
    uploads: [{ name: "file", label: "PAN card", category: "pan_business" }], replace: true, ocr: "pan", filledCats: ["pan_business"] },
  { id: "pan_number", kind: "text", bot: "I couldn't read the PAN number — what is it?", field: "pan_number", placeholder: "ABCDE1234F", step: 2,
    when: (f) => !f.pan_number, validate: (v) => (PAN_RE.test(v.trim().toUpperCase()) ? null : "Invalid PAN (AAAAA9999A)."), write: (v) => ({ pan_number: v.trim().toUpperCase() }) },
  { id: "gst_doc", kind: "docs", bot: "Upload the GST registration certificate — I'll read the legal name, trade name, GSTIN & address.", docLabel: "GST certificate", step: 2,
    uploads: [{ name: "file", label: "GST certificate", category: "gstin" }], replace: true, ocr: "gst", filledCats: ["gstin"] },
  { id: "legal_name", kind: "text", bot: "Legal name of the business?", field: "legal_name", placeholder: "e.g. Acme Solar Pvt Ltd", step: 2,
    when: (f) => !f.legal_name, write: (v) => ({ legal_name: v.trim() }) },
  { id: "trade_name", kind: "text", bot: "Trade name?", field: "trade_name", placeholder: "e.g. Acme Solar", step: 2,
    when: (f) => !f.trade_name, write: (v) => ({ trade_name: v.trim() }) },
  { id: "gstin_number", kind: "text", bot: "GSTIN?", field: "gstin_number", placeholder: "08ATMPS8478D1ZY", step: 2,
    when: (f) => !f.gstin_number, validate: (v) => (!v.trim() || GSTIN_RE.test(v.trim().toUpperCase()) ? null : "Invalid GSTIN (15 chars)."), write: (v) => ({ gstin_number: v.trim().toUpperCase() }) },
  { id: "pm_surya_ghar", kind: "choice", bot: "Registered with PM Surya Ghar?", field: "pm_surya_ghar", filledBy: "pm_surya_ghar", choices: SURYA_CHOICES, step: 2,
    write: (v) => ({ pm_surya_ghar: v, ...(v !== "other" ? { pm_surya_ghar_other: null } : {}), ...(v !== "yes" ? { pm_surya_ghar_capacity: null } : {}) }) },
  { id: "pm_surya_ghar_other", kind: "text", bot: "Which entity are they registered with?", field: "pm_surya_ghar_other", placeholder: "Entity name", step: 2,
    when: (f) => f.pm_surya_ghar === "other", write: (v) => ({ pm_surya_ghar_other: v.trim() }) },
  { id: "pm_surya_ghar_capacity", kind: "text", bot: "How many installations under the PM Surya Ghar scheme? (optional)", field: "pm_surya_ghar_capacity", placeholder: "e.g. 25", optional: true, step: 2,
    when: (f) => f.pm_surya_ghar === "yes", write: (v) => ({ pm_surya_ghar_capacity: v.trim() || null }) },
  { id: "extra_doc", kind: "docs", bot: "", docLabel: "Entity document", optional: true, step: 2,
    uploads: [{ name: "file", label: "Entity document", category: "extra_doc" }], filledCats: ["extra_doc"], when: (f) => !!extraDocLabel(f.business_type) },

  // ── Step 3 · Stakeholders ──
  { id: "stakeholders", kind: "stakeholders", bot: "Now the people behind the business — add their details and upload each one's PAN & Aadhaar (I'll read them)." },

  // ── Step 4 · Bank ──
  { id: "cheque_doc", kind: "docs", bot: "Upload a cancelled cheque — I'll read the account number, IFSC & bank name.", docLabel: "Cancelled cheque", step: 5,
    uploads: [{ name: "file", label: "Cancelled cheque", category: "cancelled_cheque" }], replace: true, ocr: "cheque", filledCats: ["cancelled_cheque"] },
  { id: "confirm_acct", kind: "confirmacct", bot: "Please re-enter the bank account number to confirm it.", step: 5 },
  { id: "bank_statements", kind: "bankstatements", bot: "Upload the last 12 months' bank statements — one file or as many as needed (duplicate files are skipped automatically).", step: 5 },
  { id: "gst_username", kind: "text", bot: "GST username (their GST portal login)?", field: "gst_username", placeholder: "GST portal username", step: 5,
    write: (v) => ({ gst_username: v.trim() || null }) },

  // ── Step 5 · Office verification ──
  { id: "office", kind: "docs", bot: "Three office photos: exterior (signboard visible), interior, and a selfie at the office.", docLabel: "Office photos", optional: true, step: 6,
    uploads: [
      { name: "office_exterior", label: "Exterior", category: "office_exterior" },
      { name: "office_interior", label: "Interior", category: "office_interior" },
      { name: "office_selfie", label: "Selfie at office", category: "office_selfie" },
    ], filledCats: ["office_exterior", "office_interior", "office_selfie"] },

  // ── Step 6 · References ──
  { id: "references", kind: "references", bot: "Almost done — add at least 2 customer and 2 supplier references." },

  // ── Submit ──
  { id: "submit", kind: "submit", bot: "That's everything. Ready to submit this EPC for verification?" },
];

// ── Helpers ──
export function fieldLabel(t: Turn): string { return t.placeholder || t.docLabel || t.field || "detail"; }

// Same required set the classic review page uses for an admin submit.
export function missingRequired(b: Record<string, any>): string[] {
  const out: string[] = [];
  if (!String(b.contact_name ?? "").trim()) out.push("Contact name");
  if (!String(b.contact_mobile ?? "").trim()) out.push("Mobile");
  if (!String(b.contact_designation ?? "").trim()) out.push("Designation");
  if (!b.business_type) out.push("Business type");
  if (!b.pan_number || !PAN_RE.test(String(b.pan_number))) out.push("Valid PAN");
  const sh = (b.stakeholders as { name?: string; designation?: string }[] | null) ?? [];
  if (sh.filter((s) => s.name?.trim() && s.designation?.trim()).length === 0) out.push("At least one member");
  return out;
}

// epc_business columns pulled into the chat form on resume/edit.
export const PREFILL_KEYS = [
  "contact_name", "contact_email", "contact_designation", "business_type",
  "pan_number", "legal_name", "trade_name", "gstin_number", "gst_address",
  "pm_surya_ghar", "pm_surya_ghar_other", "pm_surya_ghar_capacity",
  "bank_account_number", "bank_ifsc", "bank_name", "gst_username",
  "referral_source", "referral_source_other",
];
