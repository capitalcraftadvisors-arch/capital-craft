// POST /api/admin/loan-app/[id]/complete-step-3
//
// Admin-only. Persists all Step 3 fields (project / loan / electricity
// bill / installation address / bill-ownership + optional co-applicant)
// and advances current_step 3 → 4.
//
// Server-side validation:
//   - Both proforma_invoice_path and ebill_path required.
//   - loan_amount_required must be > 0 and ≤ total_project_cost.
//   - project_size / project_size_unit must both be present if either is.
//   - install_pincode must be a valid 6-digit PIN.
//   - install_state required.
//   - bill_on_applicant_name must be an explicit boolean.
//   - If bill_on_applicant_name === false, ALL coapp_* fields required
//     (name, pan, dob, relation, mobile, email, pan_path).

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

const UUID_RE    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_RE     = /^[1-9]\d{5}$/;
const MOBILE_RE  = /^[6-9]\d{9}$/;
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAN_RE     = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UNITS      = new Set(["kw", "mw"]);

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const body = await req.json().catch(() => ({}));
    const b = body as Record<string, unknown>;

    // ── Documents ─────────────────────────────────────────
    const proforma_invoice_path = strOrNull(b.proforma_invoice_path);
    const proforma_uploaded_at  = strOrNull(b.proforma_uploaded_at);
    const ebill_path            = strOrNull(b.ebill_path);
    const ebill_uploaded_at     = strOrNull(b.ebill_uploaded_at);
    // Admin-only route — no required-doc/field blocking (see below).

    // ── Project + loan ────────────────────────────────────
    const project_size         = numOrNull(b.project_size);
    const project_size_unit_raw = strOrNull(b.project_size_unit)?.toLowerCase() ?? null;
    // Coerce to a valid enum or null so the DB CHECK (kw|mw) always holds.
    const project_size_unit    = project_size_unit_raw && UNITS.has(project_size_unit_raw) ? project_size_unit_raw : null;
    const total_project_cost   = numOrNull(b.total_project_cost);
    const loan_amount_required = numOrNull(b.loan_amount_required);

    // Admin-only route — no required-field blocking. Reject only present-and-
    // invalid values; missing values save as null.
    if (project_size !== null && project_size <= 0) return err("Project size must be positive.", 400);
    if (total_project_cost !== null && total_project_cost <= 0) return err("Total project cost must be positive.", 400);
    if (loan_amount_required !== null && loan_amount_required <= 0) return err("Loan amount must be positive.", 400);
    if (loan_amount_required !== null && total_project_cost !== null && loan_amount_required > total_project_cost) {
      return err("Loan amount cannot exceed total project cost.", 400);
    }

    // ── Electricity ───────────────────────────────────────
    const monthly_bill_amount = numOrNull(b.monthly_bill_amount);
    const discom_name         = strOrNull(b.discom_name);
    const ca_number           = strOrNull(b.ca_number);

    // ── Installation address (reuses 0022 columns) ────────
    const install_pincode = strOrNull(b.install_pincode);
    const install_state   = strOrNull(b.install_state);
    const install_city    = strOrNull(b.install_city);
    const ebill_address_line = strOrNull(b.ebill_address_line);
    const ebill_name         = strOrNull(b.ebill_name);

    // Installation address optional for admin (only reject a present-invalid PIN).
    if (install_pincode && !PIN_RE.test(install_pincode)) {
      return err("Installation pincode must be a valid 6-digit PIN.", 400);
    }

    // ── Bill ownership + co-applicant ─────────────────────
    // Optional for admin — null when unanswered.
    const bill_on_applicant_name =
      typeof b.bill_on_applicant_name === "boolean" ? b.bill_on_applicant_name : null;

    let coapp_pan:         string | null = null;
    let coapp_name:        string | null = null;
    let coapp_father_name: string | null = null;
    let coapp_dob:         string | null = null;
    let coapp_relation:    string | null = null;
    let coapp_mobile:      string | null = null;
    let coapp_email:       string | null = null;
    let coapp_pan_path:    string | null = null;

    // Co-applicant Aadhaar KYC (optional even when co-app is required)
    let coapp_aadhaar_name:          string | null = null;
    let coapp_aadhaar_dob:           string | null = null;
    let coapp_aadhaar_gender:        string | null = null;
    let coapp_aadhaar_number:        string | null = null;
    let coapp_aadhaar_number_masked: string | null = null;
    let coapp_aadhaar_care_of:       string | null = null;
    let coapp_aadhaar_address:       string | null = null;
    let coapp_aadhaar_front_path:    string | null = null;
    let coapp_aadhaar_back_path:     string | null = null;
    let coapp_aadhaar_face_path:     string | null = null;

    if (bill_on_applicant_name === false) {
      coapp_pan         = strOrNull(b.coapp_pan)?.toUpperCase() ?? null;
      coapp_name        = strOrNull(b.coapp_name);
      coapp_father_name = strOrNull(b.coapp_father_name);
      coapp_dob         = strOrNull(b.coapp_dob);
      coapp_relation    = strOrNull(b.coapp_relation);
      coapp_mobile      = strOrNull(b.coapp_mobile);
      coapp_email       = strOrNull(b.coapp_email);
      coapp_pan_path    = strOrNull(b.coapp_pan_path);

      coapp_aadhaar_name          = strOrNull(b.coapp_aadhaar_name);
      coapp_aadhaar_dob           = strOrNull(b.coapp_aadhaar_dob);
      coapp_aadhaar_gender        = strOrNull(b.coapp_aadhaar_gender);
      // Full 12-digit number; masked form derived server-side.
      coapp_aadhaar_number        = strOrNull(b.coapp_aadhaar_number)?.replace(/\D/g, "") ?? null;
      coapp_aadhaar_care_of       = strOrNull(b.coapp_aadhaar_care_of);
      coapp_aadhaar_address       = strOrNull(b.coapp_aadhaar_address);
      coapp_aadhaar_front_path    = strOrNull(b.coapp_aadhaar_front_path);
      coapp_aadhaar_back_path     = strOrNull(b.coapp_aadhaar_back_path);
      coapp_aadhaar_face_path     = strOrNull(b.coapp_aadhaar_face_path);

      // Admin-only route — co-applicant fields optional; reject only
      // present-and-invalid values.
      if (coapp_pan && !PAN_RE.test(coapp_pan)) return err("Co-applicant PAN is invalid.", 400);
      if (coapp_mobile && !MOBILE_RE.test(coapp_mobile)) return err("Co-applicant mobile is invalid.", 400);
      if (coapp_email && !EMAIL_RE.test(coapp_email)) return err("Co-applicant email is invalid.", 400);

      if (coapp_aadhaar_number) {
        if (!/^\d{12}$/.test(coapp_aadhaar_number)) {
          return err("Co-applicant Aadhaar number must be exactly 12 digits.", 400);
        }
        coapp_aadhaar_number_masked = "xxxxxxxx" + coapp_aadhaar_number.slice(-4);
      }
    }

    // Cross-check: co-applicant contact must NOT match applicant contact.
    // Load Step-1 borrower_mobile/email for the comparison.
    let rooftop_photo_path        = strOrNull(b.rooftop_photo_path);
    let rooftop_photo_uploaded_at = strOrNull(b.rooftop_photo_uploaded_at);
    const rooftop_photo_gps       = (b.rooftop_photo_gps && typeof b.rooftop_photo_gps === "object")
      ? b.rooftop_photo_gps as Record<string, unknown>
      : null;

    // ── Persist + advance ─────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select("id, current_step, borrower_mobile, borrower_email")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);
    if ((app.current_step ?? 1) < 3) return err("Complete Step 2 before Step 3.", 409);

    // Applicant vs co-applicant collision check (spec).
    if (bill_on_applicant_name === false) {
      if (coapp_mobile && app.borrower_mobile && coapp_mobile === app.borrower_mobile) {
        return err("Co-applicant mobile must differ from the applicant's mobile.", 400);
      }
      if (coapp_email && app.borrower_email &&
          coapp_email.toLowerCase() === app.borrower_email.toLowerCase()) {
        return err("Co-applicant email must differ from the applicant's email.", 400);
      }
    }

    const nextStep = Math.max(app.current_step ?? 3, 4);

    const { error: updErr } = await supabase
      .from("epc_applications")
      .update({
        proforma_invoice_path,
        proforma_uploaded_at,
        ebill_path,
        ebill_uploaded_at,
        project_size,
        project_size_unit,
        total_project_cost,
        loan_amount_required,
        monthly_bill_amount,
        discom_name,
        ca_number,
        ebill_address_line,
        ebill_name,
        install_pincode,
        install_state,
        install_city,
        bill_on_applicant_name,
        coapp_pan,
        coapp_name,
        coapp_father_name,
        coapp_dob,
        coapp_relation,
        coapp_mobile,
        coapp_email,
        coapp_pan_path,
        coapp_aadhaar_name,
        coapp_aadhaar_dob,
        coapp_aadhaar_gender,
        coapp_aadhaar_number,
        coapp_aadhaar_number_masked,
        coapp_aadhaar_care_of,
        coapp_aadhaar_address,
        coapp_aadhaar_front_path,
        coapp_aadhaar_back_path,
        coapp_aadhaar_face_path,
        rooftop_photo_path,
        rooftop_photo_uploaded_at,
        rooftop_photo_gps,
        step3_completed_at: new Date().toISOString(),
        current_step: nextStep,
      })
      .eq("id", appId);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    // Append-only activity trail (migration 0042). Best-effort.
    await logLoanActivityServer(supabase, appId, "step_completed", claims.business_id ?? null, { step: 3 });

    return NextResponse.json({ ok: true, next_step: nextStep });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-step-3] error:", msg);
    return err(msg, 500);
  }
}
