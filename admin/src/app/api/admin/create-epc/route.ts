// POST /api/admin/create-epc
//
// Admin-only. Creates a new epc_business row (source='manual', status='draft')
// for a mobile number the admin is onboarding on someone's behalf. Returns
// the new row's id + display_id so the client can begin impersonation.
//
// Idempotence-ish: if a row already exists with the given mobile, we DO NOT
// create a duplicate — we return the existing row's { id, display_id } and
// mark it as `duplicate: true` so the client can surface a "this EPC
// already exists" warning with a link to the detail page.
//
// The DB trigger from migration 0016 handles the display_id assignment on
// insert. This route never sets display_id manually.

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

const MOBILE_RE = /^[6-9]\d{9}$/;

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
    const mobileRaw = String((body as { mobile?: unknown }).mobile ?? "").replace(/\D/g, "");
    if (!MOBILE_RE.test(mobileRaw)) {
      return err("Enter a valid 10-digit Indian mobile.", 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Duplicate check — admin RLS lets us see any row.
    const { data: existing } = await supabase
      .from("epc_business")
      .select("id, epc_display_id, status, current_step, contact_name, business_type")
      .eq("contact_mobile", mobileRaw)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        business: {
          id: existing.id,
          display_id: existing.epc_display_id,
          status: existing.status,
          current_step: existing.current_step ?? 1,
          contact_name: existing.contact_name,
          business_type: existing.business_type,
        },
      });
    }

    // Insert. display_id is auto-populated by trigger from migration 0016.
    const { data: inserted, error: insertErr } = await supabase
      .from("epc_business")
      .insert({
        contact_mobile: mobileRaw,
        status: "draft",
        current_step: 1,
        source: "manual",
      })
      .select("id, epc_display_id, status, current_step, contact_name, business_type")
      .single();

    if (insertErr || !inserted) {
      return err(insertErr?.message || "insert_failed", 500);
    }

    return NextResponse.json({
      ok: true,
      duplicate: false,
      business: {
        id: inserted.id,
        display_id: inserted.epc_display_id,
        status: inserted.status,
        current_step: inserted.current_step ?? 1,
        contact_name: inserted.contact_name,
        business_type: inserted.business_type,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[create-epc] error:", msg);
    return err(msg, 500);
  }
}
