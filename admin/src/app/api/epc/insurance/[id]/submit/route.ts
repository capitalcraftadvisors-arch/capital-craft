// POST /api/epc/insurance/[id]/submit
//
// Marks the insurance application submitted. Like the loan flow, it does NOT
// lock the record — the EPC/admin can revisit and edit; a re-submit just
// refreshes submitted_at.

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { insuranceClient, UUID_RE } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    await verifyJwt(token);
    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    // Submitting puts it in the admin's queue. 'submitted' is no longer a valid
    // status (migration 0047) — an application awaiting our review IS
    // under_review; the admin then moves it to issued / hold / rejected.
    const now = new Date().toISOString();
    const supabase = insuranceClient(token);
    const { error: updErr } = await supabase
      .from("insurance_applications")
      .update({ status: "under_review", submitted_at: now })
      .eq("id", id);
    if (updErr) return err(`Submit failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true, status: "under_review", submitted_at: now });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/submit] error:", msg);
    return err(msg, 500);
  }
}
