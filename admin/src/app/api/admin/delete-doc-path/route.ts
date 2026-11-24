// POST /api/admin/delete-doc-path  { table, id, column }
//
// Admin-only. Removes ONE document that is stored as a `*_path` text column on
// a parent row (as opposed to a user_application_docs row, which is deleted via
// deleteDocument()). It does exactly three things, in order:
//   1. Deletes exactly that ONE GCS object (the path currently in the column).
//   2. NULLs that single column on the row.
//   3. Writes a forensic admin_edit_log entry.
//
// Security:
//   • business_type === 'admin' → else 403 (same gate as every admin mutation).
//   • `table` and `column` are validated against a fixed ALLOWLIST — the route
//     can never null an arbitrary column or touch an arbitrary table.
//
// EPC-facing mandatory-doc gates are NOT bypassed: this route is admin-only, so
// an EPC can't call it, and the EPC apply flows still block save/continue when a
// required doc is absent (that logic is unchanged and lives in those flows).

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { deleteObject } from "@/lib/gcs";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fixed allowlist of deletable *_path columns per table. Anything not listed
// here is rejected — the route can only ever touch a known document column.
const ALLOWED: Record<string, Set<string>> = {
  epc_applications: new Set([
    "aadhaar_front_path", "aadhaar_back_path", "aadhaar_face_path",
    "customer_photo_path", "rooftop_photo_path",
    "coapp_aadhaar_front_path", "coapp_aadhaar_back_path", "coapp_aadhaar_face_path", "coapp_pan_path",
    "proforma_invoice_path", "ebill_path", "bank_statement_path",
  ]),
  insurance_applications: new Set([
    "policy_path", "pan_path", "aadhaar_front_path", "aadhaar_back_path",
    "plant_photo_path", "ebill_path", "invoice_path", "gst_path",
    "photo_panel_path", "photo_inverter_path", "photo_meter_path",
  ]),
};

export async function POST(req: NextRequest) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const body = await req.json().catch(() => ({}));
    const table = String((body as { table?: unknown }).table ?? "").trim();
    const id = String((body as { id?: unknown }).id ?? "").trim();
    const column = String((body as { column?: unknown }).column ?? "").trim();

    if (!ALLOWED[table]) return err("Invalid table.", 400);
    if (!ALLOWED[table].has(column)) return err("Invalid or non-deletable column.", 400);
    if (!UUID_RE.test(id)) return err("Invalid id.", 400);

    const supabase = dbAs(token);

    // Read the current path so we delete exactly that one GCS object. The
    // column is dynamic (validated against the allowlist above), so select the
    // whole row and read the field through an untyped view.
    const { data: row, error: loadErr } = await supabase
      .from(table)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!row) return err("not_found", 404);

    const path = (row as unknown as Record<string, unknown>)[column];
    const pathStr = typeof path === "string" ? path.trim() : "";
    if (!pathStr) return err("Nothing to delete — column is already empty.", 409);

    // 1. Delete exactly that ONE object (best-effort — a missing object must
    //    not block clearing the column).
    try {
      await deleteObject(pathStr);
    } catch (e) {
      console.warn("[delete-doc-path] GCS object delete failed:", e);
    }

    // 2. NULL the single column.
    const { error: updErr } = await supabase
      .from(table)
      .update({ [column]: null })
      .eq("id", id);
    if (updErr) return err(`Update failed: ${updErr.message}`, 500);

    // 3. Forensic audit trail.
    const actorId = String(claims.business_id ?? "");
    if (UUID_RE.test(actorId)) {
      await supabase.from("admin_edit_log").insert({
        business_id: actorId,
        actor: "admin",
        actor_id: actorId,
        action: "doc_removed",
        field: `${table}.${column}`,
        old_value: pathStr,
        new_value: null,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = errText(e);
    console.error("[delete-doc-path] error:", msg);
    return err(msg, 500);
  }
}
