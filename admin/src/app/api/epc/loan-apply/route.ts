// POST /api/epc/loan-apply — EPC-facing 3-page loan application.
//
// Two phases, same body key `phase`:
//
//   { phase: "register", ...page-1 fields }
//     → INSERTs a fresh epc_applications row auto-tagged to the
//       LOGGED-IN EPC (epc_business_id = caller's business_id — the
//       EPC never picks an EPC, unlike the admin flow). Saves the
//       registration fields + consent record; current_step = 2.
//       The 0030 trigger assigns the LA-<last5>-<seq> display id the
//       moment borrower_mobile lands. The 0017 BEFORE INSERT trigger
//       enforces loan_app_unlocked (at least one lender approval /
//       grandfathered) — the same gating the dashboard uses.
//     ← { ok, id, loan_display_id }
//
//   { phase: "submit", id, ...pages 2-3 fields }
//     → Ownership-checked UPDATE persisting KYC / e-bill / co-app /
//       project + loan + tenure + EMI fields, then status='submitted'
//       + submitted_at + current_step=6, entering the SAME pipeline as
//       admin-created applications. Fields the 3-page flow doesn't ask
//       stay NULL and remain editable later via the existing admin
//       step pages (guards removed) or this same record's View/Edit.
//
// All DB access uses the CALLER's token — RLS ("own_applications")
// scopes every read/write to the EPC's own rows; no service-role.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { DEFAULT_INDICATIVE_ROI } from "@/lib/emi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_RE    = /^[1-9]\d{5}$/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAN_RE    = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const SYSTEM_TYPES = new Set(["off_grid", "on_grid", "hybrid"]);
const CONSENT_POLICIES = [
  "terms_conditions", "privacy_policy", "cookie_policy",
  "credit_information", "loan_application",
];

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function firstIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) { const f = xff.split(",")[0].trim(); if (f) return f; }
  return req.headers.get("x-real-ip") || null;
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    // EPC accounts only — admins use the 6-step flow with EPC selection.
    if (claims.business_type === "admin") return err("epc_flow_only", 403);
    if (!claims.business_id) return err("unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const b = body as Record<string, unknown>;
    const phase = String(b.phase ?? "");

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Phase 1: register ─────────────────────────────────────
    if (phase === "register") {
      const borrower_name    = strOrNull(b.borrower_name);
      const borrower_mobile  = String(b.borrower_mobile ?? "").replace(/\D/g, "");
      const borrower_email   = strOrNull(b.borrower_email);
      const install_pincode  = strOrNull(b.install_pincode);
      const install_state    = strOrNull(b.install_state);
      const install_district = strOrNull(b.install_district);
      const install_city     = strOrNull(b.install_city);
      const system_type      = strOrNull(b.system_type);
      const plant_use_type   = strOrNull(b.plant_use_type);

      if (!borrower_name)                   return err("Applicant name is required.", 400);
      if (!MOBILE_RE.test(borrower_mobile)) return err("Enter a valid 10-digit mobile.", 400);
      if (!borrower_email || !EMAIL_RE.test(borrower_email)) return err("Enter a valid email.", 400);
      if (!install_pincode || !PIN_RE.test(install_pincode)) return err("Enter a valid 6-digit pincode.", 400);
      if (!install_state)                   return err("Installation state is required.", 400);
      if (!system_type || !SYSTEM_TYPES.has(system_type)) return err("Choose a system type.", 400);
      if (plant_use_type !== "residential" && plant_use_type !== "commercial") {
        return err("Choose Residential or Commercial.", 400);
      }
      if (b.consented !== true)             return err("Consent is required to continue.", 400);

      // INSERT + field save in one statement. The 0017 gate trigger
      // rejects EPCs without lender approval; RLS scopes to own rows.
      const { data: inserted, error: insErr } = await supabase
        .from("epc_applications")
        .insert({
          epc_business_id: claims.business_id,   // auto-tag — never asked
          created_by: "epc",
          status: "draft",
          current_step: 2,
          borrower_name,
          borrower_mobile,
          borrower_email,
          install_pincode,
          install_state,
          install_district,
          install_city,
          system_type,
          plant_use_type,
          consent_at: new Date().toISOString(),
          consent_policies: CONSENT_POLICIES,
          consent_ip: firstIp(req),
          consent_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500),
        })
        .select("id, loan_display_id")
        .single();
      if (insErr) {
        const msg = insErr.message.includes("loan_app_locked")
          ? "Loan applications unlock after a lender approves your EPC profile."
          : insErr.message;
        return err(msg, 403);
      }
      return NextResponse.json({ ok: true, id: inserted.id, loan_display_id: inserted.loan_display_id });
    }

    // ── Phase 2: submit ───────────────────────────────────────
    if (phase === "submit") {
      const appId = String(b.id ?? "");
      if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

      // Ownership check (RLS also enforces, but explicit 403 beats a
      // silent 0-row update). Also pull the applicant's own contact so we
      // can reject a co-applicant that reuses it.
      const { data: app, error: loadErr } = await supabase
        .from("epc_applications")
        .select("id, epc_business_id, current_step, borrower_mobile, borrower_email")
        .eq("id", appId)
        .maybeSingle();
      if (loadErr) return err(loadErr.message, 500);
      if (!app || app.epc_business_id !== claims.business_id) return err("forbidden", 403);

      // Page 2 — documents + OCR results (all optional-shaped; server
      // validates what's present).
      const borrower_pan = strOrNull(b.borrower_pan)?.toUpperCase() ?? null;
      if (borrower_pan && !PAN_RE.test(borrower_pan)) return err("PAN format is invalid.", 400);

      const aadhaar_number_raw = strOrNull(b.aadhaar_number)?.replace(/\D/g, "") ?? null;
      if (aadhaar_number_raw && !/^\d{12}$/.test(aadhaar_number_raw)) {
        return err("Aadhaar number must be 12 digits.", 400);
      }
      const coapp_aadhaar_number_raw = strOrNull(b.coapp_aadhaar_number)?.replace(/\D/g, "") ?? null;
      if (coapp_aadhaar_number_raw && !/^\d{12}$/.test(coapp_aadhaar_number_raw)) {
        return err("Co-applicant Aadhaar number must be 12 digits.", 400);
      }
      const coapp_pan = strOrNull(b.coapp_pan)?.toUpperCase() ?? null;
      if (coapp_pan && !PAN_RE.test(coapp_pan)) return err("Co-applicant PAN format is invalid.", 400);

      // Co-applicant contact. Must NOT duplicate the applicant's own
      // email / phone (same rule the admin flow enforces client-side).
      const has_coapp = b.has_coapp === true;
      const coapp_mobile = String(b.coapp_mobile ?? "").replace(/\D/g, "") || null;
      const coapp_email  = strOrNull(b.coapp_email);
      if (has_coapp) {
        const applicantMobile = String((app as any).borrower_mobile ?? "").trim();
        const applicantEmail  = String((app as any).borrower_email ?? "").trim().toLowerCase();
        if (coapp_mobile && applicantMobile && coapp_mobile === applicantMobile) {
          return err("Co-applicant mobile cannot be the same as the applicant's.", 400);
        }
        if (coapp_email && applicantEmail && coapp_email.toLowerCase() === applicantEmail) {
          return err("Co-applicant email cannot be the same as the applicant's.", 400);
        }
      }

      // Quotation / proforma + geo-tagged rooftop photo.
      const proforma_invoice_path = strOrNull(b.proforma_invoice_path);
      const rooftop_photo_path    = strOrNull(b.rooftop_photo_path);
      const rooftop_photo_gps =
        b.rooftop_photo_gps && typeof b.rooftop_photo_gps === "object"
          ? b.rooftop_photo_gps
          : null;

      // Page 3 — project + loan + tenure.
      const project_size         = numOrNull(b.project_size);
      const total_project_cost   = numOrNull(b.total_project_cost);
      const loan_amount_required = numOrNull(b.loan_amount_required);
      const selected_tenure_years = numOrNull(b.selected_tenure_years);
      const selected_monthly_emi  = numOrNull(b.selected_monthly_emi);
      const selected_subsidy_emi  = numOrNull(b.selected_subsidy_emi);
      const central_subsidy       = numOrNull(b.central_subsidy);

      if (project_size === null || project_size <= 0) return err("Project size is required.", 400);
      if (total_project_cost === null || total_project_cost <= 0) return err("Total project cost is required.", 400);
      if (loan_amount_required === null || loan_amount_required <= 0) return err("Loan amount is required.", 400);
      if (loan_amount_required > total_project_cost) return err("Loan amount cannot exceed project cost.", 400);
      if (selected_tenure_years === null || ![1, 2, 3, 4, 5].includes(selected_tenure_years)) {
        return err("Select a tenure between 1 and 5 years.", 400);
      }

      const now = new Date().toISOString();
      const { error: updErr } = await supabase
        .from("epc_applications")
        .update({
          // Page 2 — applicant docs
          borrower_pan,
          aadhaar_name:           strOrNull(b.aadhaar_name),
          aadhaar_dob:            strOrNull(b.aadhaar_dob),
          aadhaar_gender:         strOrNull(b.aadhaar_gender),
          aadhaar_number:         aadhaar_number_raw,
          aadhaar_number_masked:  aadhaar_number_raw ? "xxxxxxxx" + aadhaar_number_raw.slice(-4) : null,
          aadhaar_care_of:        strOrNull(b.aadhaar_care_of),
          aadhaar_address:        strOrNull(b.aadhaar_address),
          aadhaar_front_path:     strOrNull(b.aadhaar_front_path),
          aadhaar_back_path:      strOrNull(b.aadhaar_back_path),
          aadhaar_face_path:      strOrNull(b.aadhaar_face_path),
          kyc_extracted_at:       strOrNull(b.aadhaar_front_path) ? now : null,
          // Page 2 — e-bill
          ebill_path:             strOrNull(b.ebill_path),
          ebill_uploaded_at:      strOrNull(b.ebill_path) ? now : null,
          monthly_bill_amount:    numOrNull(b.monthly_bill_amount),
          discom_name:            strOrNull(b.discom_name),
          ca_number:              strOrNull(b.ca_number),
          ebill_address_line:     strOrNull(b.ebill_address_line),
          ebill_name:             strOrNull(b.ebill_name),
          bill_on_applicant_name: typeof b.has_coapp === "boolean" ? !b.has_coapp : null,
          // Page 2 — quotation / proforma + geo-tagged rooftop photo
          proforma_invoice_path,
          proforma_uploaded_at:   proforma_invoice_path ? now : null,
          rooftop_photo_path,
          rooftop_photo_uploaded_at: rooftop_photo_path ? now : null,
          rooftop_photo_gps,
          // Page 2 — co-applicant (only when toggled on)
          coapp_pan,
          coapp_name:                  strOrNull(b.coapp_name),
          coapp_dob:                   strOrNull(b.coapp_dob),
          coapp_mobile,
          coapp_email,
          coapp_pan_path:              strOrNull(b.coapp_pan_path),
          coapp_aadhaar_name:          strOrNull(b.coapp_aadhaar_name),
          coapp_aadhaar_dob:           strOrNull(b.coapp_aadhaar_dob),
          coapp_aadhaar_gender:        strOrNull(b.coapp_aadhaar_gender),
          coapp_aadhaar_number:        coapp_aadhaar_number_raw,
          coapp_aadhaar_number_masked: coapp_aadhaar_number_raw ? "xxxxxxxx" + coapp_aadhaar_number_raw.slice(-4) : null,
          coapp_aadhaar_care_of:       strOrNull(b.coapp_aadhaar_care_of),
          coapp_aadhaar_address:       strOrNull(b.coapp_aadhaar_address),
          coapp_aadhaar_front_path:    strOrNull(b.coapp_aadhaar_front_path),
          coapp_aadhaar_back_path:     strOrNull(b.coapp_aadhaar_back_path),
          // Page 3 — project + loan + indicative offer
          project_size,
          project_size_unit: "kw",
          total_project_cost,
          loan_amount_required,
          roi_percent:      DEFAULT_INDICATIVE_ROI,
          central_subsidy:  central_subsidy ?? 0,
          state_subsidy:    0,
          selected_tenure_years,
          selected_monthly_emi,
          selected_subsidy_emi,
          step3_completed_at: now,
          step5_completed_at: now,
          // Enter the pipeline exactly like an admin-created application.
          status: "submitted",
          submitted_at: now,
          current_step: 6,
        })
        .eq("id", appId);
      if (updErr) return err(`Submit failed: ${updErr.message}`, 500);

      return NextResponse.json({ ok: true, id: appId });
    }

    return err("Unknown phase.", 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[epc/loan-apply] error:", msg);
    return err(msg, 500);
  }
}
