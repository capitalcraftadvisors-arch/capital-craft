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
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const leadId = params.id;
    if (!UUID_RE.test(leadId)) return err("Invalid lead id.", 400);

    const supabase = dbAs(token);

    // Load the lead.
    const { data: lead, error: leadErr } = await supabase
      .from("loan_leads")
      .select("id, status, name, mobile, email, dob, address, lead_owner_name, total_project_cost, loan_amount, project_size, project_size_unit, epc_business_id, converted_application_id")
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
    const seed: Record<string, unknown> = {
      epc_business_id: lead.epc_business_id,
      created_by: "admin",
      // Hierarchy (0066): the user performing the conversion owns the new app.
      created_by_user_id: claims.business_id,
      assigned_to_user_id: claims.business_id,
      last_updated_by_user_id: claims.business_id,
      status: "draft",
      current_step: 1,
      borrower_name: lead.name ?? null,
      borrower_mobile: lead.mobile ?? null,
      borrower_email: lead.email ?? null,
      borrower_dob: lead.dob ?? null,
      borrower_address: lead.address ?? null,
      install_address: lead.address ?? null,
      lead_owner_name: lead.lead_owner_name ?? null,
      total_project_cost: lead.total_project_cost ?? null,
      loan_amount_required: lead.loan_amount ?? null,
      project_size: lead.project_size ?? null,
      project_size_unit: lead.project_size_unit ?? null,
    };
    let { data: app, error: insErr } = await supabase.from("epc_applications").insert(seed).select("id").single();
    // lead_owner_name lands with migration 0074. Until the column exists in
    // prod (42703 = undefined column), convert without it — self-heals once
    // the migration runs.
    if (insErr?.code === "42703" && /lead_owner_name/.test(insErr.message ?? "")) {
      const { lead_owner_name: _dropped, ...rest } = seed; void _dropped;
      ({ data: app, error: insErr } = await supabase.from("epc_applications").insert(rest).select("id").single());
    }
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
    const msg = errText(e);
    console.error("[convert-to-loan-app] error:", msg);
    return err(msg, 500);
  }
}
