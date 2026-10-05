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
import { isUndefinedColumn, omitKeys } from "@/lib/optional-column";

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

      // Only the mobile is required up front — it drives the loan_display_id and
      // identifies the draft. The classic 3-page flow still sends every field
      // (its client enforces them); the chatbot registers with JUST the mobile
      // and fills the rest — plus consent — at submit, after documents are read.
      // Anything present is still format-validated.
      if (!MOBILE_RE.test(borrower_mobile)) return err("Enter a valid 10-digit mobile.", 400);
      if (borrower_email && !EMAIL_RE.test(borrower_email)) return err("Enter a valid email.", 400);
      if (install_pincode && !PIN_RE.test(install_pincode)) return err("Enter a valid 6-digit pincode.", 400);
      if (system_type && !SYSTEM_TYPES.has(system_type)) return err("Choose a valid system type.", 400);
      if (plant_use_type && plant_use_type !== "residential" && plant_use_type !== "commercial") {
        return err("Choose Residential or Commercial.", 400);
      }
      const consented = b.consented === true;

      // Duplicate warning (NON-blocking): other loan applications already on file
      // for this EPC with the SAME mobile (RLS scopes the query to the caller's
      // own apps). The client shows these so the EPC can avoid making the same
      // profile twice — but creation is never blocked.
      let duplicates: Array<{ id: string; loan_display_id: string | null; borrower_name: string | null; status: string | null }> = [];
      try {
        const { data: dups } = await supabase
          .from("epc_applications")
          .select("id, loan_display_id, borrower_name, aadhaar_name, status")
          .eq("borrower_mobile", borrower_mobile)
          .limit(5);
        duplicates = ((dups ?? []) as Array<Record<string, any>>).map((d) => ({
          id: d.id, loan_display_id: d.loan_display_id,
          borrower_name: d.borrower_name || d.aadhaar_name || null, status: d.status,
        }));
      } catch { /* non-blocking */ }

      // INSERT + field save in one statement. The 0017 gate trigger
      // rejects EPCs without lender approval; RLS scopes to own rows.
      const { data: inserted, error: insErr } = await supabase
        .from("epc_applications")
        .insert({
          epc_business_id: claims.business_id,   // auto-tag — never asked
          created_by: "epc",
          // Hierarchy (0066): the EPC is the creator; leave assigned_to null so
          // it surfaces as unassigned work for an admin to pick up/assign.
          created_by_user_id: claims.business_id,
          last_updated_by_user_id: claims.business_id,
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
          ...(consented ? {
            consent_at: new Date().toISOString(),
            consent_policies: CONSENT_POLICIES,
            consent_ip: firstIp(req),
            consent_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500),
          } : {}),
        })
        .select("id, loan_display_id")
        .single();
      if (insErr) {
        const msg = insErr.message.includes("loan_app_locked")
          ? "Loan applications unlock after a lender approves your EPC profile."
          : insErr.message;
        return err(msg, 403);
      }
      return NextResponse.json({ ok: true, id: inserted.id, loan_display_id: inserted.loan_display_id, duplicates });
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
        .select("id, epc_business_id, current_step, status, borrower_mobile, borrower_email, plant_use_type, submitted_at, edit_locked, edit_allow, aadhaar_front_path, aadhaar_back_path, project_size, total_project_cost, loan_amount_required, selected_tenure_years, attention_status")
        .eq("id", appId)
        .maybeSingle();
      if (loadErr) return err(loadErr.message, 500);
      if (!app || app.epc_business_id !== claims.business_id) return err("forbidden", 403);
      // A submitted file is LOCKED. The Capital Craft team opens editing by
      // granting specific rows (edit_allow, set from the Message-to-EPC window);
      // a resubmit is allowed only while that grant is non-empty, and is cleared
      // below so the grant is single-use. (The first submit is never locked.)
      const grant = Array.isArray((app as any).edit_allow) ? ((app as any).edit_allow as string[]) : [];
      if ((app as any).submitted_at && (app as any).edit_locked && grant.length === 0) {
        return err("This application is locked. The Capital Craft team will open it for edits when a change is needed.", 403);
      }

      // Page 2 — documents + OCR results (all optional-shaped; server
      // validates what's present).
      const borrower_pan = strOrNull(b.borrower_pan)?.toUpperCase() ?? null;
      if (borrower_pan && !PAN_RE.test(borrower_pan)) return err("PAN format is invalid.", 400);
      const borrower_father_name = strOrNull(b.borrower_father_name);

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

      // Lead owner — the EPC's team member who owns this lead (name + phone),
      // captured just before consent. Written best-effort: the columns ship in
      // migrations 0074 (name) / 0089 (phone), so a DB without them yet (42703)
      // simply drops these fields instead of failing the whole submit.
      const lead_owner_name  = strOrNull(b.lead_owner_name);
      const lead_owner_phone = String(b.lead_owner_phone ?? "").replace(/\D/g, "") || null;
      if (lead_owner_phone && !MOBILE_RE.test(lead_owner_phone)) {
        return err("Enter a valid 10-digit lead owner phone number.", 400);
      }

      // An EDIT re-submit (client sets edit:true) only touches the rows Capital
      // Craft opened for the EPC — it must NOT be blocked by, or overwrite, the
      // project/loan/tenure/Aadhaar fields that are outside that scope (and may be
      // blank on legacy/seeded rows). So on an edit we coalesce every such field
      // with the value already stored, and skip the first-submit "required" gates.
      const isEdit = b.edit === true;
      const prevSize = numOrNull((app as any).project_size);
      const prevCost = numOrNull((app as any).total_project_cost);
      const prevLoan = numOrNull((app as any).loan_amount_required);
      const prevTenure = numOrNull((app as any).selected_tenure_years);

      // Page 3 — project + loan + tenure (coalesced with stored on an edit).
      const project_size         = numOrNull(b.project_size)         ?? (isEdit ? prevSize : null);
      const total_project_cost   = numOrNull(b.total_project_cost)   ?? (isEdit ? prevCost : null);
      const loan_amount_required = numOrNull(b.loan_amount_required) ?? (isEdit ? prevLoan : null);
      // A 0/invalid tenure (the chatbot sends 0 when nothing was picked) must NOT
      // be written — the column has a CHECK (1..5). Treat it as absent → coalesce
      // to the stored value on an edit, else null (the fresh-submit gate catches it).
      const bodyTenure = numOrNull(b.selected_tenure_years);
      const selected_tenure_years = (bodyTenure != null && [1, 2, 3, 4, 5].includes(bodyTenure))
        ? bodyTenure
        : (isEdit ? prevTenure : null);
      // EMI figures only make sense with a tenure — null them out otherwise.
      const selected_monthly_emi  = selected_tenure_years != null ? numOrNull(b.selected_monthly_emi) : null;
      const selected_subsidy_emi  = selected_tenure_years != null ? numOrNull(b.selected_subsidy_emi) : null;
      const central_subsidy       = numOrNull(b.central_subsidy);

      if (!isEdit) {
        if (project_size === null || project_size <= 0) return err("Project size is required.", 400);
        if (total_project_cost === null || total_project_cost <= 0) return err("Total project cost is required.", 400);
        if (loan_amount_required === null || loan_amount_required <= 0) return err("Loan amount is required.", 400);
        if (selected_tenure_years === null || ![1, 2, 3, 4, 5].includes(selected_tenure_years)) {
          return err("Select a tenure between 1 and 5 years.", 400);
        }
      }
      // Enforce loan ≤ cost only when this submission actually CHANGES the loan
      // amount or project cost (so a doc-only edit re-sending the hydrated figures
      // unchanged is never blocked by a pre-existing inconsistency it can't edit).
      const financialsChanged = total_project_cost !== prevCost || loan_amount_required !== prevLoan;
      if (financialsChanged && loan_amount_required != null && total_project_cost != null && loan_amount_required > total_project_cost) {
        return err("Loan amount cannot exceed project cost.", 400);
      }
      // A blank profile can't be FIRST-submitted — the applicant's Aadhaar (front &
      // back) is the minimum. Accept it from this submit or already on the app; on
      // an edit it's coalesced (and the gate below only runs for a fresh submit).
      const aadhaarFront = strOrNull(b.aadhaar_front_path) ?? (app as any).aadhaar_front_path;
      const aadhaarBack  = strOrNull(b.aadhaar_back_path)  ?? (app as any).aadhaar_back_path;
      if (!isEdit && (!aadhaarFront || !aadhaarBack)) {
        return err("Please upload the applicant's Aadhaar (front and back) before submitting.", 400);
      }

      const now = new Date().toISOString();
      // In the docs-first chatbot, plant_use_type (and other register fields)
      // arrive at submit rather than register — use the freshest value.
      const useType = strOrNull(b.plant_use_type) ?? (app as any).plant_use_type;
      const payload: Record<string, unknown> = {
          // Page 2 — applicant docs
          borrower_pan,
          borrower_father_name,
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
          // Lead owner (name + phone) — written only when the caller sends them,
          // so the classic flow never nulls an existing value.
          ...(b.lead_owner_name  !== undefined ? { lead_owner_name } : {}),
          ...(b.lead_owner_phone !== undefined ? { lead_owner_phone } : {}),
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
          // Subsidy is residential-only — commercial (C&I) is forced to 0.
          central_subsidy:  useType === "commercial" ? 0 : (central_subsidy ?? 0),
          state_subsidy:    0,
          selected_tenure_years,
          selected_monthly_emi,
          selected_subsidy_emi,
          // Register fields the docs-first chatbot collects AFTER documents.
          // Written ONLY when the caller sends them, so the classic 3-page
          // flow's register values are never overwritten with null.
          ...(b.borrower_name    !== undefined ? { borrower_name:    strOrNull(b.borrower_name) } : {}),
          ...(b.borrower_email   !== undefined ? { borrower_email:   strOrNull(b.borrower_email) } : {}),
          ...(b.install_pincode  !== undefined ? { install_pincode:  strOrNull(b.install_pincode) } : {}),
          ...(b.install_state    !== undefined ? { install_state:    strOrNull(b.install_state) } : {}),
          ...(b.install_district !== undefined ? { install_district: strOrNull(b.install_district) } : {}),
          ...(b.install_city     !== undefined ? { install_city:     strOrNull(b.install_city) } : {}),
          ...(b.system_type      !== undefined ? { system_type:      strOrNull(b.system_type) } : {}),
          ...(b.plant_use_type   !== undefined ? { plant_use_type:   strOrNull(b.plant_use_type) } : {}),
          // Consent is captured at the end of the chatbot (just before submit).
          ...(b.consented === true ? {
            consent_at: now, consent_policies: CONSENT_POLICIES,
            consent_ip: firstIp(req), consent_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500),
          } : {}),
          step3_completed_at: now,
          step5_completed_at: now,
          // A RESUBMIT (the app was already submitted once) marks the case
          // "Updated" on the EPC portal + floats it up by recency of change.
          ...((app as any).submitted_at ? { epc_updated_at: now } : {}),
          // The EPC re-submitting an edited application AUTO-RESOLVES any open
          // attention — editing IS the fix, so they never mark it resolved by
          // hand. Notify the admin via epc_last_activity_at (unseen update).
          ...((app as any).attention_status === "open" ? {
            attention_status: "resolved", attention_resolved_at: now,
            attention_resolved_by: "epc", epc_last_activity_at: now,
          } : {}),
          // A FRESH submit enters the pipeline as "submitted". An EDIT re-submit
          // must NOT move the file backward — an approved/disbursed/rfd app stays
          // where it is (only a still-draft app becomes "submitted"). Always LOCK
          // and clear the (single-use) grant.
          ...(!isEdit || (app as any).status === "draft"
            ? { status: "submitted", submitted_at: now, current_step: 6 }
            : {}),
          edit_locked: true,
          edit_allow: [],
      };
      let { error: updErr } = await supabase
        .from("epc_applications")
        .update(payload)
        .eq("id", appId);
      // Self-heal: if the lead-owner columns aren't on this DB yet (migrations
      // 0074/0089 not applied), drop them and retry so submit still succeeds.
      if (updErr && isUndefinedColumn(updErr)) {
        ({ error: updErr } = await supabase
          .from("epc_applications")
          .update(omitKeys(payload, ["lead_owner_name", "lead_owner_phone"]))
          .eq("id", appId));
      }
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
