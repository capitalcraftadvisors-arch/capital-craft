// DELETE /api/admin/other-insurance/[id] — main admin only. Removes the file
// and every document stored under other-insurance/<id>/.

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "@/lib/jwt";
import { deleteFolder } from "@/lib/gcs";
import { otherInsuranceRow } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const ctx = await otherInsuranceRow(token, params.id);
    if ("error" in ctx) return err(ctx.error, ctx.status);

    const { error: delErr } = await ctx.supabase.from("other_insurance").delete().eq("id", params.id);
    if (delErr) return err(`Delete failed: ${delErr.message}`, 500);
    await deleteFolder(`other-insurance/${params.id}/`).catch(() => { /* best effort */ });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[other-insurance/delete] error:", msg);
    return err(msg, 500);
  }
}
