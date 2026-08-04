// POST /api/admin/delete-insurance  { applicationId }
//
// Admin-only. Irreversibly destroys a single insurance application.
//
// Mirrors /api/admin/delete-loan-app. An insurance application keeps all its
// documents as `*_path` columns on the insurance_applications row plus the
// physical files under `insurance/${appId}/**` in GCS. There are no child
// tables to cascade, so the order is:
//   1. GCS files under `insurance/${appId}/**` (all uploaded docs).
//   2. insurance_applications row.
//   3. Forensic admin_edit_log entry on the ACTOR admin's own business_id
//      (so it survives the row deletion) — the activity-log requirement.
//
// All DB access uses the admin's token (admin RLS permits the delete).

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
    const applicationId = String((body as { applicationId?: unknown }).applicationId ?? "").trim();
    if (!UUID_RE.test(applicationId)) return err("Invalid applicationId.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── load target ───────────────────────────────────────
    const { data: target, error: loadErr } = await supabase
      .from("insurance_applications")
      .select("id, aadhaar_name, insurance_display_id")
      .eq("id", applicationId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!target) return err("not_found", 404);

    // ── GCS purge (best-effort) ───────────────────────────
    try {
      await deleteFolder(`insurance/${applicationId}/`);
    } catch (e) {
      console.warn("[delete-insurance] GCS purge partial failure:", e);
    }

    // ── delete the application row ─────────────────────────
    const { data: deleted, error: delErr } = await supabase
      .from("insurance_applications")
      .delete()
      .eq("id", applicationId)
      .select("id");
    if (delErr) return err(`Delete failed: ${delErr.message}`, 500);
    if (!deleted || deleted.length === 0) return err("delete_no_rows_affected", 409);

    // ── forensic audit trail on the actor admin's own row ─
    const actorId = String(claims.business_id ?? "");
    if (UUID_RE.test(actorId)) {
      const who = target.aadhaar_name || "(unnamed)";
      await supabase.from("admin_edit_log").insert({
        business_id: actorId,
        actor: "admin",
        actor_id: actorId,
        action: "insurance_app_deleted",
        field: "target_insurance_app",
        old_value: `${target.insurance_display_id ?? target.id} — ${who}`,
        new_value: null,
      });
      // Not fatal if this fails — the primary destroy already committed.
    }

    return NextResponse.json({
      ok: true,
      deleted: {
        id: target.id,
        display_id: target.insurance_display_id,
        applicant: target.aadhaar_name || null,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[delete-insurance] error:", msg);
    return err(msg, 500);
  }
}
