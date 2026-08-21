// Unified "Task Manager" case model. Fetches the four case sources — loan
// applications, insurance, loan leads, and in-progress EPC onboarding — and
// normalizes each into an OpsCase. Each SOURCE has its OWN column set (its own
// pipeline stages); the mixed "All" view maps every case onto a shared unified
// column set. Read-scoping is enforced by RLS (0067/0068) for the three money
// tables; epc_business is shared infra, so EPC cases are filtered to the RM
// client-side.
//
// Client-only (uses the browser supabase() client + the logged-in session).

import { supabase } from "./supabase";
import { getBusiness } from "./auth";

export type CaseSource = "loan" | "insurance" | "lead" | "epc";
export type ColumnDef = { key: string; label: string };

// ── Per-source column sets (the pipeline stages shown for each dashboard) ──
const EPC_COLS: ColumnDef[] = [
  { key: "unseen", label: "Application Unseen" },
  { key: "doc_uploaded", label: "Doc Uploaded" },
  { key: "docs_pending", label: "Docs Pending" },
  { key: "review_cc", label: "Review by CC" },
  { key: "send_lender", label: "Send to Lender" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];
const LOAN_COLS: ColumnDef[] = [
  { key: "ready_login", label: "Ready for Login" },
  { key: "send_lender", label: "Send to Lender" },
  { key: "docs_pending", label: "Docs Pending" },
  { key: "approved_rejected", label: "Approved / Rejected" },
  { key: "phase1", label: "1st Phase" },
  { key: "abort", label: "Abort" },
];
const INSURANCE_COLS: ColumnDef[] = [
  { key: "docs", label: "Doc collection" },
  { key: "docs_pending", label: "Docs Pending" },
  { key: "review", label: "Under Review" },
  { key: "issued", label: "Issued" },
  { key: "rejected", label: "Rejected" },
];
const LEAD_COLS: ColumnDef[] = [
  { key: "new", label: "New Lead" },
  { key: "review", label: "In Review" },
  { key: "converted", label: "Converted" },
];
// Mixed "All" view (kept for overseers): a source-agnostic pipeline.
const ALL_COLS: ColumnDef[] = [
  { key: "docs", label: "Doc collection" },
  { key: "pending", label: "Docs pending" },
  { key: "review", label: "Review / decision" },
  { key: "lender", label: "Sent to lender" },
  { key: "approved", label: "Approved" },
  { key: "phase1", label: "1st phase" },
  { key: "phase2", label: "2nd phase" },
];

export function columnsFor(src: CaseSource | "all"): ColumnDef[] {
  return src === "epc" ? EPC_COLS : src === "loan" ? LOAN_COLS : src === "insurance" ? INSURANCE_COLS : src === "lead" ? LEAD_COLS : ALL_COLS;
}

export const SOURCE_META: Record<CaseSource, { label: string; color: string; tint: string }> = {
  loan:      { label: "Loan",      color: "#178a5c", tint: "#e7f5ee" },
  insurance: { label: "Insurance", color: "#0e7490", tint: "#e0f2f4" },
  lead:      { label: "Lead",      color: "#4338ca", tint: "#e8e7fb" },
  epc:       { label: "EPC",       color: "#185fa5", tint: "#e8f1fb" },
};

export type OpsCase = {
  id: string;
  source: CaseSource;
  name: string;
  amount: number;
  ownerUserId: string | null;
  ownerName: string | null;
  lender: string | null;
  statusLabel: string;
  column: string | null;     // key within the source's own column set (null = off that board)
  allColumn: string | null;  // key within ALL_COLS (null = off the mixed board)
  outcome: "approved" | "rejected" | null; // for card tint + sinking rejected to the bottom
  stageHours: number; // hours since the case entered its CURRENT stage (drives per-column outline)
  tatDays: number;    // total days worked on this case, from "ready for login" (creation)
  idleDays: number;
  onHold: boolean;
  blocker: string | null;
  disbursed: number;
  disbursedThisMonthAt: string | null;
  href: string;
};

export type TeamUser = { id: string; name: string; role: string | null; parentUserId: string | null };

const DAY = 86400000;
function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / DAY));
}
function hoursSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3600000);
}
// Is `iso` within the current calendar month? (rejected loans age out at month-end.)
function inCurrentMonth(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso), now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}
const num = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);

// ── Per-source placement → the source's own column key ──
// Columns: ready_login → send_lender → docs_pending → approved_rejected →
// phase1 (1st disbursement) → abort. `stageSince` is when the case entered its
// current stage (drives the per-column outline colour).
function loanColumn(r: Record<string, any>, lenderMidDecision: boolean): { column: string | null; label: string; stageSince: string | null } {
  const s = r.status as string;
  // Aborted files live in their own column.
  if (r.aborted_at) return { column: "abort", label: "Aborted", stageSince: r.aborted_at };
  // Rejected: shown only within the calendar month it was rejected, then it ages
  // off the board automatically (approved files carry forward, rejected don't).
  if (s === "rejected") {
    const at = r.rejected_at || r.updated_at;
    return inCurrentMonth(at) ? { column: "approved_rejected", label: "Rejected by lender", stageSince: at } : { column: null, label: "Rejected (aged out)", stageSince: at };
  }
  // Disbursement stage (1st Phase). Drops off once the 2nd tranche is filled.
  if (s === "rfd" || s === "approved" || s === "sent_to_nbfc" || s === "disbursed") {
    if (r.first_disbursement_amount != null) {
      if (r.second_disbursement_amount != null) return { column: null, label: "Fully disbursed", stageSince: r.second_disbursement_date };
      return { column: "phase1", label: "1st disbursed · 2nd pending", stageSince: r.first_disbursement_date || r.rfd_at };
    }
    if (s === "rfd" || r.rfd_at != null) return { column: "phase1", label: "Ready for 1st disbursement", stageSince: r.rfd_at || r.approved_at };
    return { column: "approved_rejected", label: "Approved by lender", stageSince: r.approved_at || r.updated_at };
  }
  if (s === "docs_sent") return { column: "send_lender", label: lenderMidDecision ? "With lender — deciding" : "Sent to lender", stageSince: r.docs_sent_at || r.updated_at };
  if (s === "on_hold") return { column: "docs_pending", label: "Docs pending", stageSince: r.hold_at || r.updated_at };
  // draft / submitted / under_review → ready for login
  return { column: "ready_login", label: "Ready for login", stageSince: r.submitted_at || r.created_at || r.updated_at };
}

function epcColumn(r: Record<string, any>, lender: { docs: boolean; approved: boolean; rejected: boolean }): { column: string | null; label: string } {
  const s = r.status as string;
  if (s === "rejected" || lender.rejected) return { column: "rejected", label: "Rejected" };
  if (s === "approved" || lender.approved) return { column: "approved", label: "Approved" };
  if (lender.docs) return { column: "send_lender", label: "Sent to lender" };
  if (s === "on_hold") return { column: "docs_pending", label: "Docs pending" };
  if (s === "under_review") return { column: "review_cc", label: "Review by CC" };
  // draft: early = unseen, advanced (docs uploaded) = doc_uploaded
  if (s === "draft") return num(r.current_step) > 1 ? { column: "doc_uploaded", label: "Doc uploaded" } : { column: "unseen", label: "Application unseen" };
  return { column: "unseen", label: "Application unseen" };
}

function insuranceColumn(status: string): { column: string | null; label: string } {
  switch (status) {
    case "draft": return { column: "docs", label: "Draft" };
    case "under_review": return { column: "review", label: "Under review" };
    case "hold": return { column: "docs_pending", label: "Docs pending" };
    case "issued": return { column: "issued", label: "Policy issued" };
    case "rejected": return { column: "rejected", label: "Rejected" };
    default: return { column: "docs", label: status || "—" };
  }
}

function leadColumn(status: string): { column: string | null; label: string } {
  switch (status) {
    case "draft": return { column: "new", label: "New lead" };
    case "under_review": return { column: "review", label: "In review" };
    case "converted": return { column: "converted", label: "Converted to loan" };
    default: return { column: "new", label: status || "—" };
  }
}

// ── Unified "All" placement (mixed view) — off-board for terminal states ──
function allColumnFor(source: CaseSource, srcCol: string | null, r: Record<string, any>): string | null {
  if (srcCol == null) return null;
  if (source === "loan") {
    if (r.status === "rejected" || r.aborted_at) return null;
    return { ready_login: "docs", docs_pending: "pending", send_lender: "lender", approved_rejected: "approved", phase1: "phase1", phase2: "phase2" }[srcCol] ?? "docs";
  }
  if (source === "epc") {
    if (srcCol === "rejected") return null;
    return { unseen: "docs", doc_uploaded: "docs", docs_pending: "pending", review_cc: "review", send_lender: "lender", approved: "approved" }[srcCol] ?? "docs";
  }
  if (source === "insurance") {
    if (srcCol === "rejected") return null;
    return { docs: "docs", docs_pending: "pending", review: "review", issued: "phase2" }[srcCol] ?? "docs";
  }
  if (source === "lead") {
    if (srcCol === "converted") return null;
    return { new: "docs", review: "review" }[srcCol] ?? "docs";
  }
  return "docs";
}

function loanLenderLabel(rows: Record<string, any>[]): string | null {
  if (!rows.length) return null;
  const pick = rows.find((r) => r.approved_at) || rows.find((r) => r.docs_sent_at) || rows[0];
  return (pick.lender_label || pick.lender_key || null) as string | null;
}

export async function loadOpsCases(): Promise<{ cases: OpsCase[]; users: TeamUser[] }> {
  const db = supabase();
  const me = getBusiness();
  const isRm = me?.role === "OPERATIONS_USER";
  const myId = me?.id ?? null;

  const [loans, lenders, insurance, leads, epcs, epcLenders, team] = await Promise.all([
    db.from("epc_applications").select("id, borrower_name, aadhaar_name, loan_amount, loan_amount_required, status, created_at, submitted_at, docs_sent_at, hold_at, approved_at, rejected_at, rfd_at, first_disbursement_amount, second_disbursement_amount, first_disbursement_date, second_disbursement_date, aborted_at, updated_at, review_notes, assigned_to_user_id"),
    db.from("loan_application_lenders").select("application_id, lender_key, lender_label, docs_sent_at, approved_at, rejected_at"),
    db.from("insurance_applications").select("id, aadhaar_name, sum_insured, invoice_confirmed_amount, invoice_amount, insurance_partner, status, updated_at, assigned_to_user_id"),
    db.from("loan_leads").select("id, name, loan_amount, status, created_at, reviewed_at, epc_name_custom, assigned_to_user_id"),
    db.from("epc_business").select("id, trade_name, legal_name, contact_name, status, current_step, updated_at, business_type, assigned_to_user_id").neq("business_type", "admin").in("status", ["draft", "under_review", "on_hold", "approved", "rejected"]),
    db.from("epc_lender_status").select("business_id, docs_given, approved, rejected"),
    db.from("epc_business").select("id, contact_name, role, parent_user_id").eq("business_type", "admin").order("contact_name", { ascending: true }),
  ]);

  const users: TeamUser[] = ((team.data ?? []) as any[]).map((u) => ({ id: u.id, name: u.contact_name || "(unnamed)", role: u.role, parentUserId: u.parent_user_id ?? null }));
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const lenderByApp = new Map<string, Record<string, any>[]>();
  for (const r of (lenders.data ?? []) as any[]) {
    const arr = lenderByApp.get(r.application_id) ?? [];
    arr.push(r); lenderByApp.set(r.application_id, arr);
  }
  const epcLenderBy = new Map<string, { docs: boolean; approved: boolean; rejected: boolean }>();
  for (const r of (epcLenders.data ?? []) as any[]) {
    const cur = epcLenderBy.get(r.business_id) ?? { docs: false, approved: false, rejected: false };
    cur.docs = cur.docs || !!r.docs_given; cur.approved = cur.approved || !!r.approved; cur.rejected = cur.rejected || !!r.rejected;
    epcLenderBy.set(r.business_id, cur);
  }

  const cases: OpsCase[] = [];

  for (const r of (loans.data ?? []) as any[]) {
    const lrows = lenderByApp.get(r.id) ?? [];
    const midDecision = lrows.some((l) => l.docs_sent_at && !l.approved_at && !l.rejected_at);
    const { column, label, stageSince } = loanColumn(r, midDecision);
    cases.push({
      id: r.id, source: "loan",
      name: r.borrower_name || r.aadhaar_name || "—",
      amount: num(r.loan_amount_required) || num(r.loan_amount),
      ownerUserId: r.assigned_to_user_id ?? null,
      ownerName: r.assigned_to_user_id ? nameOf.get(r.assigned_to_user_id) ?? null : null,
      lender: loanLenderLabel(lrows),
      statusLabel: label, column, allColumn: allColumnFor("loan", column, r),
      outcome: r.status === "rejected" ? "rejected" : (column === "approved_rejected" || column === "phase1") ? "approved" : null,
      stageHours: hoursSince(stageSince || r.updated_at),
      tatDays: daysSince(r.created_at || r.submitted_at || r.updated_at),
      idleDays: daysSince(r.updated_at), onHold: r.status === "on_hold",
      blocker: r.review_notes || null,
      disbursed: num(r.first_disbursement_amount) + num(r.second_disbursement_amount),
      disbursedThisMonthAt: r.first_disbursement_date || r.second_disbursement_date || null,
      href: `/admin/app/${r.id}/view`,
    });
  }

  for (const r of (insurance.data ?? []) as any[]) {
    const { column, label } = insuranceColumn(r.status);
    cases.push({
      id: r.id, source: "insurance",
      name: r.aadhaar_name || "—",
      amount: num(r.sum_insured) || num(r.invoice_confirmed_amount) || num(r.invoice_amount),
      ownerUserId: r.assigned_to_user_id ?? null,
      ownerName: r.assigned_to_user_id ? nameOf.get(r.assigned_to_user_id) ?? null : null,
      lender: r.insurance_partner || null,
      statusLabel: label, column, allColumn: allColumnFor("insurance", column, r),
      outcome: column === "issued" ? "approved" : column === "rejected" ? "rejected" : null,
      stageHours: hoursSince(r.updated_at),
      tatDays: daysSince(r.updated_at),
      idleDays: daysSince(r.updated_at), onHold: r.status === "hold", blocker: null,
      disbursed: 0, disbursedThisMonthAt: null,
      href: `/admin/insurance/${r.id}/view`,
    });
  }

  for (const r of (leads.data ?? []) as any[]) {
    const { column, label } = leadColumn(r.status);
    cases.push({
      id: r.id, source: "lead",
      name: r.name || "—", amount: num(r.loan_amount),
      ownerUserId: r.assigned_to_user_id ?? null,
      ownerName: r.assigned_to_user_id ? nameOf.get(r.assigned_to_user_id) ?? null : null,
      lender: r.epc_name_custom || null,
      statusLabel: label, column, allColumn: allColumnFor("lead", column, r),
      outcome: column === "converted" ? "approved" : null,
      stageHours: hoursSince(r.reviewed_at || r.created_at),
      tatDays: daysSince(r.created_at),
      idleDays: daysSince(r.reviewed_at || r.created_at), onHold: false, blocker: null,
      disbursed: 0, disbursedThisMonthAt: null,
      href: `/admin/lead/${r.id}/view`,
    });
  }

  for (const r of (epcs.data ?? []) as any[]) {
    if (isRm && r.assigned_to_user_id !== myId) continue; // epc_business isn't RLS-scoped
    const { column, label } = epcColumn(r, epcLenderBy.get(r.id) ?? { docs: false, approved: false, rejected: false });
    cases.push({
      id: r.id, source: "epc",
      name: r.trade_name || r.legal_name || r.contact_name || "—", amount: 0,
      ownerUserId: r.assigned_to_user_id ?? null,
      ownerName: r.assigned_to_user_id ? nameOf.get(r.assigned_to_user_id) ?? null : null,
      lender: null,
      statusLabel: label, column, allColumn: allColumnFor("epc", column, r),
      outcome: column === "approved" ? "approved" : column === "rejected" ? "rejected" : null,
      stageHours: hoursSince(r.updated_at),
      tatDays: daysSince(r.updated_at),
      idleDays: daysSince(r.updated_at), onHold: r.status === "on_hold", blocker: null,
      disbursed: 0, disbursedThisMonthAt: null,
      href: `/admin/epc/${r.id}/view`,
    });
  }

  return { cases, users };
}
