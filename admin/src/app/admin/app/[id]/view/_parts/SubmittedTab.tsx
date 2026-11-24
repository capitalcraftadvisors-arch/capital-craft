"use client";

// Loan View · the Submitted stage: the application's detail cards (identity, site,
// loan, employment, bank, checks) on the left, every document on the right.

import { maskAcct } from "@/lib/epc-labels";
import { fmtRupees, pctOf } from "@/lib/money";
import { CATEGORY_LABEL } from "@/lib/loan-form";
import type { LoanCheck } from "@/lib/loan-verification";
import {
  I, ChecksPanel, DocGrid, FieldCol, FillCount, fillOf, Section, StepBlock,
  type FieldRow, type ViewDocSlot,
} from "@/components/view/ViewKit";
import { LOAN_STATUS_LABEL } from "./labels";
import { EMPLOYMENT_LABEL } from "@/lib/loan-labels";
import type { Loan, LoanDocGroup } from "./loan-docs";

// Another application with the same mobile / PAN / K number (Checks → Duplicate).
export type DupRow = {
  id: string; loan_display_id: string | null; aadhaar_name: string | null; borrower_name: string | null;
  status: string | null; aborted_at: string | null; created_at: string | null;
  borrower_mobile: string | null; borrower_pan: string | null; ca_number: string | null;
};

export default function SubmittedTab({
  loan, hasCoapp, kw, stacked, checks, dups, docGroups, toViewSlots, docsHave, docsTotal, trancheBusy, downloadTranche,
}: {
  loan: Loan; hasCoapp: boolean; kw: string | null; stacked: boolean;
  checks: LoanCheck[]; dups: DupRow[] | null;
  docGroups: LoanDocGroup[]; toViewSlots: (g: LoanDocGroup) => ViewDocSlot[];
  docsHave: number; docsTotal: number; trancheBusy: null | "1" | "2"; downloadTranche: (t: "1" | "2") => Promise<void>;
}) {
  // Checks → Duplicate: the other applications with the same mobile / PAN / K number.
  const dupList = dups && dups.length > 0 ? (
    <ul className="space-y-1">
      {dups.map((d) => {
        const why = [
          d.borrower_mobile && d.borrower_mobile === loan.borrower_mobile ? "Mobile" : null,
          d.borrower_pan && d.borrower_pan === loan.borrower_pan ? "PAN" : null,
          d.ca_number && d.ca_number === loan.ca_number ? "K No." : null,
        ].filter(Boolean).join(" · ");
        return (
          <li key={d.id} className="text-[12px]">
            <a href={`/admin/app/${d.id}/view`} target="_blank" rel="noopener" className="font-semibold text-cc-blue hover:underline">
              {d.loan_display_id ?? "—"}
            </a>
            <span className="text-cc-faint"> · {d.aadhaar_name || d.borrower_name || "—"} · {why} · {d.aborted_at ? "Aborted" : (LOAN_STATUS_LABEL[d.status ?? ""] ?? d.status)}</span>
          </li>
        );
      })}
    </ul>
  ) : null;

  // ── Submitted — every field, per column (optional ones don't count) ──
  const yesNo = (v: unknown) => (v == null ? null : v ? "Yes" : "No");
  const applicantRows: FieldRow[] = [
    { k: "Name", v: loan.aadhaar_name || loan.borrower_name },
    { k: "Lead owner", v: loan.lead_owner_name, optional: true },
    { k: "Father's name", v: loan.borrower_father_name },
    { k: "Gender", v: loan.aadhaar_gender },
    { k: "Date of birth", v: loan.aadhaar_dob },
    { k: "PAN", v: loan.borrower_pan, copy: loan.borrower_pan },
    { k: "Aadhaar", v: loan.aadhaar_number_masked },
    { k: "Email", v: loan.borrower_email, valueClass: "text-cc-blue", copy: loan.borrower_email },
    { k: "Phone no", v: loan.borrower_mobile ? `+91 ${loan.borrower_mobile}` : null, copy: loan.borrower_mobile },
    { k: "Earning", v: yesNo(loan.applicant_earning) },
    { k: "Monthly income", v: loan.monthly_income != null ? fmtRupees(loan.monthly_income) : null, optional: loan.applicant_earning !== true },
    { k: "Address", v: loan.aadhaar_address, wrap: true },
  ];
  const coappRows: FieldRow[] = hasCoapp ? [
    { k: "Name", v: loan.coapp_name },
    { k: "Father's name", v: loan.coapp_father_name },
    { k: "DOB", v: loan.coapp_dob },
    { k: "Relation", v: loan.coapp_relation },
    { k: "PAN", v: loan.coapp_pan, copy: loan.coapp_pan },
    { k: "Mobile", v: loan.coapp_mobile ? `+91 ${loan.coapp_mobile}` : null, copy: loan.coapp_mobile },
    { k: "Email", v: loan.coapp_email, copy: loan.coapp_email, optional: true },
    { k: "Earning", v: yesNo(loan.coapp_earning) },
    { k: "Monthly income", v: loan.coapp_monthly_income != null ? fmtRupees(loan.coapp_monthly_income) : null, optional: loan.coapp_earning !== true },
    { k: "Aadhaar name", v: loan.coapp_aadhaar_name },
    { k: "Aadhaar", v: loan.coapp_aadhaar_number_masked },
    { k: "Address", v: loan.coapp_aadhaar_address, wrap: true },
  ] : [];
  const gps = loan.rooftop_photo_gps as { lat?: number; lng?: number } | null;
  const siteRows: FieldRow[] = [
    { k: "Name on E-Bill", v: loan.ebill_name },
    { k: "Address", v: loan.ebill_address_line, wrap: true },
    { k: "Pincode", v: loan.install_pincode },
    { k: "City", v: loan.install_city },
    { k: "District", v: loan.install_district },
    { k: "State", v: loan.install_state },
    ...(gps ? [{ k: "Rooftop GPS", v: `${gps.lat?.toFixed?.(5) ?? "?"}, ${gps.lng?.toFixed?.(5) ?? "?"}`, optional: true }] : []),
  ];
  const loanRows: FieldRow[] = [
    { k: "Project size", v: kw },
    { k: "Project cost", v: fmtRupees(loan.total_project_cost) },
    {
      k: "Loan amount required",
      // With its share of the project cost — "₹1,60,000 (80% of project cost)".
      v: loan.loan_amount_required != null
        ? fmtRupees(loan.loan_amount_required) + (pctOf(loan.loan_amount_required, loan.total_project_cost) ? ` (${pctOf(loan.loan_amount_required, loan.total_project_cost)} of project cost)` : "")
        : null,
    },
    {
      k: "Down payment",
      v: loan.total_project_cost && loan.loan_amount_required
        ? fmtRupees(Math.max(0, Number(loan.total_project_cost) - Number(loan.loan_amount_required)))
        : null,
      optional: true,
    },
    { k: "Category", v: loan.connection_category ? CATEGORY_LABEL[loan.connection_category] ?? loan.connection_category : null },
    { k: "Monthly bill", v: fmtRupees(loan.monthly_bill_amount) },
    { k: "DISCOM", v: loan.discom_name },
    { k: "K Number", v: loan.ca_number, copy: loan.ca_number },
  ];
  const employmentRows: FieldRow[] = [
    { k: "Employment", v: loan.employment_type ? EMPLOYMENT_LABEL[loan.employment_type] ?? loan.employment_type : null },
    { k: "Organization", v: loan.organization_name, optional: loan.employment_type !== "salaried" },
    { k: "Profession", v: loan.profession === "Other" && loan.profession_other ? `Other — ${loan.profession_other}` : loan.profession, optional: loan.employment_type !== "self_employed" },
    { k: "Annual income", v: fmtRupees(loan.annual_income) },
  ];
  const bankRows: FieldRow[] = [
    { k: "Bank name", v: loan.bank_name },
    { k: "Account holder", v: loan.bank_account_holder },
    { k: "Account no", v: maskAcct(loan.bank_account_no), copy: loan.bank_account_no },
    { k: "IFSC code", v: loan.bank_ifsc, copy: loan.bank_ifsc },
    { k: "Type", v: loan.bank_account_type },
  ];
  const checksCounted = checks.filter((c) => c.status !== "na");
  const checksOk = checksCounted.filter((c) => c.status === "pass").length;

  return (
    <div className="grid gap-x-6 gap-y-4 pt-6 xl:grid-cols-2 items-start">
      <div className="flex flex-col gap-4 min-w-0">
        <Section card dropdown inline={stacked} icon={I.users} title="Identity" summary={fillOf(applicantRows, coappRows)}>
          <div className="grid gap-x-12 gap-y-6 md:grid-cols-2 xl:grid-cols-1">
            <FieldCol title="Applicant" rows={applicantRows} />
            <FieldCol title="Co-applicant" rows={coappRows}>
              {!hasCoapp && <p className="text-[14px] text-cc-empty py-[5px]">No co-applicant</p>}
            </FieldCol>
          </div>
        </Section>

        <Section card dropdown inline={stacked} icon={I.building} title="Installation site" summary={fillOf(siteRows)}>
          <FieldCol title="Installation site" rows={siteRows} />
        </Section>

        <Section card dropdown inline={stacked} icon={I.money} title="Loan requirement" summary={fillOf(loanRows)}>
          <FieldCol title="Loan requirement" rows={loanRows} />
        </Section>

        <Section card dropdown inline={stacked} icon={I.briefcase} title="Employment" summary={fillOf(employmentRows)}>
          <FieldCol title="Employment" rows={employmentRows} />
        </Section>

        <Section card dropdown inline={stacked} icon={I.bank} title="Bank details" summary={fillOf(bankRows)}>
          <FieldCol title="Bank details" rows={bankRows} />
        </Section>

        <Section card dropdown inline={stacked} icon={I.circleCheck} title="Checks" summary={<FillCount have={checksOk} total={checksCounted.length} />}>
          <ChecksPanel items={checks} extra={dupList ? { dup: dupList } : undefined} />
        </Section>
      </div>

      <div className="flex flex-col gap-4 min-w-0">
        <Section card white icon={I.files} title="Documents" summary={<FillCount have={docsHave} total={docsTotal} />}>
          <div className="space-y-3">
            {docGroups.map((g) => {
              // A tranche's Download button sits at the bottom of ITS group
              // and shows only once every slot in that tranche is uploaded.
              const complete = g.slots.length > 0 && g.slots.every((s) => !!s.docId || !!s.path);
              const tranche: "1" | "2" | null =
                g.title === "1st Tranche Docs" ? "1" : g.title === "2nd Tranche Docs" ? "2" : null;
              return (
                <StepBlock key={g.title} title={g.title}>
                  <DocGrid slots={toViewSlots(g)} eyeIcon={I.eye} />
                  {tranche && complete && (
                    <button
                      type="button"
                      disabled={trancheBusy !== null}
                      onClick={() => void downloadTranche(tranche)}
                      className="mt-3 text-[12px] font-semibold px-2.5 py-1.5 rounded-input inline-flex items-center gap-1.5 border border-cc-green/30 bg-white text-cc-green hover:bg-cc-wash disabled:opacity-50"
                    >
                      {I.download} {trancheBusy === tranche ? "Preparing…" : `Download Tranche ${tranche}`}
                    </button>
                  )}
                </StepBlock>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}
