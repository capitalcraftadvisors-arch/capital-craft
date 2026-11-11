// Pendings — maker-checker for loan approval + disbursement details, and for
// EPC profiles the team approves (see epcReviewPatch below).
//
// Approval details, the 1st and the 2nd disbursement each go:
//   team fills + saves → 'pending' (LOCKED for the team) → the MAIN ADMIN checks
//   it (on /admin/pendings or on that stage of the loan profile) and
//     • approves → 'approved' — still locked for the team; the next stage opens
//       (approval → 1st disbursement → 2nd disbursement)
//     • sends it back with a reason → 'sent_back' — the team corrects + saves again
//     • edits it himself (his save is approved at once), or
//     • undoes a decision → back to 'pending'.
// The main admin's own entry is approved at once. NULL = legacy (before the
// checks) — never locked. Migrations 0092 + 0121 enforce all of this in the DB.

import { getBusiness, isMainAdmin } from "./auth";
import { supabase } from "./supabase";
import { getCached, setCached, invalidate } from "./list-cache";

export type ReviewItem = "approval" | "disb1" | "disb2";
export type ReviewState = "pending" | "approved" | "sent_back" | null;

export const REVIEW_LABEL: Record<ReviewItem, string> = {
  approval: "Approval details",
  disb1: "1st disbursement",
  disb2: "2nd disbursement",
};

type Loan = Record<string, any> | null | undefined;

export const reviewState = (loan: Loan, item: ReviewItem): ReviewState =>
  (loan?.[`${item}_review_status`] as ReviewState) ?? null;

// The loan profile tab of each item (?tab=…).
export const REVIEW_TAB: Record<ReviewItem, string> = { approval: "approved", disb1: "first", disb2: "second" };
const REVIEW_ITEMS: ReviewItem[] = ["approval", "disb1", "disb2"];
// The review columns of a loan row — for lists that show the checks.
export const REVIEW_COLS = REVIEW_ITEMS.map((k) => `${k}_review_status, ${k}_reviewed_at, ${k}_review_note`).join(", ");

export type LoanReview = { item: ReviewItem; status: Exclude<ReviewState, null>; at: string | null; note: string | null };
// A loan row's checks that have a status (REVIEW_COLS selected).
export function loanReviews(r: Record<string, any>): LoanReview[] {
  return REVIEW_ITEMS.filter((k) => r[`${k}_review_status`]).map((k) => ({
    item: k, status: r[`${k}_review_status`], at: r[`${k}_reviewed_at`] ?? null, note: r[`${k}_review_note`] ?? null,
  }));
}

// What the team hears about: the admin's approvals and send-backs of the last
// 14 days, newest first (an Undo removes the decision, so it drops out too).
export type ReviewNotice = LoanReview & { loanId: string; name: string; at: string; href: string };
export function reviewNotices(loans: { id: string; name: string; reviews?: LoanReview[] }[], days = 14): ReviewNotice[] {
  const from = Date.now() - days * 86400000;
  return loans
    .flatMap((l) => (l.reviews ?? [])
      .filter((v) => (v.status === "approved" || v.status === "sent_back") && v.at && new Date(v.at).getTime() >= from)
      .map((v) => ({ ...v, at: v.at as string, loanId: l.id, name: l.name, href: `/admin/app/${l.id}/view?tab=${REVIEW_TAB[v.item]}` })))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

// Can the signed-in user change this item's saved details? The main admin always;
// the team only before saving (legacy) or after it was sent back to them.
export function canEditReview(loan: Loan, item: ReviewItem): boolean {
  if (isMainAdmin(getBusiness())) return true;
  const s = reviewState(loan, item);
  return s == null || s === "sent_back";
}

// Is the stage AFTER this item open to the signed-in user? (The main admin always.)
export function reviewOpen(loan: Loan, item: ReviewItem): boolean {
  if (isMainAdmin(getBusiness())) return true;
  const s = reviewState(loan, item);
  return s == null || s === "approved";
}

// The review columns to write alongside an approval / disbursement save.
export function reviewPatch(item: ReviewItem): Record<string, string | null> {
  const me = getBusiness();
  const checker = isMainAdmin(me);
  return {
    [`${item}_review_status`]: checker ? "approved" : "pending",
    [`${item}_reviewed_at`]: checker ? new Date().toISOString() : null,
    [`${item}_reviewed_by`]: checker ? (me?.contact_name || "Admin") : null,
  };
}

// The main admin's decisions (the DB trigger refuses anyone else). Each returns
// the columns it wrote (to merge into the row on screen) or throws a readable error.
async function decide(id: string, patch: Record<string, string | null>): Promise<Record<string, string | null>> {
  const { error } = await supabase().from("epc_applications").update(patch).eq("id", id);
  if (error) throw new Error(reviewError(error.message));
  invalidatePendingCount();
  return patch;
}
const decidedBy = () => ({ at: new Date().toISOString(), by: getBusiness()?.contact_name || "Admin" });

export function approveReview(id: string, item: ReviewItem) {
  const d = decidedBy();
  return decide(id, { [`${item}_review_status`]: "approved", [`${item}_reviewed_at`]: d.at, [`${item}_reviewed_by`]: d.by });
}
export function sendBackReview(id: string, item: ReviewItem, reason: string) {
  const d = decidedBy();
  return decide(id, {
    [`${item}_review_status`]: "sent_back", [`${item}_review_note`]: reason.trim(),
    [`${item}_reviewed_at`]: d.at, [`${item}_reviewed_by`]: d.by,
  });
}
// Undo the admin's decision (approved / sent back) — the item waits for the check again.
export function undoReview(id: string, item: ReviewItem) {
  return decide(id, { [`${item}_review_status`]: "pending", [`${item}_reviewed_at`]: null, [`${item}_reviewed_by`]: null });
}

// The DB trigger's refusals (0092 / 0111 / 0121), in plain words.
export function reviewError(msg: string): string {
  if (msg.includes("review_main_admin_only")) return "Only the admin can approve, send back or undo.";
  if (msg.includes("review_locked")) return "Locked — saved details can only be changed by the admin, or after the admin sends them back.";
  if (msg.includes("disbursement_locked_pending_disb1")) return "Locked — waiting for the admin to approve the 1st disbursement.";
  if (msg.includes("disbursement_locked_pending_approval")) return "Locked — waiting for the admin to approve the approval details.";
  return msg;
}

export const PENDING_FILTER = "approval_review_status.eq.pending,disb1_review_status.eq.pending,disb2_review_status.eq.pending";

// EPC pendings — after the team approves an EPC profile, the main admin checks
// it before the team can email lenders or change its lender status (migration
// 0100 enforces it). The main admin's own approval counts as checked.
export function epcReviewPatch(): Record<string, string | null> {
  const me = getBusiness();
  const checker = isMainAdmin(me);
  return {
    admin_review_status: checker ? "approved" : "pending",
    admin_reviewed_at: checker ? new Date().toISOString() : null,
    admin_reviewed_by: checker ? (me?.contact_name || "Admin") : null,
  };
}

export async function approveEpcReview(id: string): Promise<string | null> {
  const me = getBusiness();
  const { error } = await supabase().from("epc_business").update({
    admin_review_status: "approved",
    admin_reviewed_at: new Date().toISOString(),
    admin_reviewed_by: me?.contact_name || "Admin",
  }).eq("id", id);
  return error ? error.message : null;
}

// The team can't touch lenders for a profile that waits on the main admin.
export const epcLocked = (b: { admin_review_status?: string | null } | null | undefined) =>
  b?.admin_review_status === "pending" && !isMainAdmin(getBusiness());

// Save one EPC lender state (epc_lender_status upsert); throws a readable error
// when the database refuses it (migration 0100 locks).
export async function saveEpcLenderState(businessId: string, lender: string, patch: Record<string, unknown>) {
  const { data: existing } = await supabase().from("epc_lender_status")
    .select("id").eq("business_id", businessId).eq("lender", lender).maybeSingle();
  const { error } = existing
    ? await supabase().from("epc_lender_status").update(patch).eq("id", (existing as { id: string }).id)
    : await supabase().from("epc_lender_status").insert({ business_id: businessId, lender, ...patch });
  if (!error) return;
  if (error.message.includes("epc_pending_admin_review")) throw new Error("This profile is waiting for admin approval.");
  if (error.message.includes("epc_not_approved")) throw new Error("Approve the EPC profile first.");
  throw new Error(error.message);
}

// Sidebar badge: how many items wait for the main admin (loan + EPC pendings) —
// one request, cached a few minutes per tab so page changes don't re-query.
const COUNT_KEY = "pendings.count";
export async function pendingCount(): Promise<number> {
  const hit = getCached<number>(COUNT_KEY, 3 * 60_000);
  if (hit != null) return hit;
  const { data, error } = await supabase().rpc("admin_pending_count");
  const n = error ? 0 : Number(data) || 0;
  setCached(COUNT_KEY, n);
  return n;
}
export const invalidatePendingCount = () => invalidate(COUNT_KEY);
export const rememberPendingCount = (n: number) => setCached(COUNT_KEY, n);
