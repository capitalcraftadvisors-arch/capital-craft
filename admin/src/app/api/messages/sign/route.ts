// POST /api/messages/sign — mint a 1-hour signed read URL for a message
// attachment. The caller must be able to see the parent profile (admin = all,
// EPC = own), and the path must belong to that profile's message folder —
// so nobody can sign an arbitrary object key.
//
// Body: { kind, id, path }  →  { ok, url } | { ok, error }

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { getSignedReadUrl } from "@/lib/gcs";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PARENT = { loan: "epc_applications", insurance: "insurance_applications" } as const;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = String(b.kind ?? "") as keyof typeof PARENT;
    const parentId = String(b.id ?? "");
    const path = String(b.path ?? "").trim();
    if (!PARENT[kind]) return err("bad_kind", 400);
    if (!UUID_RE.test(parentId)) return err("bad_id", 400);
    if (!path || !path.startsWith(`messages/${kind}/${parentId}/`)) return err("bad_path", 403);

    const supabase = dbAs(token);
    const { data: parent } = await supabase.from(PARENT[kind]).select("id").eq("id", parentId).maybeSingle();
    if (!parent) return err("forbidden", 403);

    const url = await getSignedReadUrl(path, 3600);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    const msg = errText(e);
    console.error("[messages/sign] error:", msg);
    return err(msg, 500);
  }
}
