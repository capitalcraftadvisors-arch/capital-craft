// GET    /api/document/[id]  → { ok, url }   1-hour V4 signed URL for viewing
// DELETE /api/document/[id]  → { ok }        deletes row (RLS) + GCS object
//
// Access control: we look up the doc using the user's JWT, so RLS decides
// whether they're allowed to see it (own data, or admin).

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { deleteObject, getSignedReadUrl } from "@/lib/gcs";
import { getBearerToken, verifyJwt } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

type FoundRow = { id: string; storage_path: string; category: string };
type Found =
  | ({ table: "epc_documents" } & FoundRow)
  | ({ table: "user_application_docs" } & FoundRow);

async function findDoc(supabase: SupabaseClient, id: string): Promise<Found | null> {
  const e = await supabase
    .from("epc_documents")
    .select("id, storage_path, category")
    .eq("id", id)
    .maybeSingle();
  if (e.data) return { table: "epc_documents", ...(e.data as FoundRow) };

  const u = await supabase
    .from("user_application_docs")
    .select("id, storage_path, category")
    .eq("id", id)
    .maybeSingle();
  if (u.data) return { table: "user_application_docs", ...(u.data as FoundRow) };

  return null;
}

// Admin-only categories (defense-in-depth alongside RLS).
const ADMIN_ONLY_EPC_CATEGORIES = new Set(["gst_r3b"]);

function requireAdminForCategory(
  doc: Found,
  businessType: string | null,
): NextResponse | null {
  if (
    doc.table === "epc_documents" &&
    ADMIN_ONLY_EPC_CATEGORIES.has(doc.category) &&
    businessType !== "admin"
  ) {
    return err("admin_only", 403);
  }
  return null;
}

function client(token: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);

    const supabase = client(token);
    const doc = await findDoc(supabase, params.id);
    if (!doc) return err("not_found", 404);

    // Defense in depth alongside RLS: even if a future RLS change ever
    // exposed a gst_r3b row to a non-admin, this gate keeps signed URLs
    // out of their hands.
    const denial = requireAdminForCategory(doc, claims.business_type);
    if (denial) return denial;

    const url = await getSignedReadUrl(doc.storage_path, 3600);
    return NextResponse.json({ ok: true, url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[document GET] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);

    const supabase = client(token);
    const doc = await findDoc(supabase, params.id);
    if (!doc) return err("not_found", 404);

    const denial = requireAdminForCategory(doc, claims.business_type);
    if (denial) return denial;

    // Delete the row first; RLS decides whether they may.
    const { error: dbErr } = await supabase
      .from(doc.table)
      .delete()
      .eq("id", params.id);
    if (dbErr) return err(dbErr.message, 403);

    // Then remove the GCS object. Best-effort: an orphan is harmless.
    await deleteObject(doc.storage_path);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[document DELETE] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
