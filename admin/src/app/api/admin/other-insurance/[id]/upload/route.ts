// POST /api/admin/other-insurance/[id]/upload   multipart { file, kind }
//
// Main admin only (Other Insurance, migration 0093).
//   kind = "kyc"    → appended to kyc_docs (as many as needed)
//   kind = "policy" → policy_path (a re-upload replaces the old file)

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "@/lib/jwt";
import { uploadBuffer, deleteObject } from "@/lib/gcs";
import { otherInsuranceRow, compress, safeName, ACCEPTED } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const ctx = await otherInsuranceRow(token, params.id);
    if ("error" in ctx) return err(ctx.error, ctx.status);

    const form = await req.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "");
    if (!(file instanceof File)) return err("File is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);
    if (kind !== "kyc" && kind !== "policy") return err("Invalid upload kind.", 400);

    const { buf, mime } = await compress(file);
    const path = `other-insurance/${params.id}/${kind}/${Date.now()}_${safeName(file.name, kind)}`;
    await uploadBuffer(path, buf, mime);

    const patch = kind === "kyc"
      ? { kyc_docs: [...ctx.row.kyc_docs, { path, name: file.name || "KYC document", mime }] }
      : { policy_path: path };
    const { error: updErr } = await ctx.supabase.from("other_insurance").update(patch).eq("id", params.id);
    if (updErr) { await deleteObject(path); return err(`Save failed: ${updErr.message}`, 500); }
    if (kind === "policy" && ctx.row.policy_path) await deleteObject(ctx.row.policy_path);

    return NextResponse.json({ ok: true, path });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[other-insurance/upload] error:", msg);
    return err(msg, 500);
  }
}
