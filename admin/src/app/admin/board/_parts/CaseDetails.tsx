"use client";

// Task Manager — the side panel's EMI-confirmation view: a loan's applicant / loan / system details, or a short summary for other cases.

import type { OpsCase } from "@/lib/ops-board";
import { fmtRupees } from "@/lib/money";
import { SYSTEM_LABEL } from "@/lib/loan-labels";

// ── Side-panel detail form (loan cases) ──────────────────────────────────────
const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? fmtRupees(n) : "—"; };
const gridLabel = (s: unknown) => (s ? SYSTEM_LABEL[String(s)] ?? String(s) : "—");
const placeLabel = (s: unknown) => (s === "residential" ? "House (residential)" : s === "commercial" ? "Commercial" : "—");
// Columns fetched on demand when a loan card is opened.
export const DETAIL_COLS = "borrower_name, aadhaar_name, borrower_mobile, borrower_email, coapp_name, coapp_mobile, coapp_email, organization_name, total_project_cost, loan_amount_required, selected_tenure_years, project_size, project_size_unit, plant_use_type, system_type, central_subsidy, state_subsidy, bill_on_applicant_name";

// A stacked label-over-value field. Two sit side by side in the Section grid;
// long values (emails, business names) pass `wide` to span the full width.
function Field({ k, v, wide }: { k: string; v: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <div className="text-[10.5px] uppercase tracking-wide text-text-muted">{k}</div>
      <div className="text-[13px] font-semibold text-text break-words">{v || "—"}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-cc-muted mb-1.5">{title}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-text-muted">{k}</span><strong className="text-text">{v}</strong></div>;
}

export default function CaseDetails({ selCase, detail }: { selCase: OpsCase; detail: Record<string, any> | null }) {
  return selCase.source === "loan" ? (
    <div className="flex flex-col gap-1.5">
      {/* Operational context (not in the applicant form, kept for the RM). */}
      <div className="text-[13px] flex flex-col gap-1.5">
        <Row k="Lender" v={selCase.lender || "—"} />
        <Row k="Owner" v={selCase.ownerName || "Unassigned"} />
      </div>
      {detail === null ? (
        <div className="text-[12px] text-text-muted pt-2">Loading details…</div>
      ) : (
        <>
          <Section title="Applicant">
            <Field k="Applicant Name" v={detail.borrower_name || detail.aadhaar_name || selCase.name} />
            <Field k="App Mob No." v={detail.borrower_mobile ? `+91 ${detail.borrower_mobile}` : "—"} />
          </Section>
          {(detail.coapp_name || detail.bill_on_applicant_name === false) && (
            <Section title="Co-applicant">
              <Field k="Co-app Name" v={detail.coapp_name || "—"} />
              <Field k="Co-app Mob No" v={detail.coapp_mobile ? `+91 ${detail.coapp_mobile}` : "—"} />
              <Field k="Co-app email ID" v={detail.coapp_email || "—"} wide />
            </Section>
          )}
          <Section title="Business">
            <Field k="Employer / Business Name" v={detail.organization_name || "—"} wide />
          </Section>
          <Section title="Loan">
            <Field k="Project Cost" v={money(detail.total_project_cost)} />
            <Field k="Loan amount required" v={money(detail.loan_amount_required)} />
            <Field k="Loan Tenure" v={detail.selected_tenure_years ? `${detail.selected_tenure_years} year` : "—"} />
          </Section>
          <Section title="System">
            <Field k="Merchant Name" v={selCase.epcName || "—"} wide />
            <Field k="Capacity" v={detail.project_size ? `${detail.project_size} ${String(detail.project_size_unit || "kw").toUpperCase()}` : "—"} />
            <Field k="Place of Installation" v={placeLabel(detail.plant_use_type)} />
            <Field k="Subsidy" v={(Number(detail.central_subsidy) > 0 || Number(detail.state_subsidy) > 0) ? "Yes" : "No"} />
            <Field k="On-Grid / Off-grid" v={gridLabel(detail.system_type)} />
          </Section>
        </>
      )}
      {selCase.blocker && <div className="text-[12px] pt-1"><span className="text-text-muted">Blocker:</span> {selCase.blocker}</div>}
    </div>
  ) : (
    <div className="text-[13px] flex flex-col gap-1.5">
      <Row k="Amount" v={selCase.amount ? fmtRupees(selCase.amount) : "—"} />
      <Row k="Lender" v={selCase.lender || "—"} />
      <Row k="Owner" v={selCase.ownerName || "Unassigned"} />
      <Row k="Lead owner" v={selCase.leadOwnerName || "—"} />
      {selCase.blocker && <div><span className="text-text-muted">Blocker:</span> {selCase.blocker}</div>}
    </div>
  );
}
