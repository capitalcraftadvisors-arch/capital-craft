// POST /api/epc/submit-self-edit
//
// EPC-only endpoint. Called by the wizard's Review page when an EPC
// finishes their one-time self-edit and clicks "Submit changes".
//
// Body: { before: { field: value, ... } }
//   Snapshot of the EPC's fields at the moment they CLICKED "Edit
//   Dashboard" (captured client-side in localStorage). We diff against
//   current DB state and write per-field audit rows for everything that
//   actually changed.
//
// Behavior:
//   1. Verify JWT. Reject if caller is admin (this endpoint is for EPCs).
//   2. Fetch current epc_business row.
//   3. For each tracked text field that differs from `before`: write
//      one `field_edit` audit row (actor='epc').
//   4. For stakeholders: if JSON-stringified arrays differ, write a
//      single `members_edited` audit row.
//   5. For business_references: same — single `references_edited` row.
//   6. Write a single `self_edit_submit` summary row.
//   7. UPDATE epc_business: epc_self_edited=true, epc_self_edited_at=now().
//      Trigger lets this UPDATE pass (OLD.epc_self_edited was still false);
//      every subsequent EPC-attributed write is blocked by the trigger
//      from this point forward.

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt, type JwtClaims } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

// Text fields where we log per-field old/new on diff. contact_mobile is
// excluded — admin made it read-only and we don't track it here either.
const TRACKED_TEXT_FIELDS = [
  "contact_name",
  "contact_email",
  "contact_designation",
  "business_type",
  "pan_number",
  "bank_account_number",
  "bank_ifsc",
  "bank_branch",
  "bank_account_holder",
  "bank_name",
] as const;

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);

    if (claims.business_type === "admin") {
      return err("admin_cannot_self_edit", 403);
    }

    const body = (await req.json()) as { before?: Record<string, unknown> };
    const before = body.before ?? {};

    const supabase = client(token);

    // Current state.
    const { data: current, error: fetchErr } = await supabase
      .from("epc_business")
      .select(
        "id, epc_self_edited, " + TRACKED_TEXT_FIELDS.join(", ") +
        ", stakeholders, business_references",
      )
      .eq("id", claims.business_id)
      .maybeSingle();
    if (fetchErr || !current) return err("not_found", 404);

    if ((current as { epc_self_edited?: boolean }).epc_self_edited === true) {
      return err("already_self_edited", 403);
    }

    // ── Per-field text diffs ──────────────────────────────────────────
    for (const f of TRACKED_TEXT_FIELDS) {
      const oldVal = normalize((before as Record<string, unknown>)[f]);
      const newVal = normalize((current as Record<string, unknown>)[f]);
      if (oldVal !== newVal) {
        await audit(supabase, claims, {
          action: "field_edit",
          field: f,
          old_value: oldVal,
          new_value: newVal,
        });
      }
    }

    // ── Members (stakeholders JSONB) diff ─────────────────────────────
    if (
      JSON.stringify((before as { stakeholders?: unknown }).stakeholders ?? []) !==
      JSON.stringify((current as { stakeholders?: unknown }).stakeholders ?? [])
    ) {
      await audit(supabase, claims, {
        action: "members_edited",
        field: "stakeholders",
        // Coarse log per user spec — don't dump per-member detail.
      });
    }

    // ── References (business_references JSONB) diff ───────────────────
    if (
      JSON.stringify((before as { business_references?: unknown }).business_references ?? []) !==
      JSON.stringify((current as { business_references?: unknown }).business_references ?? [])
    ) {
      await audit(supabase, claims, {
        action: "references_edited",
        field: "business_references",
      });
    }

    // ── Summary row ───────────────────────────────────────────────────
    await audit(supabase, claims, { action: "self_edit_submit" });

    // ── Flip the lock — this is the last EPC-attributed write allowed.
    // Trigger sees OLD.epc_self_edited=false, lets us through. After
    // this update commits, ANY further non-admin write to epc_business
    // or epc_documents raises check_violation.
    const nowIso = new Date().toISOString();
    const { error: lockErr } = await supabase
      .from("epc_business")
      .update({ epc_self_edited: true, epc_self_edited_at: nowIso })
      .eq("id", claims.business_id);
    if (lockErr) return err(lockErr.message, 500);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[submit-self-edit] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function client(token: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalize(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

async function audit(
  supabase: SupabaseClient,
  claims: JwtClaims,
  row: { action: string; field?: string; old_value?: string | null; new_value?: string | null },
) {
  try {
    await supabase.from("admin_edit_log").insert({
      business_id: claims.business_id,
      actor: "epc",
      actor_id: claims.business_id,
      action: row.action,
      field: row.field ?? null,
      old_value: row.old_value ?? null,
      new_value: row.new_value ?? null,
    });
  } catch (e) {
    console.warn("[submit-self-edit] audit insert failed:", e);
  }
}
