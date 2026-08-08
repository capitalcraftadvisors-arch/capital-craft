// Loan-application activity logging.
//
// Loan events can't go in admin_edit_log — that table is keyed to
// business_id -> epc_business and has no application key, so loan rows would
// either need the FK loosened or would pollute the parent EPC's activity log.
// They live in loan_activity_log (migration 0042) instead: same row shape,
// keyed to the application.
//
// CLIENT-side helper (View page approve/reject/status changes). The SERVER
// equivalent lives in lib/loan-activity-server.ts — kept separate because this
// file imports browser-side auth/supabase.
//
// Best-effort: a logging failure must never block the actual write.

import { supabase } from "./supabase";
import { getBusiness } from "./auth";

export type LoanAction =
  | "step_completed"
  | "submitted"
  | "approved"
  | "rejected"
  | "status_change"
  | "field_edit";

type Extra = { step?: number | null; detail?: string | null };

// Client-side: infers the actor from the logged-in business.
export async function logLoanActivity(
  applicationId: string,
  action: LoanAction,
  extra: Extra = {},
): Promise<void> {
  try {
    const me = getBusiness();
    const isAdmin = me?.business_type === "admin";
    await supabase().from("loan_activity_log").insert({
      application_id: applicationId,
      actor: isAdmin ? "admin" : "epc",
      actor_id: me?.id ?? null,
      // Admin entries are shown generically as "Admin" — don't store the
      // individual admin's personal name. EPC entries keep the EPC name.
      actor_name: isAdmin ? null : (me?.contact_name ?? null),
      action,
      step: extra.step ?? null,
      detail: extra.detail ?? null,
    });
  } catch (e) {
    console.warn("[loanAudit] client insert failed:", e);
  }
}
