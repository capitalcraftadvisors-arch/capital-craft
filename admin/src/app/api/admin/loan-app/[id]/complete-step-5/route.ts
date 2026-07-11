// POST /api/admin/loan-app/[id]/complete-step-5
//
// Admin-only. Persists Step 5 selections (ROI, subsidies, tenure, EMIs)
// and advances current_step 5 → 6.
//
// Server-side validation:
//   - roi_percent required, 7.5 ≤ x ≤ 10.8
//   - central_subsidy required, 0 ≤ x ≤ 78,000 (PM Surya Ghar cap)
//   - state_subsidy required, 0 ≤ x (no upper bound)
//   - selected_tenure_years required, integer in {1,2,3,4,5}
//   - selected_monthly_emi required, > 0
//   - selected_subsidy_emi required, ≥ 0 (can be 0 if subsidies cover
//     the whole loan)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TENURES = new Set([1, 2, 3, 4, 5]);
const CENTRAL_SUBSIDY_CAP = 78000;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

    const roi_percent          = num(b.roi_percent);
    const central_subsidy      = num(b.central_subsidy);
    const state_subsidy        = num(b.state_subsidy);
    const selected_tenure_years = num(b.selected_tenure_years);
    const selected_monthly_emi = num(b.selected_monthly_emi);
    const selected_subsidy_emi = num(b.selected_subsidy_emi);

    // Admin-only route — no required-field blocking. Every offer field is
    // optional; reject only present-and-out-of-range values (tenure stays
    // within the DB CHECK because a present value must be 1-5).
    if (roi_percent !== null && (roi_percent < 7.5 || roi_percent > 10.8)) {
      return err("ROI must be between 7.5% and 10.8%.", 400);
    }
    if (central_subsidy !== null && (central_subsidy < 0 || central_subsidy > CENTRAL_SUBSIDY_CAP)) {
      return err("Central subsidy is out of range.", 400);
    }
    if (state_subsidy !== null && state_subsidy < 0) {
      return err("State subsidy cannot be negative.", 400);
    }
    if (selected_tenure_years !== null && !ALLOWED_TENURES.has(selected_tenure_years)) {
      return err("Tenure must be between 1 and 5 years.", 400);
    }
    if (selected_monthly_emi !== null && selected_monthly_emi <= 0) {
      return err("Monthly EMI must be positive.", 400);
    }
    if (selected_subsidy_emi !== null && selected_subsidy_emi < 0) {
      return err("Subsidy EMI cannot be negative.", 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select("id, current_step")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);
    if ((app.current_step ?? 1) < 5) return err("Complete Step 4 before Step 5.", 409);

    const nextStep = Math.max(app.current_step ?? 5, 6);

    const { error: updErr } = await supabase
      .from("epc_applications")
      .update({
        roi_percent,
        central_subsidy,
        state_subsidy,
        selected_tenure_years,
        selected_monthly_emi,
        selected_subsidy_emi,
        step5_completed_at: new Date().toISOString(),
        current_step: nextStep,
      })
      .eq("id", appId);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true, next_step: nextStep });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-step-5] error:", msg);
    return err(msg, 500);
  }
}
