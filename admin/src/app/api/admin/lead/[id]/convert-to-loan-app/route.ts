// POST /api/admin/lead/[id]/convert-to-loan-app
//
// Admin-only. Converts a loan_leads row into a DRAFT epc_applications row,
// seeding the borrower/loan fields from the lead, then marks the lead
// converted (so it disappears from the Lead dashboard). Uses the caller's
// admin JWT — the 0017 loan_app_gate trigger bypasses for admins, so the
// draft is created regardless of the EPC's lender-approval state ("any
// selected EPC").
//
// Returns: { ok: true, application_id } | { ok: false, error }

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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const leadId = params.id;
    if (!UUID_RE.test(leadId)) return err("Invalid lead id.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Load the lead.
    const { data: lead, error: leadErr } = await supabase
      .from("loan_leads")
      .select("id, status, name, mobile, email, dob, address, loan_amount, project_size, project_size_unit, epc_business_id, converted_application_id")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr) return err(leadErr.message, 500);
    if (!lead) return err("Lead not found.", 404);
    if (lead.status === "converted") return err("This lead has already been converted.", 409);
    if (!lead.epc_business_id) return err("Assign a real EPC to this lead before converting.", 400);

    // Verify the EPC exists and is not the admin row (any approval state OK).
    const { data: epc, error: epcErr } = await supabase
      .from("epc_business")
      .select("id, business_type")
      .eq("id", lead.epc_business_id)
      .maybeSingle();
    if (epcErr) return err(epcErr.message, 500);
    if (!epc) return err("The lead's EPC no longer exists.", 404);
    if (epc.business_type === "admin") return err("Cannot convert to the admin row.", 403);

    // Create the draft loan application, seeded from the lead. status='draft'
    // + current_step=1 matches a normal new draft; the seeded fields just
    // pre-fill the wizard.
    const { data: app, error: insErr } = await supabase
      .from("epc_applications")
      .insert({
        epc_business_id: lead.epc_business_id,
        created_by: "admin",
        status: "draft",
        current_step: 1,
        borrower_name: lead.name ?? null,
        borrower_mobile: lead.mobile ?? null,
        borrower_email: lead.email ?? null,
        borrower_dob: lead.dob ?? null,
        borrower_address: lead.address ?? null,
        install_address: lead.address ?? null,
        loan_amount_required: lead.loan_amount ?? null,
        project_size: lead.project_size ?? null,
        project_size_unit: lead.project_size_unit ?? null,
      })
      .select("id")
      .single();
    if (insErr || !app) return err(insErr?.message || "Could not create the loan application.", 500);

    // Mark the lead converted so it leaves the dashboard.
    const { error: updErr } = await supabase
      .from("loan_leads")
      .update({
        status: "converted",
        converted_application_id: (app as { id: string }).id,
        converted_at: new Date().toISOString(),
      })
      .eq("id", leadId);
    if (updErr) {
      // The loan app was created; surface the partial state rather than silently succeeding.
      return err(`Loan app created but the lead couldn't be marked converted: ${updErr.message}`, 500);
    }

    return NextResponse.json({ ok: true, application_id: (app as { id: string }).id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[convert-to-loan-app] error:", msg);
    return err(msg, 500);
  }
}
