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
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { getSignedReadUrl } from "@/lib/gcs";
import { LOAN_PATH_COLUMNS as PATH_COLUMNS } from "@/lib/loan-doc-checklist";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const supabase = dbAs(token);
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
    const msg = errText(e);
    console.error("[doc-urls] error:", msg);
    return err(msg, 500);
  }
}
