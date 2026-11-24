// Intake chat — the script: every turn the chat asks, the step payloads sent at submit, the lead script, and turn checks.

import type { Choice, Form } from "@/components/chat/types";
import type { UploadSlot } from "@/components/chat/DocDock";
import { MOBILE_RE, EMAIL_RE } from "@/lib/validators";
import { professionsFor } from "@/lib/loan-form";
import { hasCoapp } from "./form-rules";
import { docTableComplete } from "./doc-slots";

// A turn is one thing the chat asks/does. `when` gates conditional turns
// (co-applicant), `save` marks a step boundary that persists to the server.
export type Turn = {
  id: string;
  bot: string;
  kind: "epc" | "text" | "pincode" | "choice" | "consent" | "docs" | "save" | "loanconfig" | "leadsave" | "doc_table" | "paste";
  field?: string;
  placeholder?: string;
  optional?: boolean;
  choices?: Choice[] | ((f: Form) => Choice[]); // a function when the options depend on an earlier answer
  validate?: (v: string) => string | null;
  when?: (f: Form) => boolean;
  // docs turn:
  uploads?: UploadSlot[];
  extractRoute?: string;
  extraForm?: Record<string, string>;
  docLabel?: string; // friendly name for the "skip / missing" note
  uploadCategory?: string; // docs turn with NO OCR — POST the file to /api/upload under this category
  pathField?: string;      // where to store the returned storage_path in the form
  applicantPan?: boolean;  // reuse extract-coapp-pan OCR but map fields to the APPLICANT
  // save turn:
  step?: number;
  method?: "POST" | "PATCH";
  payload?: (f: Form) => Record<string, unknown>;
};

export const choicesOf = (t: Turn, f: Form): Choice[] => (typeof t.choices === "function" ? t.choices(f) : t.choices ?? []);

// Is this doc turn's file already on the profile? Drives the standalone doc
// turns' `when` gate (e.g. the bank statement self-skips once uploaded).
function docProvided(turnId: string, f: Form): boolean {
  const keys = DOC_PATHS[turnId] || [];
  return keys.length > 0 && keys.every((k) => !!(f[k] && String(f[k]).trim()));
}

export const SCRIPT: Turn[] = [
  // 1) EPC partner
  { id: "epc", bot: "Which EPC partner is this application for?", kind: "epc" },
  // 2) Installation pincode (→ state / district / city lookup)
  { id: "install_pincode", bot: "Installation pincode?", kind: "pincode", field: "install_pincode" },
  // 3) Info sheet — paste the labeled RM sheet; parsed locally (no AI), confirmed, written.
  { id: "info_sheet", bot: "Paste the applicant's info sheet here — I'll read the labels and fill in the details for you to confirm. (Or skip and add them later.)", kind: "paste", optional: true, docLabel: "Info sheet" },
  // 4) Residential / commercial (the sheet's "Place of installation: house" fills it)
  { id: "plant_use_type", bot: "Residential or commercial use?", kind: "choice", field: "plant_use_type",
    when: (f) => !(f.plant_use_type && f.plant_use_type.trim()), choices: [
    { value: "residential", label: "Residential", sub: "Home / society" },
    { value: "commercial", label: "Commercial", sub: "Shop / office / factory" },
  ] },
  // 4a) Solar system type (on/off grid). Asked when still unknown — the info
  //     sheet may already carry it; a converted lead never does. Needed for the
  //     lender summary + Credit Fair email.
  { id: "system_type", bot: "Type of solar system?", kind: "choice", field: "system_type", optional: true,
    when: (f) => !(f.system_type && f.system_type.trim()), choices: [
      { value: "on_grid", label: "On-Grid" }, { value: "off_grid", label: "Off-Grid" }, { value: "hybrid", label: "Hybrid" },
    ] },
  // 4b) Applicant mobile — asked when missing (no info sheet).
  { id: "borrower_mobile", bot: "Applicant's mobile number?", kind: "text", field: "borrower_mobile", placeholder: "10-digit mobile",
    when: (f) => !(f.borrower_mobile && f.borrower_mobile.trim()),
    validate: (v) => (!v.trim() || MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile, or skip.") },
  { id: "lead_owner_name", bot: "Lead owner's name? (optional)", kind: "text", field: "lead_owner_name", placeholder: "Lead owner", optional: true,
    when: (f) => !(f.lead_owner_name && f.lead_owner_name.trim()) },
  // 4c) Applicant email — asked when missing (a converted lead may not carry one).
  { id: "borrower_email", bot: "Applicant's email? (optional)", kind: "text", field: "borrower_email", placeholder: "name@example.com", optional: true,
    when: (f) => !(f.borrower_email && f.borrower_email.trim()),
    validate: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? null : "Enter a valid email, or skip.") },
  // 4c) Co-applicant required? Asked when the decision hasn't been made yet (no
  //     flag, no co-applicant name on file). "Yes" reveals the co-applicant
  //     document slots in the table below and its detail turns.
  { id: "coapp_needed", bot: "Is a co-applicant required for this application?", kind: "choice", field: "coapp_needed", optional: true,
    when: (f) => !f.coapp_needed && f._has_coapp !== "1" && !(f.coapp_name && f.coapp_name.trim()), choices: [
      { value: "yes", label: "Yes, add a co-applicant" }, { value: "no", label: "No co-applicant" },
    ] },
  // 5a) How the documents will be given. "Separate file per document" → the table
  //     (drop each into its box). "One combined PDF" → the table shows a combined-PDF
  //     box that auto-splits and fills the rows for review.
  { id: "doc_choice", bot: "How do you have the applicant's documents?", kind: "choice", field: "_doc_choice", choices: [
    { value: "separate", label: "Separate file for each document", sub: "Upload each into its own box" },
    { value: "single", label: "One combined PDF", sub: "Everything together in a single PDF" },
  ] },
  // 5) Documents — one labeled slot table (see DocTable). The RM drops each
  //    document into its own box; each box reads with its OWN dedicated extractor
  //    (accurate), and the reads fire in PARALLEL as boxes fill (fast — no
  //    per-document waiting). Rooftop photo + applicant photo are rows here; the
  //    quotation stays its OWN step (below). Rows left "don't have it" are recorded
  //    as pending and never block. Replaces the old bundle auto-sort + the
  //    one-at-a-time review/re-ask turns.
  { id: "doc_table", bot: "Now the documents. Drop each one into its box — I'll read it as it lands. Tick “Don't have it” for anything you can't add right now.", kind: "doc_table", docLabel: "Documents" },
  // Co-applicant details the documents don't carry — only with a co-applicant.
  { id: "coapp_relation", bot: "Co-applicant's relation to the applicant?", kind: "text", field: "coapp_relation", placeholder: "e.g. spouse", optional: true, when: hasCoapp },
  { id: "coapp_mobile", bot: "Co-applicant's mobile number?", kind: "text", field: "coapp_mobile", placeholder: "10-digit mobile", optional: true, when: hasCoapp, validate: (v) => (!v.trim() || MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile, or skip.") },
  { id: "coapp_email", bot: "Co-applicant's email?", kind: "text", field: "coapp_email", placeholder: "name@example.com", optional: true, when: hasCoapp, validate: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? null : "Enter a valid email, or skip.") },

  // Bank statement — its own upload step (not one of the table's slots).
  // Asked when there's no statement, or one is on file but its details were never read.
  { id: "bank", bot: "Upload the bank statement.", kind: "docs", docLabel: "Bank statement", when: (f) => !docProvided("bank", f) || !f.bank_account_no,
    uploads: [{ name: "file", label: "Bank statement" }], extractRoute: "extract-bank-statement", extraForm: { method: "manual_epdf" } },

  // 6) Quotation / proforma — its own step (never in the table; Gemini tags it "other").
  { id: "quotation", bot: "Upload the quotation / proforma invoice — I'll read the project cost & size.", kind: "docs", docLabel: "Quotation / invoice",
    uploads: [{ name: "proforma", label: "Quotation / invoice" }], extractRoute: "extract-loan-docs" },
  { id: "loan_amount", bot: "Loan amount required (₹)?", kind: "text", field: "loan_amount_required", placeholder: "e.g. 250000",
    when: (f) => !(Number(f.loan_amount_required) > 0),
    validate: (v) => (!v.trim() || /^\d+(\.\d{1,2})?$/.test(v.trim()) ? null : "Enter the amount in digits, e.g. 250000 or 250000.50.") },

  // 11) Employment
  { id: "employment_type", bot: "Employment type?", kind: "choice", field: "employment_type", choices: [
    { value: "salaried", label: "Salaried" }, { value: "self_employed", label: "Self-employed" },
  ] },
  { id: "profession", bot: "Profession? (optional)", kind: "choice", field: "profession", optional: true, when: (f) => !!f.employment_type,
    choices: (f) => professionsFor(f.employment_type).map((p) => ({ value: p, label: p })) },
  { id: "profession_other", bot: "Please specify the profession.", kind: "text", field: "profession_other", placeholder: "e.g. Engineer", optional: true, when: (f) => f.profession === "Other" },
  // Employer / business name may already be filled from the sheet — skip when so.
  { id: "organization_name", bot: "Organization / business name? (optional)", kind: "text", field: "organization_name", placeholder: "Organization", optional: true, when: (f) => !(f.organization_name && f.organization_name.trim()) },
  { id: "annual_income", bot: "Annual income (₹)? (optional)", kind: "text", field: "annual_income", placeholder: "e.g. 600000", optional: true },

  // Additional documents (optional)
  { id: "additional_docs", bot: "Any other documents to add? (optional — skip if none)", kind: "docs", docLabel: "Additional documents", optional: true,
    uploads: [{ name: "file", label: "Additional document" }], uploadCategory: "other" },

  // 12) Consent + loan configuration
  { id: "consent", bot: "Does the customer consent to the Terms, Privacy & Cookie policies and allow credit-information access?", kind: "consent", field: "consent" },
  { id: "loanconfig", bot: "Last step — loan configuration.", kind: "loanconfig" },

  // ── Edit-only inline fields ──────────────────────────────────────────────────
  // These never appear in the create flow (when:()=>false). They're re-asked ONLY
  // when the RM ticks them in the edit table (a selected target bypasses `when`).
  // Every field is in the update-fields allow-list, so answering persists it.
  { id: "edit_borrower_email", bot: "Applicant's email?", kind: "text", field: "borrower_email", placeholder: "name@example.com", when: () => false, validate: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? null : "Enter a valid email, or skip.") },
  { id: "edit_system_type", bot: "Type of solar system?", kind: "choice", field: "system_type", when: () => false, choices: [
    { value: "on_grid", label: "On-Grid" }, { value: "off_grid", label: "Off-Grid" }, { value: "hybrid", label: "Hybrid" },
  ] },
];

// The complete-step payloads, keyed by step. Persistence during the flow is via
// update-fields (any order); these run in sequence only at final submit to walk
// current_step 1→6, record consent, and submit.
export const STEP_PAYLOAD: Record<number, (f: Form) => Record<string, unknown>> = {
  1: (f) => ({
    borrower_name: f.borrower_name || "", borrower_mobile: f.borrower_mobile || "", borrower_email: f.borrower_email || "", lead_owner_name: f.lead_owner_name || "",
    // borrower_pan + father name MUST be sent — complete-step-1 does .update() and
    // would otherwise NULL them at "Create application", wiping the PAN OCR read
    // during the chat (this was the "PAN uploaded but number blank" bug).
    borrower_pan: f.borrower_pan || "", borrower_father_name: f.borrower_father_name || "",
    install_pincode: f.install_pincode || "", install_state: f.install_state || "", install_district: f.install_district || "", install_city: f.install_city || "",
    system_type: f.system_type || "", plant_use_type: f.plant_use_type || "",
    // Consent is recorded only when the customer gave it (a skipped consent stays pending).
    consent_policies: f.consent === "yes" ? ["terms_conditions", "privacy_policy", "cookie_policy"] : [],
  }),
  2: (f) => ({
    aadhaar_name: f.aadhaar_name || "", aadhaar_dob: f.aadhaar_dob || "", aadhaar_gender: f.aadhaar_gender || "",
    aadhaar_number: f.aadhaar_number || "", aadhaar_care_of: f.aadhaar_care_of || "", aadhaar_address: f.aadhaar_address || "",
    aadhaar_front_path: f.aadhaar_front_path || "", aadhaar_back_path: f.aadhaar_back_path || "", aadhaar_face_path: f.aadhaar_face_path || "",
  }),
  3: (f) => ({
    project_size: f.project_size || "", project_size_unit: f.project_size_unit || "kw",
    total_project_cost: f.total_project_cost || "", loan_amount_required: f.loan_amount_required || "",
    monthly_bill_amount: f.monthly_bill_amount || "", discom_name: f.discom_name || "", ca_number: f.ca_number || "",
    ebill_address_line: f.ebill_address_line || "", ebill_name: f.ebill_name || "",
    ebill_path: f.ebill_path || "", ebill_uploaded_at: f.ebill_uploaded_at || "",
    proforma_invoice_path: f.proforma_invoice_path || "", proforma_uploaded_at: f.proforma_uploaded_at || "",
    rooftop_photo_path: f.rooftop_photo_path || "", rooftop_photo_uploaded_at: f.rooftop_photo_uploaded_at || "",
    install_pincode: f.install_pincode || "", install_state: f.install_state || "", install_city: f.install_city || "",
    // Derive from the co-applicant decision: co-applicant present ⇒ bill not on
    // the applicant alone. Keeps the profile's co-applicant section in sync with
    // the explicit Yes/No answer (a co-applicant is optional, never forced).
    bill_on_applicant_name: !hasCoapp(f),
    coapp_name: f.coapp_name || "", coapp_mobile: f.coapp_mobile || "", coapp_email: f.coapp_email || "", coapp_father_name: f.coapp_father_name || "", coapp_dob: f.coapp_dob || "",
    coapp_pan: f.coapp_pan || "", coapp_pan_path: f.coapp_pan_path || "", coapp_relation: f.coapp_relation || "",
    coapp_aadhaar_name: f.coapp_aadhaar_name || "", coapp_aadhaar_dob: f.coapp_aadhaar_dob || "", coapp_aadhaar_gender: f.coapp_aadhaar_gender || "",
    coapp_aadhaar_number: f.coapp_aadhaar_number || "", coapp_aadhaar_care_of: f.coapp_aadhaar_care_of || "", coapp_aadhaar_address: f.coapp_aadhaar_address || "",
    coapp_aadhaar_front_path: f.coapp_aadhaar_front_path || "", coapp_aadhaar_back_path: f.coapp_aadhaar_back_path || "", coapp_aadhaar_face_path: f.coapp_aadhaar_face_path || "",
  }),
  4: (f) => ({
    employment_type: f.employment_type || "", profession: f.profession || "", profession_other: f.profession_other || "", organization_name: f.organization_name || "", annual_income: f.annual_income || "",
    bank_statement_method: f.bank_statement_method || "manual_epdf", bank_statement_path: f.bank_statement_path || "", bank_statement_uploaded_at: f.bank_statement_uploaded_at || "",
    bank_account_holder: f.bank_account_holder || "", bank_name: f.bank_name || "", bank_account_no: f.bank_account_no || "",
    bank_ifsc: f.bank_ifsc || "", bank_account_type: f.bank_account_type || "", bank_mobile: f.bank_mobile || "", bank_email: f.bank_email || "",
  }),
};

// Lead capture flow — used when the EPC isn't a registered, lender-approved
// partner. A full application can't exist without a registered EPC (DB rule),
// so we capture the customer + typed EPC name as a loan_leads row for the Lead
// tab; it's converted to a full application once the EPC is approved.
export const LEAD_SCRIPT: Turn[] = [
  { id: "lead_name", bot: "Customer's full name?", kind: "text", field: "lead_name", placeholder: "Full name", validate: (v) => (v.trim().length < 2 ? "Enter the customer's name." : null) },
  { id: "lead_mobile", bot: "Customer's phone number?", kind: "text", field: "lead_mobile", placeholder: "10-digit mobile", validate: (v) => (MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile.") },
  { id: "lead_email", bot: "Email? (optional)", kind: "text", field: "lead_email", placeholder: "name@example.com", optional: true, validate: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? null : "Enter a valid email or skip.") },
  { id: "lead_address", bot: "City / installation area? (optional)", kind: "text", field: "lead_address", placeholder: "City or area", optional: true },
  { id: "lead_loan_amount", bot: "Approximate loan amount (₹)? (optional)", kind: "text", field: "lead_loan_amount", placeholder: "e.g. 200000", optional: true },
  { id: "lead_project_size", bot: "Approximate system size in kW? (optional)", kind: "text", field: "lead_project_size", placeholder: "e.g. 5", optional: true },
  { id: "lead_save", bot: "", kind: "leadsave" },
];

// The name of a pending detail, as the question asks it.
export function fieldLabel(t: Turn): string {
  if (t.kind === "consent") return "Consent";
  if (t.kind === "loanconfig") return "Loan configuration";
  return t.docLabel || t.bot.replace(/\?.*$/, "").trim() || t.field || "detail";
}

// Fields where we show the typed amount in words (Indian format) for confirmation.
export const AMOUNT_FIELDS = new Set(["loan_amount_required", "annual_income", "total_project_cost", "monthly_bill_amount", "lead_loan_amount"]);

// The path column(s) that make a document turn "already present" in edit mode.
const DOC_PATHS: Record<string, string[]> = {
  pan: ["borrower_pan"],
  aadhaar: ["aadhaar_front_path", "aadhaar_back_path"],
  selfie: ["customer_photo_path"],
  ebill: ["ebill_path"],
  quotation: ["proforma_invoice_path"],
  rooftop: ["rooftop_photo_path"],
  coapp_pan: ["coapp_pan_path"],
  coapp_aadhaar: ["coapp_aadhaar_front_path", "coapp_aadhaar_back_path"],
  bank: ["bank_statement_path"],
};

// Is this turn's data already on the profile? Drives edit mode's "ask only
// what's missing" — filled turns are skipped.
export function isTurnFilled(t: Turn, f: Form): boolean {
  // Creation-time input aids (EPC pick, paste sheet) + transient `_` fields are
  // never re-asked in edit mode.
  if (t.kind === "epc" || t.kind === "paste") return true;
  if (t.kind === "consent") return f.consent === "yes";
  if (t.field && t.field.startsWith("_")) return true;
  // The document table is "filled" when every applicable slot is on the profile.
  if (t.kind === "doc_table") return docTableComplete(f);
  if (t.kind === "docs") {
    const keys = DOC_PATHS[t.id] || [];
    // The bank statement counts once its details are read too (Bank details on the profile).
    return keys.length > 0 && keys.every((k) => !!(f[k] && String(f[k]).trim())) && (t.id !== "bank" || !!f.bank_account_no);
  }
  // Saved = a tenure AND its EMI (the info sheet gives only a tenure — then it's still asked, pre-filled).
  if (t.kind === "loanconfig") return !!(f.selected_tenure_years && String(f.selected_tenure_years).trim()) && Number(f.selected_monthly_emi) > 0;
  if (t.field) return !!(f[t.field] && String(f[t.field]).trim());
  return false;
}

// A turn the RM can fill/edit (drives the edit "pick" list + completeness). The
// paste sheet is a creation aid, not an editable profile field.
export function isEditableTurn(t: Turn): boolean {
  if (t.field && t.field.startsWith("_")) return false;
  return t.kind === "text" || t.kind === "pincode" || t.kind === "choice" || t.kind === "docs" || t.kind === "doc_table" || t.kind === "loanconfig";
}
// The required (non-optional, applicable) details still missing — consent included.
export function pendingOf(f: Form): string[] {
  return SCRIPT.filter((t) => !t.optional && (!t.when || t.when(f)) && (isEditableTurn(t) || t.kind === "consent") && !isTurnFilled(t, f))
    .map(fieldLabel);
}
// Every required (non-optional, applicable) detail is present.
export const isProfileComplete = (f: Form) => pendingOf(f).length === 0;
