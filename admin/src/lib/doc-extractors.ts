// Server-only. Per-document Gemini extractors. Each pairs a strict JSON schema
// + a "copy only what's printed, else null" prompt with the shared geminiExtract
// helper and check-digit validation, and returns the SAME field shape the
// route's existing regex parser produces — so a route can swap Gemini in as the
// primary reader with the parser as a drop-in fallback. Every function returns
// null on ANY failure, so the route falls back cleanly and never breaks.
//
// Do NOT import from client code (pulls in gemini-extract → server env).

import { geminiExtract, type GeminiImage } from "./gemini-extract";
import { isValidPan, isValidGstin, isValidIfsc } from "./doc-validation";
import type { PanFields } from "./pan-parser";
import type { BankStatementFields } from "./bank-statement";
import type { ProformaFields, EbillFields } from "./loan-docs";

const STR = { type: "STRING", nullable: true } as const;
const NUM = { type: "NUMBER", nullable: true } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "OBJECT", properties });
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const n = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

// ── PAN card ────────────────────────────────────────────────────────────────
export async function geminiExtractPan(images: GeminiImage[]): Promise<PanFields | null> {
  const g = await geminiExtract<Partial<PanFields>>({
    images, label: "pan",
    schema: obj({ pan: STR, name: STR, father_name: STR, dob: STR }),
    prompt:
      "Read this Indian PAN card. Extract ONLY what is literally printed; if a field is not clearly present, return null — never guess or invent. " +
      "pan = the 10-character PAN (5 letters, 4 digits, 1 letter). name = the cardholder's name. father_name = the father's name. dob = date of birth exactly as printed.",
  });
  if (!g) return null;
  const pan = (g.pan || "").toUpperCase().replace(/\s/g, "") || null;
  const f: PanFields = {
    pan: isValidPan(pan) ? pan : null,
    name: s(g.name),
    father_name: s(g.father_name),
    dob: s(g.dob),
  };
  return f.pan || f.name ? f : null;
}

// ── GST registration certificate (REG-06) ───────────────────────────────────
export type GstResult = { gstin: string | null; legal_name: string | null; trade_name: string | null; address: string | null };
export async function geminiExtractGst(images: GeminiImage[]): Promise<GstResult | null> {
  const g = await geminiExtract<Partial<GstResult>>({
    images, label: "gst",
    schema: obj({ gstin: STR, legal_name: STR, trade_name: STR, address: STR }),
    prompt:
      "Read this Indian GST registration certificate (Form GST REG-06). Extract ONLY what is literally printed; if a field is absent, return null. " +
      "gstin = the 15-character GSTIN. legal_name = the Legal Name of Business. trade_name = the Trade Name (may be blank). " +
      "address = the Principal Place of Business address exactly as printed in English, ending with the 6-digit PIN.",
  });
  if (!g) return null;
  const gstin = (g.gstin || "").toUpperCase().replace(/\s/g, "") || null;
  const r: GstResult = {
    gstin: isValidGstin(gstin) ? gstin : null,
    legal_name: s(g.legal_name),
    trade_name: s(g.trade_name),
    address: s(g.address),
  };
  return r.gstin || r.legal_name ? r : null;
}

// ── Bank statement / passbook / cheque ──────────────────────────────────────
export async function geminiExtractBankStatement(images: GeminiImage[]): Promise<BankStatementFields | null> {
  const g = await geminiExtract<Partial<BankStatementFields>>({
    images, label: "bank",
    schema: obj({ account_holder: STR, bank_name: STR, account_no: STR, ifsc: STR, account_type: STR, mobile: STR, email: STR }),
    prompt:
      "Read this Indian bank statement / passbook / cancelled cheque. Extract ONLY what is literally printed; if a field is absent, return null. " +
      "account_holder = the name the account is held in. bank_name = the bank's name. account_no = the account number (digits only). " +
      "ifsc = the 11-character IFSC (4 letters, then 0, then 6 alphanumerics). account_type = Savings or Current if shown. " +
      "mobile = a 10-digit mobile number if shown. email = an email if shown.",
  });
  if (!g) return null;
  const ifsc = (g.ifsc || "").toUpperCase().replace(/\s/g, "") || null;
  const mobile = (g.mobile || "").replace(/\D/g, "");
  const f: BankStatementFields = {
    account_holder: s(g.account_holder),
    bank_name: s(g.bank_name),
    account_no: (g.account_no || "").replace(/\s/g, "") || null,
    ifsc: isValidIfsc(ifsc) ? ifsc : null,
    account_type: s(g.account_type),
    mobile: mobile.length >= 10 ? mobile.slice(-10) : null,
    email: s(g.email),
  };
  return f.account_no || f.ifsc || f.account_holder ? f : null;
}

// ── Proforma invoice / quotation ────────────────────────────────────────────
export async function geminiExtractProforma(images: GeminiImage[]): Promise<ProformaFields | null> {
  const g = await geminiExtract<{ total_project_cost?: unknown; project_size?: unknown; project_size_unit?: unknown }>({
    images, label: "proforma",
    schema: obj({ total_project_cost: NUM, project_size: NUM, project_size_unit: STR }),
    prompt:
      "Read this solar proforma invoice / quotation. Extract ONLY what is literally printed; if a field is absent, return null. " +
      "total_project_cost = the total project cost in rupees as a plain number (no currency symbol or commas). " +
      "project_size = the solar system size as a plain number. project_size_unit = 'kw' or 'mw'.",
  });
  if (!g) return null;
  const size = n(g.project_size);
  const unitStr = s(g.project_size_unit);
  const f: ProformaFields = {
    total_project_cost: n(g.total_project_cost),
    project_size: size,
    project_size_unit: unitStr ? (/m/i.test(unitStr) ? "mw" : "kw") : (size != null ? "kw" : null),
  };
  return f.total_project_cost != null || f.project_size != null ? f : null;
}

// ── GSTR-3B return ───────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Indian FY quarters.
function quarterOf(monthIdx: number): string | null {
  if (monthIdx >= 3 && monthIdx <= 5) return "Apr-Jun";
  if (monthIdx >= 6 && monthIdx <= 8) return "Jul-Sep";
  if (monthIdx >= 9 && monthIdx <= 11) return "Oct-Dec";
  if (monthIdx >= 0 && monthIdx <= 2) return "Jan-Mar";
  return null;
}
export type GstR3bResult = {
  gstin: string | null; legal_name: string | null; trade_name: string | null;
  total_taxable_value: number | null;
  month: string | null; quarter: string | null; year: number | null; period_raw: string | null;
};
export async function geminiExtractGstR3b(images: GeminiImage[]): Promise<GstR3bResult | null> {
  const g = await geminiExtract<{ gstin?: unknown; legal_name?: unknown; trade_name?: unknown; total_taxable_value?: unknown; month?: unknown; year?: unknown }>({
    images, label: "gstr3b",
    schema: obj({ gstin: STR, legal_name: STR, trade_name: STR, total_taxable_value: NUM, month: STR, year: NUM }),
    prompt:
      "Read this Indian GSTR-3B return. Extract ONLY what is literally printed; if a field is absent, return null. " +
      "gstin = the 15-character GSTIN. legal_name = the Legal Name. trade_name = the Trade Name. " +
      "total_taxable_value = the Total Taxable Value of outward supplies for the period (Table 3.1) as a plain number. " +
      "month = the return-period month as a 3-letter English abbreviation (Jan, Feb, ..., Dec). year = the return-period 4-digit year.",
  });
  if (!g) return null;
  const gstin = (s(g.gstin) || "").toUpperCase().replace(/\s/g, "") || null;
  const monthStr = s(g.month);
  const monthIdx = monthStr ? MONTHS.findIndex((m) => monthStr.toLowerCase().startsWith(m.toLowerCase())) : -1;
  const month = monthIdx >= 0 ? MONTHS[monthIdx] : null;
  const yr = n(g.year);
  const year = yr && yr >= 2000 && yr < 2100 ? yr : null;
  const r: GstR3bResult = {
    gstin: isValidGstin(gstin) ? gstin : null,
    legal_name: s(g.legal_name),
    trade_name: s(g.trade_name),
    total_taxable_value: n(g.total_taxable_value),
    month,
    quarter: monthIdx >= 0 ? quarterOf(monthIdx) : null,
    year,
    period_raw: month && year ? `${month} ${year}` : null,
  };
  return r.gstin || r.total_taxable_value != null || r.month ? r : null;
}

// ── Electricity bill ────────────────────────────────────────────────────────
export async function geminiExtractEbill(images: GeminiImage[]): Promise<EbillFields | null> {
  const g = await geminiExtract<{ monthly_bill_amount?: unknown; discom_name?: unknown; ca_number?: unknown; pincode?: unknown; ebill_address_line?: unknown; ebill_name?: unknown }>({
    images, label: "ebill",
    schema: obj({ monthly_bill_amount: NUM, discom_name: STR, ca_number: STR, pincode: STR, ebill_address_line: STR, ebill_name: STR }),
    prompt:
      "Read this Indian electricity bill. Extract ONLY what is literally printed; if a field is absent, return null. " +
      "monthly_bill_amount = the current bill amount in rupees as a plain number. discom_name = the electricity provider (DISCOM) name. " +
      "ca_number = the consumer number / CA number / account number. pincode = the 6-digit PIN of the billing address. " +
      "ebill_address_line = the billing address. ebill_name = the name the bill is in.",
  });
  if (!g) return null;
  const pin = (s(g.pincode) || "").replace(/\D/g, "").slice(0, 6);
  const f: EbillFields = {
    monthly_bill_amount: n(g.monthly_bill_amount),
    discom_name: s(g.discom_name),
    ca_number: s(g.ca_number),
    pincode: pin.length === 6 ? pin : null,
    ebill_address_line: s(g.ebill_address_line),
    ebill_name: s(g.ebill_name),
  };
  return Object.values(f).some((v) => v != null) ? f : null;
}

// ── Invoice — final payable amount (insurance) ───────────────────────────────
export async function geminiExtractInvoice(images: GeminiImage[]): Promise<{ amount: number | null } | null> {
  const g = await geminiExtract<{ amount?: unknown }>({
    images, label: "invoice",
    schema: obj({ amount: NUM }),
    prompt:
      "Read this invoice. Extract ONLY what is literally printed; if absent, return null. " +
      "amount = the final total invoice amount payable, in rupees, as a plain number (no currency symbol or commas).",
  });
  if (!g) return null;
  const amount = n(g.amount);
  return amount != null ? { amount } : null;
}

// ── Insurance policy period ──────────────────────────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export async function geminiExtractPolicy(images: GeminiImage[]): Promise<{ from: string | null; to: string | null } | null> {
  const g = await geminiExtract<{ from?: unknown; to?: unknown }>({
    images, label: "policy",
    schema: obj({ from: STR, to: STR }),
    prompt:
      "Read this insurance policy document. Find the policy period (period of insurance). " +
      "Return each date in strict YYYY-MM-DD format; if a date is absent, return null. " +
      "from = the policy start date. to = the policy end / expiry date.",
  });
  if (!g) return null;
  const norm = (v: unknown) => { const x = s(v); return x && ISO_DATE.test(x) ? x : null; };
  const from = norm(g.from);
  const to = norm(g.to);
  return from || to ? { from, to } : null;
}
