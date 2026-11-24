// Intake chat — how a saved application and the extract routes' replies become the chat's form fields.

import type { Fetched, Form } from "@/components/chat/types";
import type { Turn } from "./script";

// Map an existing application row → the chat's form field map (all strings;
// the boolean e-bill flag becomes "yes"/"no").
const PREFILL_KEYS = [
  "borrower_name", "borrower_mobile", "borrower_email", "borrower_pan", "borrower_father_name", "customer_photo_path", "lead_owner_name", "install_pincode", "install_state", "install_district", "install_city", "system_type", "plant_use_type",
  "aadhaar_name", "aadhaar_dob", "aadhaar_gender", "aadhaar_number", "aadhaar_care_of", "aadhaar_address", "aadhaar_front_path", "aadhaar_back_path", "aadhaar_face_path",
  "project_size", "project_size_unit", "total_project_cost", "loan_amount_required", "monthly_bill_amount", "discom_name", "ca_number", "ebill_address_line", "ebill_name", "ebill_path", "ebill_uploaded_at", "proforma_invoice_path", "proforma_uploaded_at", "rooftop_photo_path", "rooftop_photo_uploaded_at",
  "coapp_name", "coapp_mobile", "coapp_email", "coapp_father_name", "coapp_dob", "coapp_pan", "coapp_pan_path", "coapp_relation", "coapp_aadhaar_name", "coapp_aadhaar_dob", "coapp_aadhaar_gender", "coapp_aadhaar_number", "coapp_aadhaar_care_of", "coapp_aadhaar_address", "coapp_aadhaar_front_path", "coapp_aadhaar_back_path", "coapp_aadhaar_face_path",
  "employment_type", "profession", "profession_other", "organization_name", "annual_income", "bank_statement_method", "bank_statement_path", "bank_statement_uploaded_at", "bank_account_holder", "bank_name", "bank_account_no", "bank_ifsc", "bank_account_type", "bank_mobile", "bank_email",
  "central_subsidy", "state_subsidy", "roi_percent", "selected_tenure_years", "selected_monthly_emi", "selected_subsidy_emi",
];
export function prefillFromApp(a: Record<string, any>): Form {
  const f: Form = {};
  for (const k of PREFILL_KEYS) if (a[k] != null && a[k] !== "") f[k] = String(a[k]);
  // Documents uploaded as rows (the partner chat, the multi-file uploaders) count
  // as on file too — else the chat asks for a document the profile already shows.
  const ROW_PATH: Record<string, string> = {
    bank_statement: "bank_statement_path", customer_photo: "customer_photo_path", borrower_photo: "rooftop_photo_path",
    quotation: "proforma_invoice_path", electricity_bill: "ebill_path",
  };
  for (const d of (Array.isArray(a.docs) ? a.docs : []) as { category: string; storage_path: string | null }[]) {
    const k = ROW_PATH[d.category];
    if (k && !f[k] && d.storage_path) f[k] = d.storage_path;
  }
  if (a.bill_on_applicant_name === true) { f.bill_on_applicant_name = "yes"; f.coapp_needed = "no"; }
  else if (a.bill_on_applicant_name === false || a.coapp_name) { f.bill_on_applicant_name = "no"; f._has_coapp = "1"; f.coapp_needed = "yes"; }
  if (a.consent_at) f.consent = "yes";
  return f;
}

// Map an extract route's JSON response → { form patch, fetched-field list }.
export function mapExtract(turn: Turn, j: Record<string, any>): { patch: Form; fields: Fetched[] } {
  const coapp = turn.extraForm?._coapp === "1";
  const row = (label: string, value: any, field?: string): Fetched => {
    const v = value == null || value === "" ? "" : String(value);
    return { label, value: v, ok: !!v, field };
  };
  if (turn.extractRoute === "extract-aadhaar") {
    const f = j.fields ?? {}, p = j.storage_paths ?? {};
    if (coapp) return { patch: {
      // Store the FULL 12-digit number when OCR read it (epc_applications is
      // admin-only via RLS); fall back to the masked form only if OCR couldn't.
      coapp_aadhaar_name: f.name ?? "", coapp_aadhaar_dob: f.dob ?? "", coapp_aadhaar_gender: f.gender ?? "", coapp_aadhaar_number: f.aadhaar_number ?? f.aadhaar_masked ?? "",
      coapp_aadhaar_care_of: f.care_of ?? "", coapp_aadhaar_address: f.address ?? "",
      coapp_aadhaar_front_path: p.front ?? "", coapp_aadhaar_back_path: p.back ?? "", coapp_aadhaar_face_path: p.face ?? "",
      coapp_name: f.name ?? "", coapp_dob: f.dob ?? "",
    }, fields: [row("Name", f.name, "coapp_aadhaar_name"), row("DOB", f.dob, "coapp_aadhaar_dob"), row("Aadhaar", f.aadhaar_number ?? f.aadhaar_masked)] };
    return { patch: {
      // Store the FULL 12-digit number when OCR read it (epc_applications is
      // admin-only via RLS); fall back to the masked form only if OCR couldn't.
      aadhaar_name: f.name ?? "", aadhaar_dob: f.dob ?? "", aadhaar_gender: f.gender ?? "", aadhaar_number: f.aadhaar_number ?? f.aadhaar_masked ?? "",
      aadhaar_care_of: f.care_of ?? "", aadhaar_address: f.address ?? "",
      aadhaar_front_path: p.front ?? "", aadhaar_back_path: p.back ?? "", aadhaar_face_path: p.face ?? "",
      // Auto-fill the applicant identity so the RM doesn't type it (only when read).
      ...(f.name ? { borrower_name: f.name } : {}),
      ...(f.dob ? { borrower_dob: f.dob } : {}),
    }, fields: [row("Name", f.name, "borrower_name"), row("DOB", f.dob, "aadhaar_dob"), row("Gender", f.gender, "aadhaar_gender"), row("Aadhaar", f.aadhaar_number ?? f.aadhaar_masked), row("Address", f.address, "aadhaar_address")] };
  }
  if (turn.extractRoute === "extract-coapp-pan") {
    const f = j.fields ?? {};
    if (turn.applicantPan) {
      // Same PAN OCR, mapped to the APPLICANT.
      return { patch: {
        borrower_pan: f.pan ?? "",
        _pan_name: f.name ?? "", // transient — used by the name check (not persisted)
        ...(f.name ? { borrower_name: f.name } : {}),
        ...(f.father_name ? { borrower_father_name: f.father_name } : {}),
      }, fields: [row("PAN", f.pan, "borrower_pan"), row("Name", f.name, "borrower_name"), row("Father", f.father_name, "borrower_father_name")] };
    }
    return { patch: { coapp_pan: f.pan ?? "", coapp_name: f.name ?? "", coapp_father_name: f.father_name ?? "", coapp_dob: f.dob ?? "", coapp_pan_path: j.storage_path ?? "" },
      fields: [row("PAN", f.pan, "coapp_pan"), row("Name", f.name, "coapp_name"), row("Father", f.father_name, "coapp_father_name")] };
  }
  if (turn.extractRoute === "extract-loan-docs") {
    // The e-bill and the quotation are now separate turns, each calling this
    // route with a single file — so only map the part that was uploaded, never
    // overwriting the other's already-read values with blanks.
    const pf = j.proforma?.fields ?? {}, eb = j.ebill?.fields ?? {};
    const hasP = !!(j.proforma && (j.proforma.fields || j.proforma.storage_path));
    const hasE = !!(j.ebill && (j.ebill.fields || j.ebill.storage_path));
    const patch: Form = {};
    const fields: Fetched[] = [];
    if (hasP) {
      patch.project_size = pf.project_size != null ? String(pf.project_size) : "";
      patch.project_size_unit = pf.project_size_unit ?? "kw";
      patch.total_project_cost = pf.total_project_cost != null ? String(pf.total_project_cost) : "";
      patch.proforma_invoice_path = j.proforma?.storage_path ?? "";
      patch.proforma_uploaded_at = j.proforma?.uploaded_at ?? "";
      fields.push(row("System size", pf.project_size != null ? `${pf.project_size} ${pf.project_size_unit ?? "kW"}` : "", "project_size"));
      fields.push(row("Project cost", pf.total_project_cost != null ? `₹${Number(pf.total_project_cost).toLocaleString("en-IN")}` : "", "total_project_cost"));
    }
    if (hasE) {
      patch.monthly_bill_amount = eb.monthly_bill_amount != null ? String(eb.monthly_bill_amount) : "";
      patch.discom_name = eb.discom_name ?? "";
      patch.ca_number = eb.ca_number ?? "";
      patch.ebill_address_line = eb.ebill_address_line ?? "";
      patch.ebill_name = eb.ebill_name ?? "";
      patch.ebill_path = j.ebill?.storage_path ?? "";
      patch.ebill_uploaded_at = j.ebill?.uploaded_at ?? "";
      fields.push(row("Monthly bill", eb.monthly_bill_amount != null ? `₹${eb.monthly_bill_amount}` : "", "monthly_bill_amount"));
      fields.push(row("DISCOM", eb.discom_name, "discom_name"));
      fields.push(row("Bill name", eb.ebill_name, "ebill_name"));
      fields.push(row("CA number", eb.ca_number, "ca_number"));
    }
    return { patch, fields };
  }
  if (turn.extractRoute === "extract-bank-statement") {
    const f = j.fields ?? {};
    return { patch: {
      bank_statement_method: j.method ?? "manual_epdf", bank_statement_path: j.storage_path ?? "", bank_statement_uploaded_at: new Date().toISOString(),
      bank_account_holder: f.account_holder ?? "", bank_name: f.bank_name ?? "", bank_account_no: f.account_no ?? "", bank_ifsc: f.ifsc ?? "", bank_account_type: f.account_type ?? "", bank_mobile: f.mobile ?? "", bank_email: f.email ?? "",
    }, fields: [row("Holder", f.account_holder, "bank_account_holder"), row("Bank", f.bank_name, "bank_name"), row("A/C no.", f.account_no, "bank_account_no"), row("IFSC", f.ifsc, "bank_ifsc"), row("Type", f.account_type, "bank_account_type")] };
  }
  return { patch: {}, fields: [] };
}
