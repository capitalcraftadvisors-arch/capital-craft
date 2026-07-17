// POST /api/epc/insurance/[id]/save   JSON { step, plant_address?, invoice_confirmed_amount? }
//
// Persists the free-text / confirm fields for a step and advances
// current_step. Documents are already written by the extract/upload routes,
// so this only handles what the EPC types + the step transition.
//   step 1 → nothing extra to persist; just advance to 2.
//   step 2 → plant_address + invoice_confirmed_amount, advance to 3.

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

    const body = await req.json().catch(() => ({}));
    const b = body as Record<string, unknown>;
    const step = Number(b.step);
    if (step !== 1 && step !== 2) return err("Invalid step.", 400);

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};
    if (step === 1) {
      patch.step1_completed_at = now;
      patch.current_step = 2;
    } else {
      const addr = typeof b.plant_address === "string" ? b.plant_address.trim() || null : null;
      const conf = b.invoice_confirmed_amount == null || b.invoice_confirmed_amount === ""
        ? null : Number(b.invoice_confirmed_amount);
      const amount = Number.isFinite(conf as number) ? (conf as number) : null;
      patch.plant_address = addr;
      patch.invoice_confirmed_amount = amount;
      // Sum insured is AUTO-TAGGED from the confirmed final-invoice amount —
      // never typed by the EPC. An admin can override it later.
      patch.sum_insured = amount;
      patch.step2_completed_at = now;
      patch.current_step = 3;
    }

    const supabase = insuranceClient(token);
    const { error: updErr } = await supabase.from("insurance_applications").update(patch).eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true, next_step: patch.current_step });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/save] error:", msg);
    return err(msg, 500);
  }
}
