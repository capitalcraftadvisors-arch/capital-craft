// POST /api/admin/other-insurance/[id]/doc   { path, action: "sign" | "delete" }
//
// Main admin only. "sign" mints a 1-hour read URL, "delete" removes the
// document from the file and storage. The path must belong to THIS file
// (its policy_path or one of its kyc_docs).

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "@/lib/jwt";
import { getSignedReadUrl, deleteObject } from "@/lib/gcs";
import { otherInsuranceRow } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const ctx = await otherInsuranceRow(token, params.id);
    if ("error" in ctx) return err(ctx.error, ctx.status);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const path = typeof body.path === "string" ? body.path : "";
    const isPolicy = !!path && path === ctx.row.policy_path;
    const isKyc = !!path && ctx.row.kyc_docs.some((d) => d.path === path);
    if (!isPolicy && !isKyc) return err("Document does not belong to this file.", 403);

    if (body.action === "sign") {
      return NextResponse.json({ ok: true, url: await getSignedReadUrl(path, 3600) });
    }
    if (body.action === "delete") {
      const patch = isPolicy ? { policy_path: null } : { kyc_docs: ctx.row.kyc_docs.filter((d) => d.path !== path) };
      const { error: updErr } = await ctx.supabase.from("other_insurance").update(patch).eq("id", params.id);
      if (updErr) return err(`Delete failed: ${updErr.message}`, 500);
      await deleteObject(path);
      return NextResponse.json({ ok: true });
    }
    return err("Invalid action.", 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[other-insurance/doc] error:", msg);
    return err(msg, 500);
  }
}
