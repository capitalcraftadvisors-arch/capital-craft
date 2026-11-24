// POST /api/admin/loan-app/[id]/sign-doc
//
// Admin-only. Mints a 1-hour V4 signed read URL for a document stored as
// a *_path column on the epc_applications (loan) row — the Aadhaar
// front/back, e-bill, proforma invoice, bank statement and co-applicant
// documents that live as raw GCS paths rather than user_application_docs
// rows (those are viewed via /api/document/[id]).
//
// Security: the requested path is whitelisted against the actual
// *_path columns of THIS application, so an admin can only sign a path
// that genuinely belongs to the row they're viewing — never an arbitrary
// object key.
//
// Body: { path: string }  →  { ok: true, url } | { ok: false, error }

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { getSignedReadUrl } from "@/lib/gcs";
import { LOAN_PATH_COLUMNS as PATH_COLUMNS } from "@/lib/loan-doc-checklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireLogin(req); // any valid session; RLS + the path whitelist below
    // scope this to the caller's OWN application (admin sees all, an EPC only
    // its own row), so an EPC can view the documents on its own loan too.
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const body = await req.json().catch(() => ({}));
    const path = typeof (body as Record<string, unknown>).path === "string"
      ? String((body as Record<string, unknown>).path).trim()
      : "";
    if (!path) return err("Missing document path.", 400);

    const supabase = dbAs(token);

    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select(PATH_COLUMNS.join(", "))
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);

    // Whitelist: the path must match one of this row's stored *_path values.
    const row = app as unknown as Record<string, unknown>;
    const allowed = PATH_COLUMNS.some((col) => row[col] === path);
    if (!allowed) return err("Document does not belong to this application.", 403);

    // download:true → force a save under the object's file name.
    const download = (body as Record<string, unknown>).download === true;
    const url = await getSignedReadUrl(
      path,
      3600,
      download ? { downloadName: path.split("/").pop() || "document" } : undefined,
    );
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sign-doc] error:", msg);
    return err(msg, 500);
  }
}
