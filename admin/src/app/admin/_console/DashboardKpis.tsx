"use client";

// Admin console — KPI strip under the header (main admin only): loan money
// figures on the Loan-applications tab, EPC stage counts on the EPCs tab.

import { useMemo } from "react";
import { remainingAmount, firstCharges } from "@/lib/disbursement";
import { KpiTile } from "@/components/view/ViewKit";
import { inPeriod, type Period } from "./console-period";

// Loan KPIs show on the Loan-applications tab ONLY, driven by the SAME period
// as the tab's PeriodPicker — so the strip always agrees with the cards + list
// below it. No query of its own: the figures come from the Loan tab's
// already-loaded list (AppsTab → onRows) and are recomputed locally when the
// period changes. Every tile shows the amount + the number of files: Pipeline
// value (in-progress files only — not yet approved / disbursed; Current Month
// only), Approved loan amount, 1st tranche disbursed, 2nd tranche pending
// (sanctioned − 1st). The EPC tab shows
// EPC stage counts, fed by EpcsTab's own period-scoped cards (no extra query).
export type EpcKpis = { total: number; unseen: number; docsSent: number; lenderApproved: number; approved: number; rejected: number };
// The loan-list columns the KPIs read (AppsTab's rows carry all of them).
export type KpiRow = {
  status: string | null;
  loan_amount_required: number | null; loan_amount: number | null; sanctioned_amount: number | null;
  first_disbursement_amount: number | null; second_disbursement_amount: number | null;
  first_disbursement_date: string | null;
  first_processing_fee?: number | null; first_legal_charges?: number | null; first_cersai_charges?: number | null;
  created_at: string | null; aborted_at: string | null;
};
// Each KPI = total amount + number of files.
type KpiFig = { amount: number; files: number };
type KpiData = { pipeline: KpiFig; approved: KpiFig; firstTranche: KpiFig; secondPending: KpiFig };
const KPI_APPROVED = new Set(["approved", "rfd", "sent_to_nbfc", "disbursed"]);

export default function DashboardKpis({ tab, period, pFrom, pTo, epc, loans: rows }: { tab: string; period: Period; pFrom: string; pTo: string; epc: EpcKpis | null; loans: KpiRow[] | null }) {
  const d = useMemo<KpiData | null>(() => {
    if (!rows) return null;
    const num = (v: unknown) => Number(v) || 0;
    const inP = (s: string | null) => inPeriod(s, period, pFrom, pTo);
    const fig = (list: KpiRow[], amt: (r: KpiRow) => number): KpiFig =>
      ({ amount: list.reduce((s, r) => s + amt(r), 0), files: list.length });
    const applied = (r: KpiRow) => num(r.loan_amount_required) || num(r.loan_amount);
    // Application-level metrics are scoped by created_at (same as every card +
    // table on this tab); the 1st tranche is scoped by its disbursement date, so
    // "disbursed in this period" means money that actually went out.
    const created = rows.filter((r) => inP(r.created_at) && !r.aborted_at);
    const approvedRows = created.filter((r) => r.first_disbursement_amount != null || KPI_APPROVED.has(r.status ?? ""));
    // In progress = submitted and still moving: not approved, not disbursed, not rejected.
    const inProgress = created.filter((r) => r.status !== "draft" && r.status !== "rejected" && !approvedRows.includes(r));
    // 1st tranche released, 2nd still pending — mirrors the EPC portal tile.
    const secondPending = created.filter((r) => r.first_disbursement_amount != null && r.second_disbursement_amount == null);
    return {
      pipeline: fig(inProgress, applied),
      approved: fig(approvedRows, (r) => num(r.sanctioned_amount) || applied(r)),
      firstTranche: fig(rows.filter((r) => r.first_disbursement_amount != null && inP(r.first_disbursement_date)), (r) => num(r.first_disbursement_amount)),
      secondPending: fig(secondPending, (r) => remainingAmount(r.sanctioned_amount, r.first_disbursement_amount, firstCharges(r)) ?? 0),
    };
  }, [rows, period, pFrom, pTo]);

  if (tab === "epcs") {
    if (!epc) return null;
    return (
      <div className="mb-4 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label="Total EPCs" value={String(epc.total)} accent="#178a5c" />
        <KpiTile label="Application unseen" value={String(epc.unseen)} accent="#94a3b8" />
        <KpiTile label="Docs sent to lender" value={String(epc.docsSent)} accent="#185fa5" />
        <KpiTile label="Approved by lender" value={String(epc.lenderApproved)} accent="#178a5c" />
        <KpiTile label="Approved by Manish" value={String(epc.approved)} accent="#0f7a52" />
        <KpiTile label="Rejected by CC" value={String(epc.rejected)} accent="#dc2626" />
      </div>
    );
  }
  // Loan KPIs belong to the Loan-applications tab only.
  if (tab !== "apps" || !d) return null;
  const showPipeline = period === "month";
  const money = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : `₹${(v / 1e5).toFixed(1)} L`);
  const files = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;
  return (
    <div className={"mb-4 grid gap-2 grid-cols-2 " + (showPipeline ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      {showPipeline && <KpiTile label="Pipeline value" value={money(d.pipeline.amount)} sub={files(d.pipeline.files)} accent="#178a5c" />}
      <KpiTile label="Approved loan amount" value={money(d.approved.amount)} sub={files(d.approved.files)} accent="#0f7a52" />
      <KpiTile label="1st tranche disbursed" value={money(d.firstTranche.amount)} sub={files(d.firstTranche.files)} accent="#185fa5" />
      <KpiTile label="2nd tranche pending" value={money(d.secondPending.amount)} sub={files(d.secondPending.files)} accent={d.secondPending.files > 0 ? "#854f0b" : "#94a3b8"} />
    </div>
  );
}
