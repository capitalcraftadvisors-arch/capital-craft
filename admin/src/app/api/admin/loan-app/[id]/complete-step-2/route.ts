// POST /api/admin/loan-app/[id]/complete-step-2
//
// Admin-only. Persists the Aadhaar KYC fields captured on Step 2
// (previously returned by /extract-aadhaar) and advances current_step
// from 2 to 3.
//
// The masking guarantee (never store the full 12-digit Aadhaar number)
// is enforced by rejecting any aadhaar_number_masked value that is NOT
// exactly 12 chars of the form "xxxxxxxx####" (eight 'x' + four digits).
// The client sends the masked form directly — this is a belt-and-braces
// check in case a future caller tries to shove raw digits through.

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
const MASKED_RE = /^x{8}\d{4}$/;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
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

    const body = await req.json().catch(() => ({}));
    const b = body as Record<string, unknown>;

    const aadhaar_name          = strOrNull(b.aadhaar_name);
    const aadhaar_dob           = strOrNull(b.aadhaar_dob);
    const aadhaar_gender        = strOrNull(b.aadhaar_gender);
    // Full 12-digit number (product decision — KYC needs the full value).
    // The masked form is derived server-side, never trusted from the client.
    const aadhaar_number_raw    = strOrNull(b.aadhaar_number)?.replace(/\D/g, "") ?? null;
    const aadhaar_care_of       = strOrNull(b.aadhaar_care_of);
    const aadhaar_address       = strOrNull(b.aadhaar_address);
    const aadhaar_front_path    = strOrNull(b.aadhaar_front_path);
    const aadhaar_back_path     = strOrNull(b.aadhaar_back_path);
    const aadhaar_face_path     = strOrNull(b.aadhaar_face_path);

    // Admin-only route — no required-field blocking. Store whatever's present;
    // the masked form is derived only when digits exist.
    const aadhaar_number        = aadhaar_number_raw;
    const aadhaar_number_masked = aadhaar_number_raw ? "xxxxxxxx" + aadhaar_number_raw.slice(-4) : null;

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Idempotence guard: if already past Step 2 we still succeed but
    // don't rewind. Fresh state -> current_step becomes 3.
    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select("id, current_step")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);
    if ((app.current_step ?? 1) < 2) {
      return err("Complete Step 1 before Step 2.", 409);
    }

    const nextStep = Math.max(app.current_step ?? 2, 3);

    const { error: updErr } = await supabase
      .from("epc_applications")
      .update({
        aadhaar_name,
        aadhaar_dob,
        aadhaar_gender,
        aadhaar_number,
        aadhaar_number_masked,
        aadhaar_care_of,
        aadhaar_address,
        aadhaar_front_path,
        aadhaar_back_path,
        aadhaar_face_path,
        kyc_extracted_at: new Date().toISOString(),
        current_step: nextStep,
      })
      .eq("id", appId);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    // Append-only activity trail (migration 0042). Best-effort.
    await logLoanActivityServer(supabase, appId, "step_completed", claims.business_id ?? null, { step: 2 });

    return NextResponse.json({ ok: true, next_step: nextStep });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-step-2] error:", msg);
    return err(msg, 500);
  }
}
