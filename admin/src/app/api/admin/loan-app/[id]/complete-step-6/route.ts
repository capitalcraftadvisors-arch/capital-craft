// POST /api/admin/loan-app/[id]/complete-step-6
//
// Admin-only. Marks the loan application as SUBMITTED — sets the
// existing status column (loan_status enum from 0001) to 'submitted'
// and stamps submitted_at.
//
// IMPORTANT — DOES NOT LOCK the record:
//   - No status transition trigger.
//   - No row-level enforcement blocking further updates.
//   - The customer or admin can navigate back to any earlier step and
//     edit fields. If a re-submit happens, submitted_at is refreshed to
//     the latest submit time; status stays 'submitted' idempotently.
//
// current_step is not advanced beyond 6 (there is no step 7). If a
// resubmit lands from step-6, current_step stays 6.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin, loadLoanRow } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { logLoanActivityServer } from "@/lib/loan-activity-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const supabase = dbAs(token);

    const app = await loadLoanRow(supabase, appId, "id, current_step, status");
    if (app instanceof Response) return app;
    if ((app.current_step ?? 1) < 6) {
      return err("Complete Step 5 before submitting.", 409);
    }

    // Re-submitting a file that has ALREADY advanced past submission must NOT
    // revert its headline status. An admin editing an approved / rejected /
    // docs-sent / disbursed loan and saving Step 6 again used to knock it back to
    // "submitted" — which dropped the decision: the board showed it in "Ready for
    // login" and the list lost its disbursement, while the lender rows + amounts
    // survived. Only a still-pre-submit file is actually (re)submitted here; a
    // decided file keeps its status and original submit time untouched.
    const PRE_SUBMIT = new Set(["draft", "submitted", "under_review"]);
    const decided = !PRE_SUBMIT.has(app.status ?? "");
    const now = new Date().toISOString();
    if (!decided) {
      const { error: updErr } = await supabase
        .from("epc_applications")
        .update({ status: "submitted", submitted_at: now })
        .eq("id", appId);
      if (updErr) return err(`Submit failed: ${updErr.message}`, 500);
    }

    // Append-only activity trail (migration 0042). Best-effort.
    await logLoanActivityServer(supabase, appId, "submitted", claims.business_id ?? null, { step: 6 });

    return NextResponse.json({
      ok: true,
      status: decided ? (app.status ?? "submitted") : "submitted",
      submitted_at: now,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-step-6] error:", msg);
    return err(msg, 500);
  }
}
