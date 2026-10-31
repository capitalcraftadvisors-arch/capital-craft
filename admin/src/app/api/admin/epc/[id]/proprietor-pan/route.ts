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
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { downloadBuffer, uploadBuffer, deleteObject } from "@/lib/gcs";
import { geminiExtractPan } from "@/lib/doc-extractors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const body = await req.json().catch(() => ({}));
    const sid = String(body?.stakeholder_id ?? "");
    if (!UUID_RE.test(sid) || !UUID_RE.test(params.id)) return err("bad_request", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[proprietor-pan] error:", msg);
    return err(msg, 500);
  }
}
