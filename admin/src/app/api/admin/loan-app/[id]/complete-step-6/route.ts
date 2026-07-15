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
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { logLoanActivityServer } from "@/lib/loan-activity-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select("id, current_step, status")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);
    if ((app.current_step ?? 1) < 6) {
      return err("Complete Step 5 before submitting.", 409);
    }

    const now = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("epc_applications")
      .update({
        status: "submitted",
        submitted_at: now,
      })
      .eq("id", appId);
    if (updErr) return err(`Submit failed: ${updErr.message}`, 500);

    // Append-only activity trail (migration 0042). Best-effort.
    await logLoanActivityServer(supabase, appId, "submitted", claims.business_id ?? null, { step: 6 });

    return NextResponse.json({
      ok: true,
      status: "submitted",
      submitted_at: now,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-step-6] error:", msg);
    return err(msg, 500);
  }
}
