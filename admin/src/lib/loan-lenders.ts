// Per-application, per-lender status + approval details (migration 0063,
// table loan_application_lenders). One row per (application, lender). Each row
// carries that lender's own timeline (docs-sent / approved / rejected) and its
// own approval details, so multiple lenders can decide independently and the
// dashboard headline is derived from the most-recent event across all of them.

export type LoanLenderRow = {
  id: string;
  application_id: string;
  lender_key: string;
  lender_label: string;
  docs_sent_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  // Full approval-details object (same shape as epc_applications.approval_details).
  approval_details: Record<string, unknown> | null;
  approval_recorded_at: string | null;
};

export const LOAN_LENDER_COLS =
  "id, application_id, lender_key, lender_label, docs_sent_at, approved_at, rejected_at, rejection_reason, approval_details, approval_recorded_at";

// The three default lenders; the picker also lets an admin type-to-add more.
export const DEFAULT_LOAN_LENDERS: { key: string; label: string }[] = [
  { key: "aerem", label: "Aerem" },
  { key: "creditfair", label: "Credit Fair" },
  { key: "solfin", label: "Solfin" },
];

export function slugifyLender(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export type LenderState = "none" | "docs" | "approved" | "rejected";
export function lenderStateOf(r: LoanLenderRow): LenderState {
  if (r.rejected_at) return "rejected";
  if (r.approved_at) return "approved";
  if (r.docs_sent_at) return "docs";
  return "none";
}

// The single most-recent event across ALL lenders — drives the headline status
// shown on the dashboard table and the profile badge (spec 6h).
export type LatestStatus =
  | { kind: "docs" | "approved" | "rejected"; lenderKey: string; lenderLabel: string; at: string }
  | null;

export function latestLenderStatus(rows: LoanLenderRow[]): LatestStatus {
  let best: LatestStatus = null;
  for (const r of rows) {
    const events: Array<{ kind: "docs" | "approved" | "rejected"; at: string | null }> = [
      { kind: "rejected", at: r.rejected_at },
      { kind: "approved", at: r.approved_at },
      { kind: "docs", at: r.docs_sent_at },
    ];
    for (const e of events) {
      if (e.at && (!best || e.at > best.at)) {
        best = { kind: e.kind, lenderKey: r.lender_key, lenderLabel: r.lender_label, at: e.at };
      }
    }
  }
  return best;
}

export function latestStatusLabel(s: LatestStatus): string | null {
  if (!s) return null;
  const verb = s.kind === "docs" ? "Doc sent to" : s.kind === "approved" ? "Approved by" : "Rejected by";
  return `${verb} ${s.lenderLabel}`;
}

// Lenders that have at least been sent docs (candidates for approve/reject).
export function lendersWithDocs(rows: LoanLenderRow[]): LoanLenderRow[] {
  return rows.filter((r) => r.docs_sent_at != null);
}

// Lenders that have approval details recorded (for the "Approved By" dropdown).
export function approvedLenders(rows: LoanLenderRow[]): LoanLenderRow[] {
  return rows.filter((r) => r.approved_at != null);
}
