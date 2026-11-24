// Intake chat — the document table's fixed slots, read units, profile path columns and "read from the document" rows.

import type { Fetched, Form } from "@/components/chat/types";
import { frow, hasCoapp } from "./form-rules";

// ── Document-slot table ──────────────────────────────────────────────────────
// The intake documents as fixed, labeled slots. Each ROW is one upload box; a
// "read unit" is what one extractor call needs. Aadhaar reads BOTH sides in a
// single extract-aadhaar call, so its front + back rows share one unit that fires
// only once both files are present. Every other row is its own single-file unit.
// Reads run in PARALLEL as boxes fill — no row waits on another.
export type DocSlot =
  | "aadhaar_front" | "aadhaar_back" | "applicant_pan" | "ebill"
  | "rooftop" | "selfie"
  | "coapp_aadhaar_front" | "coapp_aadhaar_back" | "coapp_pan";
export type DocUnit = "aadhaar" | "applicant_pan" | "ebill" | "rooftop" | "selfie" | "coapp_aadhaar" | "coapp_pan";
export type DocRow = { slot: DocSlot; label: string; unit: DocUnit; lastOfUnit?: boolean; coappOnly?: boolean };

// Column-1 rows, in order. Co-app rows appear only when a co-applicant is named.
export const DOC_TABLE_ROWS: DocRow[] = [
  { slot: "aadhaar_front", label: "Applicant Aadhaar — front", unit: "aadhaar" },
  { slot: "aadhaar_back",  label: "Applicant Aadhaar — back",  unit: "aadhaar", lastOfUnit: true },
  { slot: "applicant_pan", label: "Applicant PAN",             unit: "applicant_pan", lastOfUnit: true },
  { slot: "ebill",         label: "E-bill",                    unit: "ebill", lastOfUnit: true },
  { slot: "rooftop",       label: "Rooftop photo",             unit: "rooftop", lastOfUnit: true },
  { slot: "selfie",        label: "Applicant photo",           unit: "selfie", lastOfUnit: true },
  { slot: "coapp_aadhaar_front", label: "Co-applicant Aadhaar — front", unit: "coapp_aadhaar", coappOnly: true },
  { slot: "coapp_aadhaar_back",  label: "Co-applicant Aadhaar — back",  unit: "coapp_aadhaar", coappOnly: true, lastOfUnit: true },
  { slot: "coapp_pan",           label: "Co-applicant PAN",             unit: "coapp_pan", coappOnly: true, lastOfUnit: true },
];
// The slot(s) that feed each read unit (order = FormData order for Aadhaar).
export const DOC_UNIT_PARTS: Record<DocUnit, DocSlot[]> = {
  aadhaar: ["aadhaar_front", "aadhaar_back"],
  applicant_pan: ["applicant_pan"], ebill: ["ebill"], rooftop: ["rooftop"], selfie: ["selfie"],
  coapp_aadhaar: ["coapp_aadhaar_front", "coapp_aadhaar_back"], coapp_pan: ["coapp_pan"],
};
// Form key(s) that mark a whole unit already on the profile (edit-mode prefill).
export const DOC_UNIT_PATHS: Record<DocUnit, string[]> = {
  aadhaar: ["aadhaar_front_path", "aadhaar_back_path"], applicant_pan: ["borrower_pan"], ebill: ["ebill_path"],
  rooftop: ["rooftop_photo_path"], selfie: ["customer_photo_path"],
  coapp_aadhaar: ["coapp_aadhaar_front_path", "coapp_aadhaar_back_path"], coapp_pan: ["coapp_pan_path"],
};
// The single form key that marks THIS row's own file present (prefill per row).
export const DOC_ROW_PATH: Record<DocSlot, string> = {
  aadhaar_front: "aadhaar_front_path", aadhaar_back: "aadhaar_back_path",
  applicant_pan: "borrower_pan", ebill: "ebill_path",
  rooftop: "rooftop_photo_path", selfie: "customer_photo_path",
  coapp_aadhaar_front: "coapp_aadhaar_front_path", coapp_aadhaar_back: "coapp_aadhaar_back_path",
  coapp_pan: "coapp_pan_path",
};
// Editable "read from the document" rows for a unit, from the current form — the
// same field mapping the old per-doc review cards used. Photo units have none.
export const DOC_UNIT_FIELDS: Partial<Record<DocUnit, (f: Form) => Fetched[]>> = {
  aadhaar: (f) => [frow("Name", f.aadhaar_name || f.borrower_name, "aadhaar_name"), frow("DOB", f.aadhaar_dob, "aadhaar_dob"), frow("Gender", f.aadhaar_gender, "aadhaar_gender"), frow("Aadhaar", f.aadhaar_number, "aadhaar_number"), frow("Address", f.aadhaar_address, "aadhaar_address")],
  applicant_pan: (f) => [frow("PAN", f.borrower_pan, "borrower_pan"), frow("Name", f.borrower_name, "borrower_name"), frow("Father", f.borrower_father_name, "borrower_father_name")],
  ebill: (f) => [frow("Monthly bill (₹)", f.monthly_bill_amount, "monthly_bill_amount"), frow("DISCOM", f.discom_name, "discom_name"), frow("Bill name", f.ebill_name, "ebill_name"), frow("CA number", f.ca_number, "ca_number")],
  coapp_aadhaar: (f) => [frow("Name", f.coapp_aadhaar_name || f.coapp_name, "coapp_aadhaar_name"), frow("DOB", f.coapp_aadhaar_dob, "coapp_aadhaar_dob"), frow("Aadhaar", f.coapp_aadhaar_number, "coapp_aadhaar_number"), frow("Address", f.coapp_aadhaar_address, "coapp_aadhaar_address")],
  coapp_pan: (f) => [frow("PAN", f.coapp_pan, "coapp_pan"), frow("Name", f.coapp_name, "coapp_name"), frow("Father", f.coapp_father_name, "coapp_father_name")],
};

// Friendly per-unit label — used in the combined-PDF (single) review list.
export const UNIT_LABEL: Record<DocUnit, string> = {
  aadhaar: "Applicant Aadhaar", applicant_pan: "Applicant PAN", ebill: "E-bill",
  rooftop: "Rooftop photo", selfie: "Applicant photo",
  coapp_aadhaar: "Co-applicant Aadhaar", coapp_pan: "Co-applicant PAN",
};

// Applicable rows / units for the current form (co-app rows only with a co-app).
export function docTableRowsFor(f: Form): DocRow[] { return DOC_TABLE_ROWS.filter((r) => !r.coappOnly || hasCoapp(f)); }
export function docTableUnitsFor(f: Form): DocUnit[] { return Array.from(new Set(docTableRowsFor(f).map((r) => r.unit))); }
// An off-grid system has no grid connection — its e-bill is optional.
export const billOptional = (f: Form) => f.system_type === "off_grid";
// Every applicable unit is on the profile → the doc_table turn is "filled".
export function docTableComplete(f: Form): boolean {
  return docTableUnitsFor(f)
    .filter((u) => !(u === "ebill" && billOptional(f)))
    .every((u) => DOC_UNIT_PATHS[u].every((k) => !!(f[k] && String(f[k]).trim())));
}
