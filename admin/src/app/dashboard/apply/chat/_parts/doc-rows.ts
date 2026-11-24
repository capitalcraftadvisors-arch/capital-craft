// Loan chat · the document table's rows (which slot reads into which form keys),
// the per-person tables of the apply flow, and the geo-tag rule for commercial rooftops.

import type { Form } from "@/components/chat/types";
import { nameReadable } from "@/lib/name-match";
import { locateUpload, LOCATION_OFF_MSG } from "@/components/GeoOfficeUpload";
import { billName } from "./roles";

// ── Document table ────────────────────────────────────────────────────────────
export type Slot = "aadhaar_front" | "aadhaar_back" | "pan" | "ebill" | "rooftop" | "selfie" | "bank" | "coapp_aadhaar_front" | "coapp_aadhaar_back" | "coapp_pan" | "quotation";
export type Unit = "aadhaar" | "pan" | "ebill" | "rooftop" | "selfie" | "bank" | "coapp_aadhaar" | "coapp_pan" | "quotation";
export type Row = { slot: Slot; label: string; unit: Unit; parts: Slot[]; lastOfUnit?: boolean; coappOnly?: boolean; required?: boolean /* no "Don't have it" */ };

export const APPLICANT_ROWS: Row[] = [
  { slot: "aadhaar_front", label: "Applicant Aadhaar — front", unit: "aadhaar", parts: ["aadhaar_front", "aadhaar_back"] },
  { slot: "aadhaar_back", label: "Applicant Aadhaar — back", unit: "aadhaar", parts: ["aadhaar_front", "aadhaar_back"], lastOfUnit: true },
  { slot: "pan", label: "Applicant PAN", unit: "pan", parts: ["pan"], lastOfUnit: true },
  { slot: "ebill", label: "Electricity bill", unit: "ebill", parts: ["ebill"], lastOfUnit: true },
  { slot: "rooftop", label: "Rooftop photo", unit: "rooftop", parts: ["rooftop"], lastOfUnit: true },
  { slot: "selfie", label: "Applicant photo", unit: "selfie", parts: ["selfie"], lastOfUnit: true },
  { slot: "bank", label: "Bank statement", unit: "bank", parts: ["bank"], lastOfUnit: true },
];
export const COAPP_ROWS: Row[] = [
  { slot: "coapp_aadhaar_front", label: "Co-applicant Aadhaar — front", unit: "coapp_aadhaar", parts: ["coapp_aadhaar_front", "coapp_aadhaar_back"] },
  { slot: "coapp_aadhaar_back", label: "Co-applicant Aadhaar — back", unit: "coapp_aadhaar", parts: ["coapp_aadhaar_front", "coapp_aadhaar_back"], lastOfUnit: true },
  { slot: "coapp_pan", label: "Co-applicant PAN", unit: "coapp_pan", parts: ["coapp_pan"], lastOfUnit: true },
];
// Quotation row — used in the review table so the uploaded quotation / proforma
// is visible (View + Replace) with its read-out project size & cost editable.
export const QUOTATION_ROW: Row = { slot: "quotation", label: "Quotation / proforma invoice", unit: "quotation", parts: ["quotation"], lastOfUnit: true };

// Apply-mode tables. The first person's documents carry neutral labels (roles
// aren't known yet); the second person's are labelled for the role they're
// asked for; the photo + bank statement are the final applicant's. The PAN is
// required once the first person turned out to be the bill owner.
export function firstRows(f: Form): Row[] {
  const pick = (u: Unit) => APPLICANT_ROWS.filter((r) => r.unit === u);
  return [...pick("ebill"), ...pick("aadhaar"), ...pick("pan"), ...pick("rooftop")]
    .map((r) => ({
      ...r,
      label: r.unit === "rooftop" && f.plant_use_type === "commercial" ? GEO_ROOFTOP : r.label.replace("Applicant ", ""),
      required: r.unit === "aadhaar" || (r.unit === "pan" && f._p1_pan_required === "1"),
    }));
}
export function secondRows(f: Form): Row[] {
  const who = f._p2_role !== "owner" ? "Applicant" : nameReadable(f.ebill_name) ? `${billName(f)} (bill owner)` : "Bill owner";
  return COAPP_ROWS.map((r) => ({ ...r, label: r.label.replace("Co-applicant", who), required: true }));
}
export function finalRows(f: Form): Row[] {
  const whose = f.borrower_name ? `${f.borrower_name}'s` : "Applicant's";
  return APPLICANT_ROWS.filter((r) => r.unit === "selfie" || r.unit === "bank")
    .map((r) => ({ ...r, label: `${whose} ${r.unit === "selfie" ? "photo" : "bank statement"}` }));
}

// A commercial site's rooftop photos must carry their location — GPS in the
// photo, a GPS-camera stamp, or the phone's live GPS (GeoOfficeUpload's rule).
const GEO_ROOFTOP = "Rooftop photo (geo-tagged)";
const NO_GEO_MSG = "No location found in this photo. Upload a rooftop photo taken with location on, or a GPS-camera photo with the location printed on it.";
export async function geoTagged(file: File, category: string): Promise<{ file: File; gps: string }> {
  const r = await locateUpload(file, category);
  if ("error" in r) throw new Error(r.error === "location_off" ? LOCATION_OFF_MSG : NO_GEO_MSG);
  return { file: r.file, gps: JSON.stringify(r.gps) };
}

// Form keys that mark each unit already read (for prefill/done).
export const UNIT_DONE_KEY: Record<Unit, string[]> = {
  aadhaar: ["aadhaar_front_path"], pan: ["borrower_pan_path", "borrower_pan"], ebill: ["ebill_path"],
  rooftop: ["rooftop_photo_path"], selfie: ["customer_photo_path"], bank: ["bank_statement_path"],
  coapp_aadhaar: ["coapp_aadhaar_front_path"], coapp_pan: ["coapp_pan_path"],
  quotation: ["proforma_invoice_path"],
};
// The PAN's read-out name: the name read off the card (it feeds the Aadhaar ≠
// PAN check) until the person's name is on file — set when the roles are
// assigned, or hydrated when editing (roles fixed), so a fix there is submitted.
const panNameField = (f: Form, read: string, onFile: string) => (!(onFile in f) && read in f ? read : onFile);
// Editable read-out fields shown under a unit once read.
export const UNIT_FIELDS: Partial<Record<Unit, (f: Form) => { label: string; field: string }[]>> = {
  aadhaar: () => [{ label: "Name", field: "aadhaar_name" }, { label: "DOB", field: "aadhaar_dob" }, { label: "Aadhaar", field: "aadhaar_number" }, { label: "Address", field: "aadhaar_address" }],
  pan: (f) => [{ label: "PAN", field: "borrower_pan" }, { label: "Name", field: panNameField(f, "_pan_name", "borrower_name") }, { label: "Father", field: "borrower_father_name" }],
  ebill: () => [{ label: "Monthly bill (₹)", field: "monthly_bill_amount" }, { label: "DISCOM", field: "discom_name" }, { label: "Bill name", field: "ebill_name" }],
  coapp_aadhaar: () => [{ label: "Name", field: "coapp_aadhaar_name" }, { label: "DOB", field: "coapp_aadhaar_dob" }, { label: "Aadhaar", field: "coapp_aadhaar_number" }],
  coapp_pan: (f) => [{ label: "PAN", field: "coapp_pan" }, { label: "Name", field: panNameField(f, "_coapp_pan_name", "coapp_name") }, { label: "Father", field: "coapp_father_name" }],
  quotation: () => [{ label: "Project size (kW)", field: "project_size" }, { label: "Total project cost (₹)", field: "total_project_cost" }],
};
