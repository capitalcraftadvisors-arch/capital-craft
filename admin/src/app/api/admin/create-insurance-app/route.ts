// POST /api/admin/create-insurance-app  { epc_business_id }
//
// Admin-only. Creates a fresh insurance_applications row in draft state for
// the given EPC and returns the new row's id so the client can route straight
// to /dashboard/insurance/{id}/step-1.
//
// Mirrors /api/admin/create-loan-app, but for insurance:
//   - No lender-approval gate — insurance isn't lender-gated. Admin may start
//     a profile for ANY non-admin EPC (the enforce_insurance_gate trigger from
//     migration 0046 bypasses for admin JWTs, so the INSERT succeeds regardless
//     of the EPC's service_type).
//
// Returns:
//   { ok: true,  application: { id, status, current_step, insurance_display_id } }
//   { ok: false, error: string }

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

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const body = await req.json().catch(() => ({}));
    const epcBusinessId = String((body as { epc_business_id?: unknown }).epc_business_id ?? "").trim();
    if (!UUID_RE.test(epcBusinessId)) return err("Invalid epc_business_id.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verify the target EPC exists and is not the admin row. No service_type
    // filter — admin may start an insurance profile for any EPC.
    const { data: epc, error: epcErr } = await supabase
      .from("epc_business")
      .select("id, business_type")
      .eq("id", epcBusinessId)
      .maybeSingle();
    if (epcErr) return err(epcErr.message, 500);
    if (!epc) return err("EPC not found.", 404);
    if (epc.business_type === "admin") return err("Cannot create an insurance profile for the admin row.", 403);

    // Resume an existing draft rather than piling up empties (same as the EPC
    // create route). Then, if none, insert a fresh draft.
    const { data: existing } = await supabase
      .from("insurance_applications")
      .select("id, status, current_step, insurance_display_id")
      .eq("epc_business_id", epcBusinessId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, application: existing, resumed: true });
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("insurance_applications")
      .insert({
        epc_business_id: epcBusinessId,
        created_by: "admin",
        // Hierarchy (0066): the admin/ops user who created this application.
        created_by_user_id: claims.business_id,
        assigned_to_user_id: claims.business_id,
        last_updated_by_user_id: claims.business_id,
        status: "draft",
        current_step: 1,
      })
      .select("id, status, current_step, insurance_display_id")
      .single();

    if (insertErr || !inserted) {
      return err(insertErr?.message || "insert_failed", 500);
    }

    return NextResponse.json({ ok: true, application: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[create-insurance-app] error:", msg);
    return err(msg, 500);
  }
}
