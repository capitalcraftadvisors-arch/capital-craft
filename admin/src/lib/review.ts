// Pendings — maker-checker for loan approval + disbursement details, and for
// EPC profiles the team approves (see epcReviewPatch below).
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
