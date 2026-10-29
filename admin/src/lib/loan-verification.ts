// Loan "Checks" panel — pure rules over the loan row the profile already loads
// (no IO). Each check reads saved fields only and reuses the shared helpers
// (name-match, loan-roles, dates, doc-validation, loan-doc-checklist), so the
// panel costs no extra request. Data we never captured reads "na" (Not on file),
// never "fail", so the passed/failed count isn't noise.

import { namesLikelySame, nameReadable } from "./name-match";
import { isBillOwner } from "./loan-roles";
import { ageRange, parseDob } from "./dates";
import { isValidAadhaar, isValidIfsc, isValidPan } from "./doc-validation";
import { loanDocChecklist } from "./loan-doc-checklist";

export type CheckStatus = "pass" | "partial" | "fail" | "na";
export type LoanCheck = { key: string; label: string; status: CheckStatus; value: string };

// Applicant's age when the loan ends must not cross this.
export const MAX_AGE_AT_LOAN_END = 60;

type Loan = Record<string, any>;

const pinOf = (s: unknown): string | null => {
  const all = String(s ?? "").match(/\b[1-9]\d{5}\b/g);
  return all ? all[all.length - 1] : null;
};

/** Applicant / co-applicant names as on file — Aadhaar first. */
export function loanNames(l: Loan): { applicant: string; coapp: string } {
  return {
    applicant: String(l.aadhaar_name || l.borrower_name || "").trim(),
    coapp: l.bill_on_applicant_name === false ? String(l.coapp_aadhaar_name || l.coapp_name || "").trim() : "",
  };
}

function tenureYears(l: Loan): number | null {
  const ad = (l.approval_details ?? {}) as Record<string, unknown>;
  const t = Number(ad.approved_tenure_years ?? ad.applied_tenure_years ?? l.selected_tenure_years ?? (l.tenure_months ? Number(l.tenure_months) / 12 : NaN));
  return Number.isFinite(t) && t > 0 ? t : null;
}

export function loanChecks(
  l: Loan,
  docCategories: string[],
  opts: { approved: boolean; decided: boolean; duplicates: number | null },
): LoanCheck[] {
  const out: LoanCheck[] = [];
  const add = (key: string, label: string, status: CheckStatus, value = "") => out.push({ key, label, status, value });
  const { applicant, coapp } = loanNames(l);
  const hasCoapp = l.bill_on_applicant_name === false;

  // 1. Required documents (same rule as the Doc Sent gate and the table badge).
  const docs = loanDocChecklist(l, docCategories);
  const have = docs.filter((d) => d.ok).length;
  add("docs", "Documents", have === docs.length ? "pass" : "fail", `${have}/${docs.length}`);

  // 2. The electricity-bill owner is on the file (applicant, or co-applicant).
  if (!String(l.ebill_name ?? "").trim()) add("bill", "Electricity bill owner", "na", "Not on file");
  else if (!nameReadable(l.ebill_name)) add("bill", "Electricity bill owner", "partial", "Unreadable");
  else if (isBillOwner({ aadhaarName: applicant }, l.ebill_name)) add("bill", "Electricity bill owner", "pass", "Applicant");
  else if (!hasCoapp) add("bill", "Electricity bill owner", "fail", "No co-applicant");
  else if (isBillOwner({ aadhaarName: coapp }, l.ebill_name) !== false) add("bill", "Electricity bill owner", "pass", "Co-applicant");
  else add("bill", "Electricity bill owner", "partial", "Name differs");

  // 3. Father's name on PAN vs S/O on Aadhaar (W/O carries the husband's name).
  const father = String(l.borrower_father_name ?? "").trim();
  const careOf = String(l.aadhaar_care_of ?? "").trim();
  if (!father || !careOf) add("father", "Father's name", "na", "Not on file");
  else if (/^\s*w\s*\/?\s*o\b/i.test(careOf)) add("father", "Father's name", "partial", "W/O on Aadhaar");
  else add("father", "Father's name", namesLikelySame(father, careOf) ? "pass" : "fail", namesLikelySame(father, careOf) ? "" : "Differs");

  // 4. Date of birth on file vs Aadhaar.
  const dobFile = parseDob(l.borrower_dob);
  const dobAadhaar = parseDob(l.aadhaar_dob);
  if (!dobFile?.year || !dobAadhaar?.year) add("dob", "Date of birth", "na", "Not on file");
  else if (!dobAadhaar.iso || !dobFile.iso) add("dob", "Date of birth", dobFile.year === dobAadhaar.year ? "partial" : "fail", dobFile.year === dobAadhaar.year ? "Year only" : "Differs");
  else add("dob", "Date of birth", dobFile.iso === dobAadhaar.iso ? "pass" : "fail", dobFile.iso === dobAadhaar.iso ? "" : "Differs");

  // 5. Aadhaar PIN vs installation PIN — a different address is often genuine,
  // so a mismatch is "partial", never "fail".
  const pinA = pinOf(l.aadhaar_address);
  const pinS = String(l.install_pincode ?? "").trim();
  if (!pinA || !pinS) add("pin", "Address PIN", "na", "Not on file");
  else if (pinA === pinS) add("pin", "Address PIN", "pass", pinS);
  else add("pin", "Address PIN", "partial", pinA.slice(0, 3) === pinS.slice(0, 3) ? "Same district" : "Different");

  // 6. Bank account holder.
  const holder = String(l.bank_account_holder ?? "").trim();
  if (!nameReadable(holder)) add("bank", "Bank account holder", "na", "Not on file");
  else if (namesLikelySame(applicant, holder)) add("bank", "Bank account holder", "pass", "Applicant");
  else if (coapp && namesLikelySame(coapp, holder)) add("bank", "Bank account holder", "partial", "Co-applicant");
  else add("bank", "Bank account holder", "fail", "Differs");

  // 7. ID number formats (PAN holder-type, Aadhaar check digit, IFSC).
  const ids: Array<[string, unknown, (v: string) => boolean]> = [
    ["PAN", l.borrower_pan, isValidPan],
    ["Aadhaar", l.aadhaar_number, isValidAadhaar],
    ["IFSC", l.bank_ifsc, isValidIfsc],
    ...(hasCoapp ? [["Co-applicant PAN", l.coapp_pan, isValidPan] as [string, unknown, (v: string) => boolean]] : []),
  ];
  const present = ids.filter(([, v]) => String(v ?? "").trim());
  const bad = present.filter(([, v, ok]) => !ok(String(v)));
  if (!present.length) add("ids", "ID numbers", "na", "Not on file");
  else add("ids", "ID numbers", bad.length ? "fail" : "pass", bad.map(([n]) => n).join(", "));

  // 8. Loan within the project cost.
  const loanAmt = Number(l.loan_amount_required);
  const cost = Number(l.total_project_cost);
  if (!(loanAmt > 0) || !(cost > 0)) add("ltv", "Loan within project cost", "na", "Not on file");
  else add("ltv", "Loan within project cost", loanAmt <= cost ? "pass" : "fail", `${Math.round((loanAmt / cost) * 100)}%`);

  // 9. Age when the loan ends (an exact DOB beats a year-only one).
  const a = ageRange(l.aadhaar_dob);
  const b = ageRange(l.borrower_dob);
  const age = (a && a.min === a.max ? a : null) || (b && b.min === b.max ? b : null) || a || b;
  const t = tenureYears(l);
  if (!age || t == null) add("age", "Age at loan end", "na", "Not on file");
  else {
    const lo = Math.floor(age.min + t), hi = Math.floor(age.max + t);
    const shown = lo === hi ? `${hi}` : `${lo}–${hi}`;
    add("age", "Age at loan end", hi <= MAX_AGE_AT_LOAN_END ? "pass" : lo > MAX_AGE_AT_LOAN_END ? "fail" : "partial", shown);
  }

  // 10. Customer consent.
  add("consent", "Consent", l.consent_at ? "pass" : "fail", l.consent_at ? "" : "Not recorded");

  // 11. Sanction letter / credit score — only once a lender has decided.
  if (opts.approved) {
    const hasLetter = docCategories.includes("sanction_letter");
    add("sanction", "Sanction letter", hasLetter ? "pass" : l.sanction_letter_unavailable ? "partial" : "fail", hasLetter ? "" : l.sanction_letter_unavailable ? "Not available" : "Pending");
  }
  if (opts.decided) add("credit", "Credit score", l.credit_score != null ? "pass" : "na", l.credit_score != null ? String(l.credit_score) : "Not on file");

  // 12. Same mobile / PAN / K number on another application.
  if (opts.duplicates != null) add("dup", "Duplicate application", opts.duplicates ? "fail" : "pass", opts.duplicates ? `${opts.duplicates} found` : "None");

  return out;
}
