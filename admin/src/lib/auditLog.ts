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

type Action =
  | "field_edit"
  | "doc_upload"
  | "doc_replace"
  | "doc_delete"
  | "members_edited"
  | "references_edited"
  | "self_edit_submit";

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
