// Server-side loan activity logging, for the complete-step-N API routes.
//
// Kept SEPARATE from lib/loanAudit.ts (the client helper) because that file
// pulls in lib/auth / lib/supabase, which are browser-side. This module only
// takes a SupabaseClient the caller already built with the request's JWT, so
// the insert runs under the same RLS scope as the rest of the route.
//
// Best-effort: a logging failure must never fail the step save.

import type { SupabaseClient } from "@supabase/supabase-js";

export type LoanAction =
  | "step_completed"
  | "submitted"
  | "approved"
  | "rejected"
  | "status_change"
  | "field_edit";

export async function logLoanActivityServer(
  client: SupabaseClient,
  applicationId: string,
  action: LoanAction,
  actorId: string | null,
  extra: { step?: number | null; detail?: string | null } = {},
): Promise<void> {
  try {
    await client.from("loan_activity_log").insert({
      application_id: applicationId,
      actor: "admin",
      actor_id: actorId,
      actor_name: null,
      action,
      step: extra.step ?? null,
      detail: extra.detail ?? null,
    });
  } catch (e) {
    console.warn("[loan-activity] insert failed:", e);
  }
}
