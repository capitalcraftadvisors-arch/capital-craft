// DELETE /api/admin/other-insurance/[id] — main admin only. Removes the file
// and every document stored under other-insurance/<id>/.

import { NextRequest, NextResponse } from "next/server";
import { err } from "@/lib/api";
import { deleteFolder } from "@/lib/gcs";
import { otherInsuranceRow } from "@/lib/insurance-server";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await otherInsuranceRow(req, params.id);
    if (ctx instanceof Response) return ctx;

    const { error: delErr } = await ctx.supabase.from("other_insurance").delete().eq("id", params.id);
    if (delErr) return err(`Delete failed: ${delErr.message}`, 500);
    await deleteFolder(`other-insurance/${params.id}/`).catch(() => { /* best effort */ });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = errText(e);
    console.error("[other-insurance/delete] error:", msg);
    return err(msg, 500);
  }
}
