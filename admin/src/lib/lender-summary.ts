// Shared builder for the lender "summary.xlsx" rows — used by both the
// Download-ZIP route and the Send-to-Lender email. The attached summary sheet
// is the SAME general layout for every lender (Credit Fair, Solfin, Aerem).
//
// Credit Fair's only difference is the EMAIL BODY: its message embeds an
// applicant-detail table (see creditFairEmailRows) instead of the standard
// document-forwarding text used for Solfin / Aerem.

export type LenderKey = "creditfair" | "aerem" | "solfin";

export const LENDER_LABEL: Record<LenderKey, string> = {
  creditfair: "Credit Fair",
  aerem: "Aerem",
  solfin: "Solfin",
};

const SYSTEM_LABEL: Record<string, string> = { on_grid: "On-Grid", off_grid: "Off-Grid", hybrid: "Hybrid" };

function rupees(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0 ? "₹" + Math.round(v).toLocaleString("en-IN") : "—";
}
function ddmmyyyy(s: unknown): string {
  if (!s) return "—";
  const str = String(s);
  const d = new Date(str.length <= 10 ? str + "T00:00:00" : str);
  if (Number.isNaN(d.getTime())) return str;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function kwOf(loan: Record<string, any>): string {
  const s = Number(loan.project_size);
  if (!s) return "—";
  const v = loan.project_size_unit === "mw" ? s * 1000 : s;
  return `${v} kW`;
}
function useTypeLabel(loan: Record<string, any>): string {
  return loan.plant_use_type === "commercial" ? "Commercial" : loan.plant_use_type === "residential" ? "Residential" : "—";
}
function installAddress(loan: Record<string, any>): string {
  const a = [loan.install_address, loan.install_city, loan.install_state, loan.install_pincode].filter(Boolean).join(", ");
  const b = [loan.ebill_address_line, loan.install_city, loan.install_state, loan.install_pincode].filter(Boolean).join(", ");
  return a || b || "—";
}

// Rows = [label, value][]. Blank ["", ""] entries render as spacer rows.
export function summaryRows(
  loan: Record<string, any>,
  ctx: { displayId: string; epcName: string; epcDisplayId?: string | null },
  lender: LenderKey,
): Array<[string, string]> {
  const name = loan.borrower_name || loan.aadhaar_name || "—";

  // ALL lenders (Credit Fair included) use the same general summary sheet.
  // Credit Fair's distinct presentation now lives in the EMAIL BODY only —
  // see creditFairEmailRows() below — not in this attached sheet.
  const rows: Array<[string, string]> = [
    ["Application ID", ctx.displayId],
    ["Submitted to", LENDER_LABEL[lender]],
    ["Status", String(loan.status ?? "—")],
    ["Submitted", loan.submitted_at ? new Date(loan.submitted_at).toLocaleString("en-IN") : "—"],
    ["EPC Partner", `${ctx.epcName}${ctx.epcDisplayId ? ` (${ctx.epcDisplayId})` : ""}`],
    ["", ""],
    ["Applicant", name],
    ["Mobile", loan.borrower_mobile ? `+91 ${loan.borrower_mobile}` : "—"],
    ["Email", loan.borrower_email ?? "—"],
    ["PAN", loan.borrower_pan ?? "—"],
    ["Aadhaar", loan.aadhaar_number ?? loan.aadhaar_number_masked ?? "—"],
    ["DOB", loan.aadhaar_dob ?? "—"],
    ["Gender", loan.aadhaar_gender ?? "—"],
    ["Address (Aadhaar)", loan.aadhaar_address ?? "—"],
    ["", ""],
    ["Install address", installAddress(loan)],
    ["System type", loan.system_type ?? "—"],
    ["Project size", loan.project_size ? `${loan.project_size} ${(loan.project_size_unit ?? "kw").toUpperCase()}` : "—"],
    ["Project cost", rupees(loan.total_project_cost)],
    ["Loan required", rupees(loan.loan_amount_required)],
    ["Monthly bill", rupees(loan.monthly_bill_amount)],
    ["DISCOM", loan.discom_name ?? "—"],
    ["CA number", loan.ca_number ?? "—"],
    ["", ""],
    ["Employment", loan.employment_type ?? "—"],
    ["Profession", loan.profession === "Other" && loan.profession_other ? `Other — ${loan.profession_other}` : (loan.profession ?? "—")],
    ["Organization", loan.organization_name ?? "—"],
    ["Annual income", rupees(loan.annual_income)],
    ["Bank", loan.bank_name ?? "—"],
    ["Account holder", loan.bank_account_holder ?? "—"],
    ["Account no.", loan.bank_account_no ?? "—"],
    ["IFSC", loan.bank_ifsc ?? "—"],
    ["", ""],
    ["Tenure", loan.selected_tenure_years ? `${loan.selected_tenure_years} years` : "—"],
  ];
  if (loan.bill_on_applicant_name === false) {
    rows.push(["", ""]);
    rows.push(["Co-applicant", loan.coapp_name ?? "—"]);
    rows.push(["Co-app relation", loan.coapp_relation ?? "—"]);
    rows.push(["Co-app PAN", loan.coapp_pan ?? "—"]);
    rows.push(["Co-app Aadhaar", loan.coapp_aadhaar_number ?? loan.coapp_aadhaar_number_masked ?? "—"]);
    rows.push(["Co-app mobile", loan.coapp_mobile ? `+91 ${loan.coapp_mobile}` : "—"]);
  }
  return rows;
}

// EPC detail table — the editable applicant/partner table for the EPC
// "send to lender" email (mirrors creditFairEmailRows for loans).
export function epcSummaryRows(epc: Record<string, any>): Array<[string, string]> {
  const name = epc.trade_name || epc.legal_name || epc.contact_name || "—";
  return [
    ["EPC name", name],
    ["EPC ID", epc.epc_display_id ?? "—"],
    ["Legal name", epc.legal_name ?? "—"],
    ["Contact person", epc.contact_name ?? "—"],
    ["Designation", epc.contact_designation ?? "—"],
    ["Mobile number", epc.contact_mobile ? `+91 ${epc.contact_mobile}` : "—"],
    ["Email", epc.contact_email ?? "—"],
    ["GSTIN", epc.gstin_number ?? "—"],
    ["Business type", epc.business_type ?? "—"],
    ["Years in business", epc.years_in_business != null ? String(epc.years_in_business) : "—"],
    ["Address", [epc.address, epc.city, epc.state, epc.pincode].filter(Boolean).join(", ") || "—"],
    ["Status", epc.status ?? "—"],
  ];
}

// Credit Fair email body — the applicant-detail table Credit Fair asked for.
// Used ONLY to compose the Credit Fair email (send-to-lender); the attached
// summary.xlsx stays the general layout above for every lender.
//   Notes: Project Value == Loan amount required (same figure); Merchant ID is
//   blank for Credit Fair; Address statuses default to "Owned".
export function creditFairEmailRows(loan: Record<string, any>): Array<[string, string]> {
  const name = loan.borrower_name || loan.aadhaar_name || "—";
  return [
    ["Name", name],
    ["DOB", ddmmyyyy(loan.aadhaar_dob)],
    ["Mobile number", loan.borrower_mobile ? `+91 ${loan.borrower_mobile}` : "—"],
    ["Email", loan.borrower_email ?? "—"],
    ["PAN", loan.borrower_pan ?? "—"],
    ["Monthly income", rupees(loan.monthly_income)],
    ["Project Value", rupees(loan.loan_amount_required)],
    ["Loan amount required", rupees(loan.loan_amount_required)],
    ["Product", loan.system_type ? (SYSTEM_LABEL[loan.system_type] ?? loan.system_type) : "—"],
    ["Tenure", loan.selected_tenure_years ? `${loan.selected_tenure_years} years` : "—"],
    ["Profession", loan.profession === "Other" && loan.profession_other ? `Other — ${loan.profession_other}` : (loan.profession ?? "—")],
    ["Company Name", loan.organization_name ?? "—"],
    ["Solar installation address with City & Pincode & State", installAddress(loan)],
    ["Permanent Address", loan.borrower_address ?? loan.aadhaar_address ?? "—"],
    ["Installation Address Status", "Owned"],
    ["Permanent Address Status", "Owned"],
    ["Solar finance for", useTypeLabel(loan)],
    ["KW installation", kwOf(loan)],
    ["Monthly electricity bill", rupees(loan.monthly_bill_amount)],
    ["Merchant ID", ""], // blank for Credit Fair
  ];
}
