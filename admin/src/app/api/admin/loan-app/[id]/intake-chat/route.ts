// GET/POST /api/admin/loan-app/[id]/intake-chat
//
// Persistence for the AI intake concierge (admin/app/intake) so a half-finished
// application can be reopened and the chat resumes where the RM left off.
//
//   GET  → { ok, chat: { transcript, form_state, cursor, mode } | null }
//   POST → upsert the chat state. Body:
//            { transcript, form_state, cursor, mode, mark_under_review? }
//          When mark_under_review is true and the application is still a
//          'draft', its status is bumped to 'under_review' so a chat closed
//          half-way is visible on the dashboard for follow-up. That status flip
//          works even before migration 0070 is applied (it only touches
//          epc_applications); the transcript upsert needs the new table and
//          fails soft ({ persisted:false }) until then.
//
// Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const supabase = dbAs(token);
    const { data, error } = await supabase
      .from("loan_app_intake_chats")
      .select("transcript, form_state, cursor, mode")
      .eq("application_id", appId)
      .maybeSingle();
    // Missing table (migration not applied yet) or no row → no saved chat.
    if (error) return NextResponse.json({ ok: true, chat: null, note: error.message });
    return NextResponse.json({ ok: true, chat: data ?? null });
  } catch (e) {
    const msg = errText(e);
    console.error("[intake-chat GET] error:", msg);
    return err(msg, 500);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const body = (await req.json().catch(() => ({}))) as {
      transcript?: unknown; form_state?: unknown; cursor?: unknown; mode?: unknown; mark_under_review?: unknown;
    };
    const transcript = Array.isArray(body.transcript) ? body.transcript : [];
    const formState = body.form_state && typeof body.form_state === "object" ? body.form_state : {};
    const cursor = Math.max(0, Math.min(1000, Number(body.cursor) || 0));
    const mode = body.mode === "edit" ? "edit" : "create";

    const supabase = dbAs(token);

    // 1) Status flip (independent of the new table). Only draft → under_review,
    //    so a submitted/approved app is never downgraded.
    let statusBumped = false;
    if (body.mark_under_review === true) {
      const { data: bumped, error: upErr } = await supabase
        .from("epc_applications")
        .update({ status: "under_review", last_updated_by_user_id: claims.business_id })
        .eq("id", appId)
        .eq("status", "draft")
        .select("id");
      if (!upErr && bumped && bumped.length > 0) statusBumped = true;
    }

    // 2) Upsert the transcript (needs migration 0070). Fails soft.
    const { error: chatErr } = await supabase
      .from("loan_app_intake_chats")
      .upsert(
        {
          application_id: appId,
          transcript,
          form_state: formState,
          cursor,
          mode,
          updated_at: new Date().toISOString(),
          updated_by_user_id: claims.business_id,
        },
        { onConflict: "application_id" },
      );

    return NextResponse.json({
      ok: true,
      persisted: !chatErr,
      status_bumped: statusBumped,
      note: chatErr?.message ?? null,
    });
  } catch (e) {
    const msg = errText(e);
    console.error("[intake-chat POST] error:", msg);
    return err(msg, 500);
  }
}
