// POST /api/epc/insurance/[id]/save-fields   JSON { gst_legal_name?, gst_trade_name?, gstin?, plant_address? }
//
// Persists the EPC-editable OCR fields (GST legal/trade/GSTIN corrections and
// the confirmed plant address) without advancing a step. A strict whitelist —
// nothing else on the row can be written through here. RLS scopes to the EPC's
// own application.

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { insuranceClient, UUID_RE } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = ["gst_legal_name", "gst_trade_name", "gstin", "plant_address"] as const;

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

    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      if (f in b) {
        const v = b[f];
        patch[f] = typeof v === "string" ? (v.trim() || null) : null;
      }
    }
    if (Object.keys(patch).length === 0) return err("Nothing to save.", 400);

    const supabase = insuranceClient(token);
    const { error: updErr } = await supabase.from("insurance_applications").update(patch).eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/save-fields] error:", msg);
    return err(msg, 500);
  }
}
