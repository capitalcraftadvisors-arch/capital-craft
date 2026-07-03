// Thin helper used by the admin EPC detail page on every field/array save.
// Writes one row into admin_edit_log. RLS:
//   - admin's JWT → admin_all_edit_log policy → insert with any business_id
//   - EPC's JWT  → epc_insert_own_log policy → insert only for own
//     business_id and only when actor='epc' (helper enforces this)
//
// Failures are logged but not thrown — audit gaps are preferable to
// blocking the actual save.

import { supabase } from "./supabase";
import { getBusiness } from "./auth";

// Action strings live entirely in the TEXT column admin_edit_log.action —
// no enum change is needed to add new event types. The union below is for
// TS ergonomics; the app writes the older values, DB triggers write the
// newer ones (lender_* and comment_*), and everything shows up in the
// unified Activity Log on the View page.
export type Action =
  | "field_edit"
  | "doc_upload"
  | "doc_replace"
  | "doc_delete"
  | "members_edited"
  | "references_edited"
  | "self_edit_submit"
  // Written by triggers in migration 0018:
  | "lender_approve"
  | "lender_unapprove"
  | "lender_docs_given"
  | "lender_docs_ungiven"
  | "comment_add"
  | "comment_edit"
  | "comment_delete";

export async function logAudit(
  businessId: string,
  action: Action,
  field?: string | null,
  oldValue?: string | null,
  newValue?: string | null,
): Promise<void> {
  const me = getBusiness();
  if (!me) return;
  const actor = me.business_type === "admin" ? "admin" : "epc";
  try {
    await supabase().from("admin_edit_log").insert({
      business_id: businessId,
      actor,
      actor_id: me.id,
      action,
      field: field ?? null,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
    });
  } catch (e) {
    console.warn("[audit] insert failed", e);
  }
}
