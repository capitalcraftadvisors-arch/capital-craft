// POST /api/admin/epc/[id]/proprietor-pan   { stakeholder_id }
//
// Proprietorship: the business PAN IS the proprietor's PAN, so the onboarding
// chat asks for it once. This files a copy of the business PAN as the
// proprietor's PAN (its own stored object, so deleting one never breaks the
// other) and reads it like a member PAN → { name, father_name, dob } for the
// proprietor's card.
//   already filed     → { ok, copied: false } (nothing touched)
//   no business PAN   → { ok: false, error: "no_business_pan" }
// Admin-only; every read / write goes through the caller's JWT (RLS).

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { downloadBuffer, uploadBuffer, deleteObject } from "@/lib/gcs";
import { geminiExtractPan } from "@/lib/doc-extractors";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const body = await req.json().catch(() => ({}));
    const sid = String(body?.stakeholder_id ?? "");
    if (!UUID_RE.test(sid) || !UUID_RE.test(params.id)) return err("bad_request", 400);

    const supabase = dbAs(token);

    const { data: biz } = await supabase.from("epc_business").select("business_type").eq("id", params.id).maybeSingle();
    if (!biz) return err("not_found", 404);
    if (biz.business_type !== "proprietorship") return err("not_proprietorship", 400);

    const { data: have } = await supabase.from("epc_documents").select("id")
      .eq("business_id", params.id).eq("stakeholder_id", sid).eq("category", "stakeholder_pan").limit(1);
    if (have?.length) return NextResponse.json({ ok: true, copied: false });

    const { data: src } = await supabase.from("epc_documents")
      .select("storage_path, file_name, mime_type, original_size_bytes, stored_size_bytes")
      .eq("business_id", params.id).eq("category", "pan_business").is("stakeholder_id", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!src) return err("no_business_pan", 404);

    const buffer = await downloadBuffer(src.storage_path);
    const mime = src.mime_type || "application/pdf";
    const safe = (src.file_name || "pan").replace(/[^\w.\-]+/g, "_").slice(0, 80);
    const path = `${params.id}/${sid}/stakeholder_pan/${crypto.randomUUID()}_${safe}`;
    await uploadBuffer(path, buffer, mime);
    const { error: insErr } = await supabase.from("epc_documents").insert({
      business_id: params.id, stakeholder_id: sid, category: "stakeholder_pan",
      storage_path: path, file_name: src.file_name, mime_type: mime,
      original_size_bytes: src.original_size_bytes, stored_size_bytes: src.stored_size_bytes,
    });
    if (insErr) { await deleteObject(path); return err(insErr.message, 500); }

    // Read it like a member PAN, so the proprietor's card fills as before.
    const g = await geminiExtractPan([{ buffer, mime }]).catch(() => null);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries({ name: g?.name, father_name: g?.father_name, dob: g?.dob })) {
      if (v && String(v).trim()) fields[k] = String(v).trim();
    }
    return NextResponse.json({ ok: true, copied: true, fields });
  } catch (e) {
    const msg = errText(e);
    console.error("[proprietor-pan] error:", msg);
    return err(msg, 500);
  }
}
