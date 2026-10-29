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

// The lenders the portal works with live in ONE list — the lenders registry
// (migration 0055, kept in step with Stakeholders → Partners by 0107). Every
// screen and route reads it, so a lender added anywhere shows up everywhere.
export type Lender = { key: string; label: string };
// The original three: shown until the registry loads, or where it can't be
// read (EPC side — the registry is admin-only).
export const DEFAULT_LOAN_LENDERS: Lender[] = [
  { key: "aerem", label: "Aerem" },
  { key: "creditfair", label: "Credit Fair" },
  { key: "solfin", label: "Solfin" },
];

export function slugifyLender(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Any Supabase client — the browser's or a route's (the caller's JWT).
type Reader = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The active lenders, in their set order (falls back to the original three). */
export async function fetchLenders(client: Reader): Promise<Lender[]> {
  const { data, error } = await client.from("lenders").select("key, label").eq("is_active", true).order("sort_order").order("label");
  return !error && Array.isArray(data) && data.length ? (data as Lender[]) : DEFAULT_LOAN_LENDERS;
}

/** A lender key's name from a list, else the key itself. */
export function lenderLabelIn(list: Lender[], key: string | null | undefined): string {
  if (!key) return "";
  return list.find((l) => l.key === key)?.label ?? DEFAULT_LOAN_LENDERS.find((l) => l.key === key)?.label ?? key;
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
  // Rank by each lender's RESOLVED state, not by raw max-timestamp. A rejected
  // lender's row still carries docs_sent_at, and an admin can back-date the
  // rejection to BEFORE the docs date — so a pure max-timestamp pick wrongly
  // showed "Doc sent to X" for an already-rejected case. Significance order:
  // an approval is the outcome; else a lender still PENDING (docs sent, not yet
  // decided) keeps the case in progress; else a rejection. Newest within a kind.
  let approved: LatestStatus = null, pending: LatestStatus = null, rejected: LatestStatus = null;
  for (const r of rows) {
    const st = lenderStateOf(r);
    if (st === "approved" && r.approved_at) {
      if (!approved || r.approved_at > approved.at) approved = { kind: "approved", lenderKey: r.lender_key, lenderLabel: r.lender_label, at: r.approved_at };
    } else if (st === "rejected" && r.rejected_at) {
      if (!rejected || r.rejected_at > rejected.at) rejected = { kind: "rejected", lenderKey: r.lender_key, lenderLabel: r.lender_label, at: r.rejected_at };
    } else if (st === "docs" && r.docs_sent_at) {
      if (!pending || r.docs_sent_at > pending.at) pending = { kind: "docs", lenderKey: r.lender_key, lenderLabel: r.lender_label, at: r.docs_sent_at };
    }
  }
  return approved || pending || rejected;
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
