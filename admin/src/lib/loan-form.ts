// Shared loan-application hydration — loads a persisted epc_applications row and
// its document rows into the flat string Form the edit chatbot + the edit table
// both work with. Used by:
//   • the EPC edit chatbot (dashboard/apply/chat) to pre-fill re-asked questions
//   • the admin "Message to EPC" window to render the edit table with current
//     values + View, and pick which rows to open for editing.
// Client-side under RLS (admin = all, EPC = own rows).

import { supabase } from "@/lib/supabase";

export type LoanForm = Record<string, string>;
export type LoanDocRow = { id: string; category: string; storage_path: string | null };

export type HydratedLoan = {
  form: LoanForm;
  docRows: LoanDocRow[];
  row: Record<string, any>;   // the raw application row (edit_allow, status, …)
};

export async function hydrateLoanForm(id: string): Promise<HydratedLoan> {
  const [{ data: la }, { data: docs }] = await Promise.all([
    supabase().from("epc_applications").select("*").eq("id", id).maybeSingle(),
    supabase().from("user_application_docs").select("id, category, storage_path").eq("application_id", id),
  ]);
  const a = (la ?? {}) as Record<string, any>;
  const p: LoanForm = {};
  const S = (k: string, v: any) => { if (v != null && String(v).trim() !== "") p[k] = String(v); };
  S("borrower_mobile", a.borrower_mobile); S("borrower_name", a.borrower_name); S("borrower_email", a.borrower_email);
  S("borrower_pan", a.borrower_pan); S("borrower_father_name", a.borrower_father_name);
  S("aadhaar_name", a.aadhaar_name); S("aadhaar_dob", a.aadhaar_dob); S("aadhaar_gender", a.aadhaar_gender);
  S("aadhaar_number", String(a.aadhaar_number ?? "").replace(/\D/g, "")); S("aadhaar_care_of", a.aadhaar_care_of); S("aadhaar_address", a.aadhaar_address);
  S("aadhaar_front_path", a.aadhaar_front_path); S("aadhaar_back_path", a.aadhaar_back_path); S("aadhaar_face_path", a.aadhaar_face_path);
  S("ebill_path", a.ebill_path); S("monthly_bill_amount", a.monthly_bill_amount); S("discom_name", a.discom_name);
  S("ca_number", a.ca_number); S("ebill_address_line", a.ebill_address_line); S("ebill_name", a.ebill_name);
  S("proforma_invoice_path", a.proforma_invoice_path); S("rooftop_photo_path", a.rooftop_photo_path);
  S("install_pincode", a.install_pincode); S("install_state", a.install_state); S("install_district", a.install_district); S("install_city", a.install_city);
  S("system_type", a.system_type); S("plant_use_type", a.plant_use_type);
  S("project_size", a.project_size); S("project_size_unit", a.project_size_unit); S("total_project_cost", a.total_project_cost); S("loan_amount_required", a.loan_amount_required);
  S("central_subsidy", a.central_subsidy); S("state_subsidy", a.state_subsidy); S("selected_tenure_years", a.selected_tenure_years);
  S("loan_display_id", a.loan_display_id);
  // Co-applicant
  S("coapp_mobile", a.coapp_mobile); S("coapp_email", a.coapp_email); S("coapp_pan", a.coapp_pan); S("coapp_pan_path", a.coapp_pan_path);
  S("coapp_name", a.coapp_name); S("coapp_dob", a.coapp_dob);
  S("coapp_aadhaar_name", a.coapp_aadhaar_name); S("coapp_aadhaar_dob", a.coapp_aadhaar_dob); S("coapp_aadhaar_gender", a.coapp_aadhaar_gender);
  S("coapp_aadhaar_number", String(a.coapp_aadhaar_number ?? "").replace(/\D/g, "")); S("coapp_aadhaar_care_of", a.coapp_aadhaar_care_of); S("coapp_aadhaar_address", a.coapp_aadhaar_address);
  S("coapp_aadhaar_front_path", a.coapp_aadhaar_front_path); S("coapp_aadhaar_back_path", a.coapp_aadhaar_back_path);
  // Photo + bank statement live in user_application_docs (not columns) — surface
  // their paths so the picker/doc-table know they exist.
  const rows = ((docs ?? []) as LoanDocRow[]);
  const byCat = (c: string) => rows.find((d) => d.category === c);
  const selfie = byCat("customer_photo"); if (selfie?.storage_path) S("customer_photo_path", selfie.storage_path);
  const bank = byCat("bank_statement"); if (bank?.storage_path) S("bank_statement_path", bank.storage_path);
  return { form: p, docRows: rows, row: a };
}
