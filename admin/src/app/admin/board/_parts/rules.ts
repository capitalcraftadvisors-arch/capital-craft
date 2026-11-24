// Task Manager — case rules: allowed stage moves, SLA colours, the next action, who a case waits on, comment tables, month keys.

import type { OpsCase, CaseSource } from "@/lib/ops-board";
import { REVIEW_LABEL } from "@/lib/review";

// ── Loan pipeline: forward-only stage locking (no going back, no skipping —
// except a lender decision straight after Send to Lender). Moves into these
// stages open the loan's own workflow screen (change #10). ──
const LOAN_FORWARD: Record<string, string[]> = {
  ready_login: ["send_lender", "abort"],
  send_lender: ["docs_pending", "approved", "rejected", "abort"],
  docs_pending: ["approved", "rejected", "abort"],
  approved: ["phase1", "abort"],
  rejected: [], // the lender's decision is final here (Change review on the loan page)
  phase1: [], // no abort once in 1st Phase (disbursement under way)
  abort: [],
};
// Loan target columns whose drop opens the real loan screen instead of a plain
// status write. (docs_pending is a simple "put on hold" status move.)
export const LOAN_OPENS_SCREEN = new Set(["send_lender", "approved", "rejected", "phase1", "abort"]);

// Per-source comment table (insurance has none).
export const COMMENT_TBL: Record<CaseSource, { table: string; key: string } | null> = {
  loan: { table: "loan_comments", key: "application_id" },
  epc: { table: "epc_comments", key: "business_id" },
  lead: { table: "lead_comments", key: "lead_id" },
  insurance: null,
};

// Non-loan columns a drag can't set directly.
const UNDRAGGABLE: Record<string, string> = {
  rejected: "Reject a case from its own page (with a reason).",
  converted: "Convert a lead to a loan from the lead’s page.",
};

// Can a case be dragged into `target`? Loans are forward-only (locked); other
// sources keep their simple status moves.
export function stageCheck(c: OpsCase, target: string, label: string): { ok: boolean; msg: string } {
  if (target === c.column) return { ok: false, msg: "Already in this stage." };
  if (c.source === "loan") {
    const allowed = LOAN_FORWARD[c.column ?? ""] ?? [];
    if (!allowed.includes(target)) return { ok: false, msg: "Stages are locked — a loan can only move forward to its next stage (no going back or skipping ahead)." };
    if (target === "phase1" && c.outcome === "rejected") return { ok: false, msg: "A rejected loan can’t move to disbursement." };
    if (target === "send_lender") return { ok: true, msg: `Send ${c.name}’s documents to a lender — pick which one next.` };
    if (target === "approved") return { ok: true, msg: `Record the lender’s approval for ${c.name} — pick the lender next.` };
    if (target === "rejected") return { ok: true, msg: `Record the lender’s rejection for ${c.name} — pick the lender next.` };
    if (target === "phase1") return { ok: true, msg: `Open ${c.name}’s disbursement screen (RFD + 1st-tranche docs)?` };
    if (target === "abort") return { ok: true, msg: `Open ${c.name} to abort it (with a reason)?` };
    return { ok: true, msg: `Move ${c.name} to “Docs Pending” (put on hold to collect documents)?` };
  }
  if (c.source === "insurance" && target === "rejected") return { ok: false, msg: UNDRAGGABLE.rejected };
  if (c.source === "epc") {
    // Approving needs every document — checked on the EPC profile.
    if (target === "send_lender" || target === "rejected" || target === "approved") return { ok: false, msg: "Approval, lender and rejection steps are done from the EPC profile." };
    if (target === "unseen" || target === "doc_uploaded") return { ok: false, msg: "This stage is set automatically as the EPC fills their profile." };
  }
  if (c.source === "lead" && target === "converted") return { ok: false, msg: UNDRAGGABLE.converted };
  const forward = ["review_cc", "review", "approved"].includes(target);
  if (forward && c.blocker && /pend|await|missing|require|incomplete|\bdoc/i.test(c.blocker)) {
    return { ok: false, msg: `Can’t move to “${label}” — documents pending: “${c.blocker}”. Clear it first (mark “Doc received”).` };
  }
  return { ok: true, msg: `Move “${c.name}” to “${label}”? The status panel opens so you can mark it.` };
}

// Attention outline: green = up to date, yellow = watch (aging / on hold /
// blocked), red = overdue (idle ≥ SLA). Used for EPC / insurance / lead.
export function attention(c: OpsCase, sla: number): "green" | "yellow" | "red" {
  if (c.idleDays >= sla) return "red";
  if (c.idleDays >= Math.max(1, Math.ceil(sla / 2)) || c.onHold || !!c.blocker) return "yellow";
  return "green";
}
// Loan per-stage outline thresholds, in HOURS: [yellow-from, red-from] measured
// from when the loan entered its current stage (stageHours).
const LOAN_OUTLINE: Record<string, [number, number]> = {
  ready_login: [72, 168],       // >3d → yellow, >7d → red
  send_lender: [24, 48],        // >24h → yellow, >48h → red
  docs_pending: [24, 48],       // >24h → yellow, >48h → red
  approved: [24, 48],           // >24h → yellow, >48h → red
  phase1: [600, 1080],          // >25d → yellow, ≥45d → red
  phase2: [600, 1080],          // 2nd disbursement — same aging as 1st
};
export function loanOutline(c: OpsCase): "green" | "yellow" | "red" | "neutral" {
  if (c.column === "abort") return "neutral";
  if (c.column === "rejected") return "neutral"; // rejected: pale fill, no TAT
  const t = LOAN_OUTLINE[c.column ?? ""];
  if (!t) return "green";
  if (c.stageHours >= t[1]) return "red";
  if (c.stageHours >= t[0]) return "yellow";
  return "green";
}
// Inner card fill by SLA status (replaces the coloured border): green = within
// SLA, amber = approaching breach, red = breached/blocked, neutral = terminal.
export const OUTLINE_FILL: Record<"green" | "yellow" | "red" | "neutral", string> = { green: "#e7f5ee", yellow: "#fdf0da", red: "#fbe4e4", neutral: "#e8ebef" };
// My Day's Idle chip text on those fills.
export const IDLE_TEXT: Record<"green" | "yellow" | "red" | "neutral", string> = { green: "#178a5c", yellow: "#854f0b", red: "#b42318", neutral: "#64748b" };

// The next action a case needs, derived from its stage. null = nothing to do
// (aborted / off-board, a rejected non-loan case) — excluded from My Day.
// Closed loans — rejected, and fully disbursed (2nd Phase) — stay, each in its
// own tab, below the work and not counted as work.
export const isClosedLoan = (c: OpsCase) => c.source === "loan" && (c.column === "rejected" || c.column === "phase2");
export function nextAction(c: OpsCase): { text: string; cta: string; tone?: string } | null {
  if ((c.outcome === "rejected" && c.source !== "loan") || c.column === "abort" || c.column == null) return null;
  if (isClosedLoan(c)) return { text: c.statusLabel, cta: "Open", tone: "#64748b" };
  if (c.source === "loan") {
    // The admin sent a stage back — fixing it comes first.
    const back = c.reviews?.find((v) => v.status === "sent_back");
    if (back) return { text: `Sent back by Admin · ${REVIEW_LABEL[back.item]}${back.note ? ` — ${back.note}` : ""}`, cta: "Open", tone: "#b42318" };
    switch (c.column) {
      case "ready_login":       return { text: "Send the documents to a lender", cta: "Open" };
      case "send_lender":       return { text: "Follow up the lender · record the decision", cta: "Open" };
      case "docs_pending":      return { text: "Collect the pending documents", cta: "Open" };
      case "approved":          return { text: "Record the disbursement", cta: "Open" };
      case "phase1":            return { text: "Record the 2nd disbursement", cta: "Open" };
      default:                 return { text: c.statusLabel, cta: "Open" };
    }
  }
  // Non-loan sources: hide terminal states (already done) so My Day stays a
  // list of things that still need action.
  if (c.source === "lead") return c.column === "converted" ? null : { text: "Follow up · convert this lead", cta: "Open" };
  if (c.source === "insurance") return c.column === "issued" ? null : { text: c.statusLabel, cta: "Open" };
  if (c.source === "epc") return c.column === "approved" ? null : { text: c.statusLabel, cta: "Open" };
  return { text: c.statusLabel, cta: "Open" };
}

// "YYYY-MM" → last calendar day "YYYY-MM-DD" (inclusive end of the month range).
export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return "";
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

// "Act today" — who is blocking each case, so the day reads as a ranked list.
export type WaitParty = "Customer" | "Lender" | "EPC" | "Internal";
export const WAIT_COLOR: Record<WaitParty, string> = { Customer: "#dc2626", Lender: "#d97706", EPC: "#185fa5", Internal: "#64748b" };
export function waitingOn(c: OpsCase): WaitParty {
  if (c.source === "epc") return "EPC";
  if (c.source === "lead" || c.source === "insurance") return "Customer";
  switch (c.column) {
    case "send_lender":
    case "approved": return "Lender";
    case "docs_pending": return "Customer";
    case "phase1": return "EPC";
    default: return "Internal"; // ready_login etc. — our move next
  }
}

// Year-month key of a date (month 0-based, like the page's thisMonthKey) — for "done this month" counts.
export function monthKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}`;
}
