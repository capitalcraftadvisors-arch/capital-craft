// POST /api/messages/sign — mint a 1-hour signed read URL for a message
// attachment. The caller must be able to see the parent profile (admin = all,
// EPC = own), and the path must belong to that profile's message folder —
// so nobody can sign an arbitrary object key.
//
// Body: { kind, id, path }  →  { ok, url } | { ok, error }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { getSignedReadUrl } from "@/lib/gcs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARENT = { loan: "epc_applications", insurance: "insurance_applications" } as const;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    await verifyJwt(token);

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = String(b.kind ?? "") as keyof typeof PARENT;
    const parentId = String(b.id ?? "");
    const path = String(b.path ?? "").trim();
    if (!PARENT[kind]) return err("bad_kind", 400);
    if (!UUID_RE.test(parentId)) return err("bad_id", 400);
    if (!path || !path.startsWith(`messages/${kind}/${parentId}/`)) return err("bad_path", 403);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: parent } = await supabase.from(PARENT[kind]).select("id").eq("id", parentId).maybeSingle();
    if (!parent) return err("forbidden", 403);

    const url = await getSignedReadUrl(path, 3600);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[messages/sign] error:", msg);
    return err(msg, 500);
  }
}
