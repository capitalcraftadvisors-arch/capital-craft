// POST /api/admin/ops/action
//
// Body: { source, id, action, payload? }
//   source : 'loan' | 'insurance' | 'lead' | 'epc'
//   id     : record uuid
//   action : 'log_call' | 'doc_received' | 'move_stage' | 'record_disbursement' | 'reassign'
//   payload: { note?, assigned_to_user_id?, amount?, tranche? }
//
// Persists the Ops Board side-panel actions to the relevant source table AND
// appends to user_activity_log with the LOGGED-IN actor. Runs under the caller's
// JWT, so RLS (0067) already guarantees an RM can only touch their own cases;
// reassignment additionally requires MAIN_ADMIN.

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
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SRC: Record<string, { table: string; module: string }> = {
  loan: { table: "epc_applications", module: "apps" },
  insurance: { table: "insurance_applications", module: "insurance" },
  lead: { table: "loan_leads", module: "loanleads" },
  epc: { table: "epc_business", module: "epcs" },
};

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// One-step stage advance per source (+ the timestamp columns the board reads).
function nextStage(source: string, status: string): { status: string; stamp?: Record<string, unknown> } | null {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  if (source === "loan") {
    const map: Record<string, string> = { draft: "under_review", submitted: "under_review", on_hold: "docs_sent", under_review: "docs_sent", docs_sent: "approved" };
    const to = map[status];
    if (!to || to === status) return null;
    const stamp: Record<string, unknown> = {};
    if (to === "docs_sent") stamp.docs_sent_at = now;
    if (to === "approved") stamp.approved_at = now;
    return { status: to, stamp };
  }
  if (source === "insurance") {
    const map: Record<string, string> = { draft: "under_review", hold: "under_review", under_review: "issued" };
    const to = map[status];
    return to && to !== status ? { status: to } : null;
  }
  if (source === "epc") {
    const map: Record<string, string> = { draft: "under_review", on_hold: "under_review", under_review: "approved" };
    const to = map[status];
    return to && to !== status ? { status: to, stamp: to === "under_review" ? { submitted_at: now } : {} } : null;
  }
  if (source === "lead") {
    const map: Record<string, string> = { draft: "under_review" };
    const to = map[status];
    return to && to !== status ? { status: to, stamp: { reviewed_at: now } } : null;
  }
  return null;
}

// Map a target kanban column (a key in the source's OWN column set) → the
// source's status (+ stamps) for drag-drop. Columns that require a lender
// action, a rejection reason, or an amount are intentionally absent → null
// (the board blocks the drop before it reaches here).
function columnToStatus(source: string, col: string): { status: string; stamp?: Record<string, unknown> } | null {
  const now = new Date().toISOString();
  if (source === "loan") {
    // Loans move via their own screens now; the only direct board move is → Docs Pending.
    const m: Record<string, string> = { ready_login: "under_review", docs_pending: "on_hold", send_lender: "docs_sent", approved_rejected: "approved" };
    const s = m[col]; if (!s) return null;
    const stamp: Record<string, unknown> = {};
    if (s === "docs_sent") stamp.docs_sent_at = now;
    if (s === "on_hold") stamp.hold_at = now;
    if (s === "approved") stamp.approved_at = now;
    return { status: s, stamp };
  }
  if (source === "insurance") {
    // docs | docs_pending | review | issued | rejected
    const m: Record<string, string> = { docs: "draft", docs_pending: "hold", review: "under_review", issued: "issued" };
    const s = m[col]; return s ? { status: s } : null;
  }
  if (source === "lead") {
    // new | review | converted
    const m: Record<string, string> = { new: "draft", review: "under_review" };
    const s = m[col]; return s ? { status: s, stamp: { reviewed_at: now } } : null;
  }
  if (source === "epc") {
    // unseen | doc_uploaded | docs_pending | review_cc | send_lender | approved | rejected
    const m: Record<string, string> = { docs_pending: "on_hold", review_cc: "under_review", approved: "approved" };
    const s = m[col]; return s ? { status: s } : null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("forbidden", 403);
    const me = claims.business_id;

    const body = (await req.json().catch(() => ({}))) as {
      source?: string; id?: string; action?: string;
      payload?: { note?: string; assigned_to_user_id?: string | null; amount?: number; tranche?: number };
    };
    const source = String(body.source ?? "");
    const id = String(body.id ?? "");
    const action = String(body.action ?? "");
    const p = body.payload ?? {};
    const meta = SRC[source];
    if (!meta) return err("invalid source", 400);
    if (!UUID_RE.test(id)) return err("invalid id", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const now = new Date().toISOString();
    const touch: Record<string, unknown> = { last_updated_by_user_id: me };
    if (source === "lead") touch.reviewed_at = now; // leads have no updated_at trigger

    let patch: Record<string, unknown> | null = null;
    let logAction = action;
    let logValue: string | null = p.note ?? null;

    if (action === "log_call") {
      patch = { ...touch };
      logAction = "call";
      logValue = p.note || "Call logged";
    } else if (action === "doc_received") {
      patch = { ...touch };
      if (source === "loan") patch.review_notes = null; // clear blocker
      logAction = "doc_received";
      logValue = p.note || "Document received";
    } else if (action === "move_stage") {
      // Read current status, compute next.
      const { data: cur, error: rErr } = await supabase.from(meta.table).select("status").eq("id", id).maybeSingle();
      if (rErr) return err(rErr.message, 500);
      if (!cur) return err("case not found", 404);
      const step = nextStage(source, (cur as { status: string }).status);
      if (!step) return err("No further stage from here (use the case's own page for final steps).", 400);
      patch = { ...touch, status: step.status, ...(step.stamp || {}) };
      logAction = "status_change";
      logValue = `→ ${step.status}`;
    } else if (action === "set_stage") {
      // Drag-drop to a specific column.
      const col = typeof (body.payload as { column?: string })?.column === "string" ? (body.payload as { column: string }).column : "";
      // Loans are driven from their own screens now (change #10); the only direct
      // board move is → Docs Pending (put on hold).
      if (source === "loan" && col !== "docs_pending") return err("Update this loan stage from the loan’s own screen.", 400);
      const mapped = columnToStatus(source, col);
      if (!mapped) return err("This case can't move to that stage.", 400);
      patch = { ...touch, status: mapped.status, ...(mapped.stamp || {}) };
      logAction = "status_change";
      logValue = `→ ${col}`;
    } else if (action === "record_disbursement") {
      if (source !== "loan") return err("Disbursement applies to loan cases only.", 400);
      const amount = Number(p.amount);
      const tranche = p.tranche === 2 ? 2 : 1;
      if (!isFinite(amount) || amount <= 0) return err("Enter a valid disbursement amount.", 400);
      patch = { ...touch };
      if (tranche === 1) {
        patch.first_disbursement_amount = amount;
        patch.first_disbursement_date = now.slice(0, 10);
        patch.status = "disbursed";
      } else {
        patch.second_disbursement_amount = amount;
        patch.second_disbursement_date = now.slice(0, 10);
      }
      logAction = "disbursement";
      logValue = `Tranche ${tranche}: ₹${amount.toLocaleString("en-IN")}`;
    } else if (action === "reassign") {
      const to = p.assigned_to_user_id ?? null;
      if (to !== null && !UUID_RE.test(String(to))) return err("invalid assignee", 400);
      if (!SERVICE_KEY) return err("reassign unavailable (service key not set)", 500);
      // Reassignment changes the owner AWAY from the actor, which their own RLS
      // policy would block — so we use an elevated client and enforce tier
      // permissions here in code.
      const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const role = claims.hierarchy_role || (isMainAdmin(claims) ? "MAIN_ADMIN" : "");

      // Actor + current owner + target relationships.
      const [{ data: actor }, { data: before }, { data: target }] = await Promise.all([
        svc.from("epc_business").select("id, role, parent_user_id").eq("id", me).maybeSingle(),
        svc.from(meta.table).select("assigned_to_user_id").eq("id", id).maybeSingle(),
        to ? svc.from("epc_business").select("id, role, parent_user_id").eq("id", to).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!before) return err("case not found", 404);
      const prev = (before as { assigned_to_user_id: string | null }).assigned_to_user_id ?? null;
      const actorParent = (actor as { parent_user_id: string | null } | null)?.parent_user_id ?? null;
      const targetParent = (target as { parent_user_id: string | null } | null)?.parent_user_id ?? null;

      // Can the actor TOUCH this case? (must currently own it, or be over the owner)
      let canTouch = isMainAdmin(claims);
      if (!canTouch && role === "MANAGER") {
        canTouch = prev === me;
        if (!canTouch && prev) {
          const { data: po } = await svc.from("epc_business").select("parent_user_id").eq("id", prev).maybeSingle();
          canTouch = (po as { parent_user_id: string | null } | null)?.parent_user_id === me;
        }
      }
      if (!canTouch && role === "OPERATIONS_USER") canTouch = prev === me;
      if (!canTouch) return err("You can only reassign your own cases.", 403);

      // Is the TARGET allowed for this actor?
      let targetOk = isMainAdmin(claims) || to === null;
      if (!targetOk && role === "MANAGER") targetOk = to === me || targetParent === me;         // self or own RM
      if (!targetOk && role === "OPERATIONS_USER") targetOk = to === actorParent || to === me;   // send up to manager, or self
      if (!targetOk) return err("You can only assign within your team.", 403);

      const { error: uErr } = await svc.from(meta.table).update({ assigned_to_user_id: to, last_updated_by_user_id: me }).eq("id", id);
      if (uErr) return err(uErr.message, 500);
      await logUserActivity(svc, { actor_user_id: me, subject_user_id: to, module: meta.module, record_id: id, action: prev ? "reassigned" : "assigned", previous_value: prev, new_value: to });
      return NextResponse.json({ ok: true });
    } else {
      return err("unknown action", 400);
    }

    if (patch) {
      const { error: uErr } = await supabase.from(meta.table).update(patch).eq("id", id);
      if (uErr) return err(uErr.message, 500);
    }
    await logUserActivity(supabase, { actor_user_id: me, module: meta.module, record_id: id, action: logAction, new_value: logValue });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ops/action] error:", msg);
    return err(msg, 500);
  }
}
