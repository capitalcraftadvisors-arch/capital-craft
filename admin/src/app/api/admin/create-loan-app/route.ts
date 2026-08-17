// POST /api/admin/create-loan-app  { epc_business_id }
//
// Admin-only. Creates a fresh epc_applications row in draft state for
// the given EPC and returns the new row's id so the client can route
// straight to /admin/app/{id}/step-1.
//
// Guardrails:
//   - JWT must have business_type='admin'.
//   - epc_business_id must reference a real, non-admin EPC that has
//     has_lender_approval=true. This mirrors the AddNewLoanAppModal
//     dropdown's filter — but we also enforce it server-side so a
//     crafted request can't bypass.
//
// Returns:
//   { ok: true,  application: { id, status, current_step, epc_business_id } }
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

    // Verify the target EPC exists, is not the admin row, and has been
    // approved by at least one lender. has_lender_approval is the boolean
    // maintained by the 0017 sync trigger; we don't need to re-derive.
    const { data: epc, error: epcErr } = await supabase
      .from("epc_business")
      .select("id, business_type, has_lender_approval, contact_name, trade_name, legal_name")
      .eq("id", epcBusinessId)
      .maybeSingle();
    if (epcErr) return err(epcErr.message, 500);
    if (!epc) return err("EPC not found.", 404);
    if (epc.business_type === "admin") return err("Cannot create a loan app for the admin row.", 403);
    if (epc.has_lender_approval !== true) {
      return err("This EPC has not been approved by any lender yet.", 403);
    }

    // Insert a minimal draft. status='draft' + current_step=1 is the
    // natural starting state; the borrower fields fill in during Step 1.
    // The 0017 loan_app_gate trigger allows admins to bypass, so this
    // succeeds regardless of the EPC's loan_app_unlocked value.
    const { data: inserted, error: insertErr } = await supabase
      .from("epc_applications")
      .insert({
        epc_business_id: epcBusinessId,
        created_by: "admin",
        // Hierarchy (0066): stamp the authenticated user as creator + initial
        // owner. created_by_user_id is never overwritten later; assigned_to can
        // be reassigned by a Main Admin.
        created_by_user_id: claims.business_id,
        assigned_to_user_id: claims.business_id,
        last_updated_by_user_id: claims.business_id,
        status: "draft",
        current_step: 1,
      })
      .select("id, status, current_step, epc_business_id")
      .single();

    if (insertErr || !inserted) {
      return err(insertErr?.message || "insert_failed", 500);
    }

    return NextResponse.json({
      ok: true,
      application: inserted,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[create-loan-app] error:", msg);
    return err(msg, 500);
  }
}
