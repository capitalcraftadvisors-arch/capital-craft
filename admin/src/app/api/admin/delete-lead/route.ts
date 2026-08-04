// POST /api/admin/delete-lead  { leadId }
//
// Admin-only. Permanently deletes a single non-EPC customer lead.
//
// Leads (customer_leads) are plain form submissions — no uploaded documents,
// so there is no GCS folder to purge. The row is deleted and a forensic
// admin_edit_log entry is written on the actor admin's own business_id (the
// activity-log requirement), mirroring the other admin delete routes.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";

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

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const body = await req.json().catch(() => ({}));
    const leadId = String((body as { leadId?: unknown }).leadId ?? "").trim();
    if (!UUID_RE.test(leadId)) return err("Invalid leadId.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: target, error: loadErr } = await supabase
      .from("customer_leads")
      .select("id, name, mobile, lead_type")
      .eq("id", leadId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!target) return err("not_found", 404);

    const { data: deleted, error: delErr } = await supabase
      .from("customer_leads")
      .delete()
      .eq("id", leadId)
      .select("id");
    if (delErr) return err(`Delete failed: ${delErr.message}`, 500);
    if (!deleted || deleted.length === 0) return err("delete_no_rows_affected", 409);

    const actorId = String(claims.business_id ?? "");
    if (UUID_RE.test(actorId)) {
      const who = target.name || "(unnamed lead)";
      await supabase.from("admin_edit_log").insert({
        business_id: actorId,
        actor: "admin",
        actor_id: actorId,
        action: "lead_deleted",
        field: "target_lead",
        old_value: `${target.lead_type ?? "lead"} — ${who} (+91 ${target.mobile ?? "—"})`,
        new_value: null,
      });
    }

    return NextResponse.json({
      ok: true,
      deleted: { id: target.id, name: target.name ?? null },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[delete-lead] error:", msg);
    return err(msg, 500);
  }
}
