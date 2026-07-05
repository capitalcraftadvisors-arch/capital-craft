// POST /api/admin/delete-epc  { businessId }
//
// Admin-only. Irreversibly destroys an EPC.
//
// Explicit child-first deletion order (rather than relying on cascade)
// to avoid the trigger-during-cascade FK race in 0018's
// log_epc_comment_change trigger. Even though the FKs are all CASCADE,
// the epc_comments AFTER-DELETE trigger tries to INSERT a
// comment_delete audit row referencing the parent's business_id — if
// the parent is being deleted in the same statement, the FK check on
// admin_edit_log.business_id fails. Migration 0021 makes the trigger
// swallow that violation (belt); this route also deletes children
// explicitly first so the trigger writes are harmless (suspenders).
//
// Deletion order:
//   1. All GCS files under `${businessId}/**` (business + stakeholder docs)
//   2. All GCS files under `applications/${appId}/**` for each loan app
//   3. epc_comments   — fires log trigger → inserts comment_delete audit
//                       rows (parent still exists, FK ok); those get
//                       cleaned in step 4.
//   4. admin_edit_log rows for this business_id — clears history.
//   5. epc_lender_status — no audit trigger on DELETE.
//   6. epc_documents  — no trigger writes to admin_edit_log.
//   7. epc_admin_info — no trigger.
//   8. epc_applications — RESTRICT FK on epc_business; must go before parent.
//                         Cascades user_application_docs.
//   9. epc_business   — WHERE-clause anti-admin belt. No children left.
//  10. Forensic audit_log entry attached to the ACTOR admin's own row so
//      it survives (the target's business_id is gone).
//
// Admin-account protection (four layers):
//   1. UI: View page hides the button when biz.business_type='admin'.
//   2. This route: loads the target row and 403s if it's admin.
//   3. SQL WHERE clause: the DELETE carries "and business_type != 'admin'"
//      so a race with demotion still results in 0 rows affected.
//   4. DB trigger prevent_admin_delete (migration 0020) raises regardless
//      of caller. Last line of defense for Studio / psql / service-role.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { deleteFolder } from "@/lib/gcs";

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

export async function POST(req: NextRequest) {
  try {
    // ── auth ──────────────────────────────────────────────
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    // ── input ─────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const businessId = String((body as { businessId?: unknown }).businessId ?? "").trim();
    if (!UUID_RE.test(businessId)) return err("Invalid businessId.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── layer 2: load target + admin-check ────────────────
    const { data: target, error: loadErr } = await supabase
      .from("epc_business")
      .select("id, business_type, contact_name, contact_mobile, epc_display_id")
      .eq("id", businessId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!target) return err("not_found", 404);
    if (target.business_type === "admin") return err("cannot_delete_admin", 403);

    // ── collect loan-app ids for GCS + FK-order delete ────
    const { data: apps, error: appsErr } = await supabase
      .from("epc_applications")
      .select("id")
      .eq("epc_business_id", businessId);
    if (appsErr) return err(appsErr.message, 500);
    const appIds = (apps ?? []).map((a: { id: string }) => a.id);

    // ── GCS purge ─────────────────────────────────────────
    // Best-effort. If a folder is empty (no docs uploaded) deleteFiles
    // returns immediately. We don't fail the whole delete on storage
    // issues — DB delete is still authoritative.
    try {
      await deleteFolder(`${businessId}/`);
      for (const appId of appIds) {
        await deleteFolder(`applications/${appId}/`);
      }
    } catch (e) {
      console.warn("[delete-epc] GCS purge partial failure:", e);
    }

    // ── Explicit child-first delete order ──────────────────
    // See file header for why we don't rely on cascade. Each step
    // is a hard failure — if any child delete errors out we stop
    // and return, leaving state partially cleaned but consistent
    // (the target epc_business row still exists so admin can retry).

    // Step 3 — epc_comments. Fires the log trigger which inserts
    // comment_delete audit rows referencing this business_id. Parent
    // still exists at this point, so the FK check passes. Those log
    // rows are cleaned up in step 4.
    {
      const { error } = await supabase.from("epc_comments").delete().eq("business_id", businessId);
      if (error) return err(`Comments delete failed: ${error.message}`, 500);
    }

    // Step 4 — admin_edit_log. Removes all audit history for this
    // business, including any comment_delete rows the previous step
    // just wrote via the 0018 trigger.
    {
      const { error } = await supabase.from("admin_edit_log").delete().eq("business_id", businessId);
      if (error) return err(`Audit-log delete failed: ${error.message}`, 500);
    }

    // Step 5 — epc_lender_status. The 0017 has_lender_approval sync
    // trigger will UPDATE epc_business.has_lender_approval to false;
    // that's a normal update and does not trip the demotion trigger.
    {
      const { error } = await supabase.from("epc_lender_status").delete().eq("business_id", businessId);
      if (error) return err(`Lender-status delete failed: ${error.message}`, 500);
    }

    // Step 6 — epc_documents.
    {
      const { error } = await supabase.from("epc_documents").delete().eq("business_id", businessId);
      if (error) return err(`Documents delete failed: ${error.message}`, 500);
    }

    // Step 7 — epc_admin_info (single row keyed by business_id).
    {
      const { error } = await supabase.from("epc_admin_info").delete().eq("business_id", businessId);
      if (error) return err(`Admin-info delete failed: ${error.message}`, 500);
    }

    // Step 8 — epc_applications (RESTRICT FK; must go before parent).
    // Cascades user_application_docs.
    if (appIds.length > 0) {
      const { error } = await supabase.from("epc_applications").delete().eq("epc_business_id", businessId);
      if (error) return err(`Loan-app delete failed: ${error.message}`, 500);
    }

    // Step 9 — epc_business. WHERE-clause anti-admin belt (layer 3).
    // .select() returns the deleted rows so we can confirm we hit one.
    // No cascades to worry about — children are already gone.
    const { data: deleted, error: delBizErr } = await supabase
      .from("epc_business")
      .delete()
      .eq("id", businessId)
      .neq("business_type", "admin")
      .select("id");
    if (delBizErr) return err(`Business delete failed: ${delBizErr.message}`, 500);
    if (!deleted || deleted.length === 0) {
      // Nothing was deleted — either the row was flipped to admin
      // between load and delete, or someone else deleted it first.
      return err("delete_no_rows_affected", 409);
    }

    // ── forensic audit trail ──────────────────────────────
    // Attach to the ACTOR admin's own business_id — otherwise the
    // log row would cascade-delete along with the target. This is a
    // durable breadcrumb: "admin X deleted EPC Y at time T".
    const actorId = String(claims.business_id ?? "");
    if (UUID_RE.test(actorId)) {
      await supabase.from("admin_edit_log").insert({
        business_id: actorId,
        actor: "admin",
        actor_id: actorId,
        action: "epc_deleted",
        field: "target_epc",
        old_value: `${target.epc_display_id ?? target.id} — ${target.contact_name ?? "(no name)"} — +91 ${target.contact_mobile ?? ""}`,
        new_value: null,
      });
      // Not fatal if this fails — the primary destroy already committed.
    }

    return NextResponse.json({
      ok: true,
      deleted: {
        id: target.id,
        display_id: target.epc_display_id,
        contact_name: target.contact_name,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[delete-epc] error:", msg);
    return err(msg, 500);
  }
}
