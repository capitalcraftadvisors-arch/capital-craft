// Pendings — maker-checker for loan approval + disbursement details.
//
// A team member's (manager / RM) approval details and 1st / 2nd disbursement
// wait for the MAIN ADMIN's check on /admin/pendings; the main admin's own entry
// is approved at once. While the approval details are pending, the team can't
// enter a disbursement. Migration 0092 adds the columns and a DB trigger that
// enforces both rules (only the main admin can approve; no disbursement while
// the approval is pending), so this is not just a UI lock.

import { getBusiness, isMainAdmin } from "./auth";
import { supabase } from "./supabase";
import { getCached, setCached, invalidate } from "./list-cache";

export type ReviewItem = "approval" | "disb1" | "disb2";

export const REVIEW_LABEL: Record<ReviewItem, string> = {
  approval: "Approval details",
  disb1: "1st disbursement",
  disb2: "2nd disbursement",
};

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

// The main admin approves a pending item (the DB trigger rejects anyone else).
export async function approveReview(id: string, item: ReviewItem): Promise<string | null> {
  const me = getBusiness();
  const { error } = await supabase().from("epc_applications").update({
    [`${item}_review_status`]: "approved",
    [`${item}_reviewed_at`]: new Date().toISOString(),
    [`${item}_reviewed_by`]: me?.contact_name || "Admin",
  }).eq("id", id);
  return error ? error.message : null;
}

export const PENDING_FILTER = "approval_review_status.eq.pending,disb1_review_status.eq.pending,disb2_review_status.eq.pending";

// Sidebar badge: how many profiles wait for the main admin. One head-count
// query, cached a few minutes per tab so page changes don't re-query.
const COUNT_KEY = "pendings.count";
export async function pendingCount(): Promise<number> {
  const hit = getCached<number>(COUNT_KEY, 3 * 60_000);
  if (hit != null) return hit;
  const { count, error } = await supabase().from("epc_applications")
    .select("id", { count: "exact", head: true }).or(PENDING_FILTER);
  const n = error ? 0 : (count ?? 0);
  setCached(COUNT_KEY, n);
  return n;
}
export const invalidatePendingCount = () => invalidate(COUNT_KEY);
export const rememberPendingCount = (n: number) => setCached(COUNT_KEY, n);
