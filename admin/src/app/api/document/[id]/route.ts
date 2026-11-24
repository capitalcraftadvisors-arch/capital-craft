// GET    /api/document/[id]  → { ok, url }   1-hour V4 signed URL for viewing
// DELETE /api/document/[id]  → { ok }        deletes row (RLS) + GCS object
//
// Access control: we look up the doc using the user's JWT, so RLS decides
// whether they're allowed to see it (own data, or admin).
//
// Project documents (epc_project_documents, 0129 — the Partner Portal v2 vault)
// are found too; ?in=project looks there first (one read instead of four).

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteObject, getSignedReadUrl } from "@/lib/gcs";
import { err, dbAs, requireLogin } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FoundRow = { id: string; storage_path: string; category: string; business_id?: string };
type Found =
  | ({ table: "epc_documents" } & FoundRow)
  | ({ table: "user_application_docs" } & FoundRow)
  | ({ table: "stakeholder_docs" } & FoundRow)
  | ({ table: "epc_project_documents" } & FoundRow);

async function findProjectDoc(supabase: SupabaseClient, id: string): Promise<Found | null> {
  const p = await supabase
    .from("epc_project_documents")
    .select("id, storage_path, category")
    .eq("id", id)
    .maybeSingle();
  return p.data ? { table: "epc_project_documents", ...(p.data as FoundRow) } : null;
}

async function findDoc(supabase: SupabaseClient, id: string, projectFirst = false): Promise<Found | null> {
  if (projectFirst) {
    const p = await findProjectDoc(supabase, id);
    if (p) return p;
  }

  const e = await supabase
    .from("epc_documents")
    .select("id, storage_path, category, business_id")
    .eq("id", id)
    .maybeSingle();
  if (e.data) return { table: "epc_documents", ...(e.data as FoundRow) };

  const u = await supabase
    .from("user_application_docs")
    .select("id, storage_path, category")
    .eq("id", id)
    .maybeSingle();
  if (u.data) return { table: "user_application_docs", ...(u.data as FoundRow) };

  // Team member / partner documents (0106) — the main admin's only, by RLS.
  const s = await supabase
    .from("stakeholder_docs")
    .select("id, storage_path, category")
    .eq("id", id)
    .maybeSingle();
  if (s.data) return { table: "stakeholder_docs", ...(s.data as FoundRow) };

  // A project's document (0129) — whoever sees the project, by RLS.
  return projectFirst ? null : findProjectDoc(supabase, id);
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

// Last path segment (the stored file name) for the download's saved filename.
function baseName(p: string): string {
  const seg = p.split("/").pop() || "document";
  return seg || "document";
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const supabase = dbAs(token);
    const doc = await findDoc(supabase, params.id, req.nextUrl.searchParams.get("in") === "project");
    if (!doc) return err("not_found", 404);

    // Defense in depth alongside RLS: even if a future RLS change ever
    // exposed a gst_r3b row to a non-admin, this gate keeps signed URLs
    // out of their hands.
    const denial = requireAdminForCategory(doc, claims.business_type);
    if (denial) return denial;

    // ?download=1 → force a save (Content-Disposition: attachment) under the
    // object's own file name; otherwise a plain inline-viewable URL.
    const download = req.nextUrl.searchParams.get("download") === "1";
    const url = await getSignedReadUrl(
      doc.storage_path,
      3600,
      download ? { downloadName: baseName(doc.storage_path) } : undefined,
    );
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
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const supabase = dbAs(token);
    const doc = await findDoc(supabase, params.id, req.nextUrl.searchParams.get("in") === "project");
    if (!doc) return err("not_found", 404);

    const denial = requireAdminForCategory(doc, claims.business_type);
    if (denial) return denial;

    // A project document: RLS lets only the Owner / Admin or whoever added it
    // delete — a refused delete removes no row, so the file stays too.
    if (doc.table === "epc_project_documents") {
      const { data: gone, error: pErr } = await supabase
        .from("epc_project_documents")
        .delete()
        .eq("id", params.id)
        .select("id");
      if (pErr || !gone?.length) return err("You can delete only the documents you added.", 403);
      await deleteObject(doc.storage_path);
      return NextResponse.json({ ok: true });
    }

    // Delete the row first; RLS decides whether they may.
    const { error: dbErr } = await supabase
      .from(doc.table)
      .delete()
      .eq("id", params.id);
    if (dbErr) return err(dbErr.message, 403);

    // Then remove the GCS object. Best-effort: an orphan is harmless.
    await deleteObject(doc.storage_path);

    // Audit (epc_documents only).
    if (doc.table === "epc_documents" && doc.business_id) {
      try {
        await supabase.from("admin_edit_log").insert({
          business_id: doc.business_id,
          actor: claims.business_type === "admin" ? "admin" : "epc",
          actor_id: claims.business_id,
          action: "doc_delete",
          field: doc.category,
        });
      } catch (e) {
        console.warn("[document DELETE] audit insert failed:", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[document DELETE] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
