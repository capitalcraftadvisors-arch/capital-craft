// POST /api/admin/reassign
//
// Body: { module, record_id, assigned_to_user_id }
//   module               : 'epcs' | 'apps' | 'loanleads' | 'leads' | 'insurance'
//   record_id            : uuid of the record in that module's table
//   assigned_to_user_id  : uuid of the new owner, or null to unassign
//
// Reassigns ownership of a business record to a team member. MAIN_ADMIN only.
// Preserves created_by_user_id (never touched), updates assigned_to_user_id +
// last_updated_by_user_id, and appends a 'reassigned'/'assigned' row to
// user_activity_log. Runs under the caller's JWT (RLS admin_all + the guarded
// hierarchy columns are untouched here).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { isMainAdmin } from "@/lib/hierarchy";
import { logUserActivity } from "@/lib/user-activity-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Allow-list module → table (prevents arbitrary table writes).
const TABLES: Record<string, string> = {
  epcs: "epc_business",
  apps: "epc_applications",
  loanleads: "loan_leads",
  leads: "customer_leads",
  insurance: "insurance_applications",
};

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    // Reassignment is a Main-Admin capability.
    if (!isMainAdmin(claims)) return err("forbidden", 403);

    const body = (await req.json().catch(() => ({}))) as {
      module?: string; record_id?: string; assigned_to_user_id?: string | null;
    };
    const module = String(body.module ?? "");
    const recordId = String(body.record_id ?? "");
    const assignee = body.assigned_to_user_id ?? null;
    const table = TABLES[module];
    if (!table) return err("invalid module", 400);
    if (!UUID_RE.test(recordId)) return err("invalid record_id", 400);
    if (assignee !== null && !UUID_RE.test(String(assignee))) return err("invalid assigned_to_user_id", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Read the current owner (for the activity trail + assigned-vs-reassigned).
    const { data: before, error: readErr } = await supabase
      .from(table)
      .select("assigned_to_user_id")
      .eq("id", recordId)
      .maybeSingle();
    if (readErr) return err(readErr.message, 500);
    if (!before) return err("record not found", 404);
    const previous = (before as { assigned_to_user_id: string | null }).assigned_to_user_id ?? null;

    const { error: updErr } = await supabase
      .from(table)
      .update({ assigned_to_user_id: assignee, last_updated_by_user_id: claims.business_id })
      .eq("id", recordId);
    if (updErr) return err(updErr.message, 500);

    await logUserActivity(supabase, {
      actor_user_id: claims.business_id,
      subject_user_id: assignee,
      module,
      record_id: recordId,
      action: previous ? "reassigned" : "assigned",
      previous_value: previous,
      new_value: assignee,
    });

    return NextResponse.json({ ok: true, previous, assigned_to_user_id: assignee });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reassign] error:", msg);
    return err(msg, 500);
  }
}
