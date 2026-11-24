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
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { logUserActivity } from "@/lib/user-activity-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allow-list module → table (prevents arbitrary table writes).
const TABLES: Record<string, string> = {
  epcs: "epc_business",
  apps: "epc_applications",
  loanleads: "loan_leads",
  leads: "customer_leads",
  insurance: "insurance_applications",
};

export async function POST(req: NextRequest) {
  try {
    // Reassignment is a Main-Admin capability.
    const auth = await requireLogin(req, { role: "main_admin", forbidden: "forbidden" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

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

    const supabase = dbAs(token);

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
