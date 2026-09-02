// PATCH /api/admin/loan-app/[id]/update-fields
//
// Admin-only. A surgical field writer used by the AI concierge in EDIT mode.
// Unlike the complete-step-N routes (which advance current_step and log
// step-completions), this updates ONLY the allow-listed columns you send and
// leaves current_step, status, and the wizard cursor untouched — so editing a
// finished profile never rewinds it or pollutes the activity trail.
//
// Body: a partial map of column → value. Unknown keys are ignored. Empty
// strings become NULL; numeric / date / boolean columns are coerced.
//
// Returns: { ok, updated: string[] } | { ok:false, error }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { logLoanActivityServer } from "@/lib/loan-activity-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columns the concierge is allowed to write, grouped by coercion type.
const TEXT_COLS = new Set([
  "borrower_name", "borrower_mobile", "borrower_email", "lead_owner_name",
  "epc_business_id", // chat "change EPC partner" re-points the application in place
  "borrower_pan", "borrower_father_name", "customer_photo_path",
  "install_pincode", "install_state", "install_district", "install_city",
  "system_type", "plant_use_type",
  "aadhaar_name", "aadhaar_gender", "aadhaar_number", "aadhaar_care_of", "aadhaar_address",
  "aadhaar_front_path", "aadhaar_back_path", "aadhaar_face_path",
  "project_size_unit", "discom_name", "ca_number", "ebill_address_line", "ebill_name",
  "ebill_path", "proforma_invoice_path", "rooftop_photo_path",
  "coapp_name", "coapp_father_name", "coapp_pan", "coapp_pan_path", "coapp_relation",
  "coapp_aadhaar_name", "coapp_aadhaar_gender", "coapp_aadhaar_number", "coapp_aadhaar_care_of", "coapp_aadhaar_address",
  "coapp_aadhaar_front_path", "coapp_aadhaar_back_path", "coapp_aadhaar_face_path",
  "employment_type", "profession", "profession_other", "organization_name",
  "bank_statement_method", "bank_statement_path",
  "bank_account_holder", "bank_name", "bank_account_no", "bank_ifsc", "bank_account_type", "bank_mobile", "bank_email",
]);
const NUM_COLS = new Set([
  "project_size", "total_project_cost", "loan_amount_required", "monthly_bill_amount", "annual_income",
  "roi_percent", "central_subsidy", "state_subsidy", "selected_tenure_years", "selected_monthly_emi", "selected_subsidy_emi",
]);
const DATE_COLS = new Set([
  "borrower_dob", "aadhaar_dob", "coapp_dob",
  "ebill_uploaded_at", "proforma_uploaded_at", "rooftop_photo_uploaded_at", "bank_statement_uploaded_at",
]);
const BOOL_COLS = new Set(["bill_on_applicant_name"]);
const ARRAY_COLS = new Set(["consent_policies"]);

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function coerce(key: string, raw: unknown): unknown {
  if (NUM_COLS.has(key)) {
    if (raw === "" || raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (DATE_COLS.has(key)) {
    const s = String(raw ?? "").trim();
    return s ? s : null;
  }
  if (BOOL_COLS.has(key)) {
    if (typeof raw === "boolean") return raw;
    if (raw === "yes") return true;
    if (raw === "no") return false;
    if (raw === "" || raw == null) return null;
    return Boolean(raw);
  }
  if (ARRAY_COLS.has(key)) {
    return Array.isArray(raw) ? raw : null;
  }
  const s = String(raw ?? "").trim();
  return s ? s : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (TEXT_COLS.has(k) || NUM_COLS.has(k) || DATE_COLS.has(k) || BOOL_COLS.has(k) || ARRAY_COLS.has(k)) {
        patch[k] = coerce(k, v);
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, updated: [] });
    }
    patch.last_updated_by_user_id = claims.business_id;

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: updErr } = await supabase
      .from("epc_applications")
      .update(patch)
      .eq("id", appId);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    // Best-effort edit trail.
    const edited = Object.keys(patch).filter((k) => k !== "last_updated_by_user_id");
    await logLoanActivityServer(supabase, appId, "field_edit", claims.business_id ?? null, { detail: `intake chat: ${edited.join(", ")}` });

    return NextResponse.json({ ok: true, updated: Object.keys(patch).filter((k) => k !== "last_updated_by_user_id") });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[update-fields] error:", msg);
    return err(msg, 500);
  }
}
