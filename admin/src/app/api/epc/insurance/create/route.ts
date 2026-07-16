// POST /api/epc/insurance/create
//
// Creates (or resumes) a draft insurance application for the calling EPC and
// returns its id so the client can route to Step 1. If the EPC already has an
// un-submitted draft, that one is resumed rather than piling up empties.
//
// Access: any authenticated EPC. The DB gate (enforce_insurance_gate, 0046)
// rejects the INSERT unless the EPC's service_type is 'insurance' | 'both',
// so eligibility is enforced server-side regardless of the UI. Admins may
// also call it (their JWT bypasses the gate).

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { insuranceClient } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    const businessId = claims.business_id;
    if (!businessId) return err("no_business", 400);

    const supabase = insuranceClient(token);

    // Resume an existing draft if one is lying around.
    const { data: existing } = await supabase
      .from("insurance_applications")
      .select("id, status, current_step")
      .eq("epc_business_id", businessId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, application: existing, resumed: true });
    }

    const { data: inserted, error: insErr } = await supabase
      .from("insurance_applications")
      .insert({
        epc_business_id: businessId,
        status: "draft",
        current_step: 1,
        created_by: claims.business_type === "admin" ? "admin" : "epc",
      })
      .select("id, status, current_step, insurance_display_id")
      .single();

    if (insErr || !inserted) {
      // The gate raises with errcode check_violation → friendly message.
      const msg = insErr?.message || "insert_failed";
      if (/insurance_not_enabled|check_violation/i.test(msg)) {
        return err("Insurance isn't enabled for your account yet.", 403);
      }
      return err(msg, 500);
    }

    return NextResponse.json({ ok: true, application: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/create] error:", msg);
    return err(msg, 500);
  }
}
