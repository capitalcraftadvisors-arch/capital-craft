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
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const body = await req.json().catch(() => ({}));
    const epcBusinessId = String((body as { epc_business_id?: unknown }).epc_business_id ?? "").trim();
    if (!UUID_RE.test(epcBusinessId)) return err("Invalid epc_business_id.", 400);

    const supabase = dbAs(token);

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
    const msg = errText(e);
    console.error("[create-loan-app] error:", msg);
    return err(msg, 500);
  }
}
