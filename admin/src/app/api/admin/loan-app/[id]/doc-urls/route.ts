// GET /api/admin/loan-app/[id]/doc-urls
//
// Signs EVERY document of one loan application in ONE request — the
// user_application_docs rows and the *_path columns — so the profile can show
// pictures and open any document without a sign call per file. It replaces the
// profile's old header-photo sign call, so a profile open costs one Supabase
// read here (row + embedded docs), not one per document.
//
// Security: same as sign-doc — the caller's JWT runs the read under RLS, and
// only paths actually stored on THIS application are signed.
//
// → { ok: true, rows: { [docId]: url }, paths: { [path]: url } }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { getSignedReadUrl } from "@/lib/gcs";
import { LOAN_PATH_COLUMNS as PATH_COLUMNS } from "@/lib/loan-doc-checklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    await verifyJwt(token);

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select(`${PATH_COLUMNS.join(", ")}, user_application_docs(id, storage_path)`)
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app) return err("Loan application not found.", 404);

    const row = app as unknown as Record<string, unknown> & { user_application_docs?: { id: string; storage_path: string | null }[] };
    const paths = [...new Set(PATH_COLUMNS.map((c) => row[c]).filter((p): p is string => typeof p === "string" && !!p))];
    const docs = (row.user_application_docs ?? []).filter((d) => !!d.storage_path);

    const sign = (p: string) => getSignedReadUrl(p, 3600).catch(() => null);
    const [pathUrls, rowUrls] = await Promise.all([
      Promise.all(paths.map(sign)),
      Promise.all(docs.map((d) => sign(d.storage_path as string))),
    ]);

    const out = { ok: true, rows: {} as Record<string, string>, paths: {} as Record<string, string> };
    paths.forEach((p, i) => { if (pathUrls[i]) out.paths[p] = pathUrls[i] as string; });
    docs.forEach((d, i) => { if (rowUrls[i]) out.rows[d.id] = rowUrls[i] as string; });
    return NextResponse.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[doc-urls] error:", msg);
    return err(msg, 500);
  }
}
