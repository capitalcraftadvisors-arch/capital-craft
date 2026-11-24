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
import { err, dbAs, requireLogin } from "@/lib/api";
import { MOBILE_RE } from "@/lib/validators";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const body = await req.json().catch(() => ({}));
    const mobileRaw = String((body as { mobile?: unknown }).mobile ?? "").replace(/\D/g, "");
    if (!MOBILE_RE.test(mobileRaw)) {
      return err("Enter a valid 10-digit Indian mobile.", 400);
    }

    const supabase = dbAs(token);

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
        // Hierarchy (0066): the admin/ops user who added this EPC.
        created_by_user_id: claims.business_id,
        assigned_to_user_id: claims.business_id,
        last_updated_by_user_id: claims.business_id,
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
    const msg = errText(e);
    console.error("[create-epc] error:", msg);
    return err(msg, 500);
  }
}
