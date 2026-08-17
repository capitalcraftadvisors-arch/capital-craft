// Server-only helper to append a row to user_activity_log (migration 0066) —
// the cross-module, user-keyed activity trail that powers the Team view and
// the future morning-work dashboard. Append-only (no update/delete policy).
// Fire-and-forget: a logging failure must never break the underlying action.

import type { SupabaseClient } from "@supabase/supabase-js";

export type UserActivityEntry = {
  actor_user_id: string | null;      // who performed the action
  subject_user_id?: string | null;   // whose work (e.g. the new assignee)
  module: string;                    // 'epcs' | 'apps' | 'loanleads' | 'leads' | 'insurance'
  record_id?: string | null;         // affected record
  action: string;                    // 'created' | 'assigned' | 'reassigned' | 'status_change' | ...
  previous_value?: string | null;
  new_value?: string | null;
};

export async function logUserActivity(
  supabase: SupabaseClient,
  entry: UserActivityEntry,
): Promise<void> {
  try {
    const { error } = await supabase.from("user_activity_log").insert({
      actor_user_id: entry.actor_user_id,
      subject_user_id: entry.subject_user_id ?? null,
      module: entry.module,
      record_id: entry.record_id ?? null,
      action: entry.action,
      previous_value: entry.previous_value ?? null,
      new_value: entry.new_value ?? null,
    });
    if (error) console.warn("[user-activity] insert failed:", error.message);
  } catch (e) {
    console.warn("[user-activity] insert threw:", (e as Error)?.message);
  }
}
