// PATCH /api/admin/loan-app/[id]/complete-step-1
//
// Admin-only. Persists Step 1 fields on the draft row, records the
// consent breadcrumb, fires the WhatsApp confirmation stub, and
// advances current_step from 1 to 2.
//
// Idempotence: refuses to run twice on the same row (returns 409 if
// current_step is already > 1). The frontend also disables the button
// after success, but the server is authoritative.
//
// Body shape:
//   {
//     install_pincode: string(6),
//     install_state:   string,
//     install_district?: string,
//     install_city?: string,
//     borrower_mobile: string(10),
//     borrower_email:  string,
//     system_type:     "off_grid" | "on_grid" | "hybrid",
//     consent_policies: string[]   // ["terms_conditions", ...]
//   }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { sendWhatsAppConfirmation } from "@/lib/whatsapp";

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
const SYSTEM_TYPES = new Set(["off_grid", "on_grid", "hybrid"]);

// The full canonical policy list. We accept anything from this set;
// the client sends whichever were shown+ticked (currently all five).
const KNOWN_POLICIES = new Set([
  "terms_conditions",
  "privacy_policy",
  "cookie_policy",
  "credit_information",
  "loan_application",
]);

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// Best-effort client IP extraction. Cloud Run puts the real client
// IP in x-forwarded-for; fall back to null if absent.
function firstIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") || null;
}

export async function PATCH(
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

    const install_pincode  = String(b.install_pincode  ?? "").trim();
    const install_state    = String(b.install_state    ?? "").trim();
    const install_district = String(b.install_district ?? "").trim() || null;
    const install_city     = String(b.install_city     ?? "").trim() || null;
    const borrower_mobile  = String(b.borrower_mobile  ?? "").replace(/\D/g, "");
    const borrower_email   = String(b.borrower_email   ?? "").trim();
    const system_type      = String(b.system_type      ?? "").trim();
    const consent_policies_raw = Array.isArray(b.consent_policies) ? b.consent_policies : [];

    if (!PIN_RE.test(install_pincode))    return err("Enter a valid 6-digit pincode.", 400);
    if (!install_state)                    return err("Installation state is required.", 400);
    if (!MOBILE_RE.test(borrower_mobile)) return err("Enter a valid 10-digit mobile.", 400);
    if (!EMAIL_RE.test(borrower_email))    return err("Enter a valid email.", 400);
    if (!SYSTEM_TYPES.has(system_type))    return err("Choose a valid system type.", 400);

    // Filter policies to the known set — anything else is discarded.
    // If the caller didn't tick anything (impossible via the UI but
    // easy to skip in a hand-crafted request), reject.
    const consent_policies = (consent_policies_raw as unknown[])
      .map((v) => String(v))
      .filter((v) => KNOWN_POLICIES.has(v));
    if (consent_policies.length === 0) {
      return err("Consent is required to continue.", 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Load the target row (no join — Supabase's inferred types choke on
    // aliased embeds inside PATCH handlers). We fetch the EPC row
    // separately below for the WhatsApp payload.
    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select("id, status, current_step, epc_business_id")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);
    if ((app.current_step ?? 1) > 1) {
      return err("Step 1 has already been completed for this application.", 409);
    }

    // Persist fields + consent + WhatsApp bookkeeping. current_step
    // stays at 1 for now; we bump it after the send call succeeds.
    const consent_at = new Date().toISOString();
    const consent_ip = firstIp(req);
    const consent_user_agent = (req.headers.get("user-agent") ?? "").slice(0, 500);

    const patch: Record<string, unknown> = {
      install_pincode,
      install_state,
      install_district,
      install_city,
      borrower_mobile,
      borrower_email,
      system_type,
      consent_at,
      consent_policies,
      consent_ip,
      consent_user_agent,
    };

    const { error: upd1Err } = await supabase
      .from("epc_applications")
      .update(patch)
      .eq("id", appId);
    if (upd1Err) return err(`Save failed: ${upd1Err.message}`, 500);

    // Load the EPC row for the WhatsApp payload's display name.
    const { data: epc } = await supabase
      .from("epc_business")
      .select("contact_name, trade_name, legal_name")
      .eq("id", app.epc_business_id)
      .maybeSingle();
    const epcName = epc?.trade_name || epc?.legal_name || epc?.contact_name || null;

    const wa = await sendWhatsAppConfirmation({
      applicationId: appId,
      borrowerName: null,   // not collected yet (later step)
      borrowerMobile: borrower_mobile,
      epcName,
    });

    // Persist WhatsApp result + advance current_step.
    // If the send call reported failure, we still record the attempt
    // (status='failed', sent_at=now) but do NOT advance the step —
    // the admin can retry from the Step 1 page.
    const now = new Date().toISOString();
    if (wa.ok) {
      const { error: upd2Err } = await supabase
        .from("epc_applications")
        .update({
          whatsapp_confirmation_status: "sent",
          whatsapp_sent_at: now,
          whatsapp_provider_msg_id: wa.provider_message_id,
          current_step: 2,
        })
        .eq("id", appId);
      if (upd2Err) return err(`Confirmation recorded but step advance failed: ${upd2Err.message}`, 500);

      return NextResponse.json({ ok: true, next_step: 2, whatsapp: wa });
    } else {
      await supabase
        .from("epc_applications")
        .update({
          whatsapp_confirmation_status: "failed",
          whatsapp_sent_at: now,
        })
        .eq("id", appId);
      return err(`WhatsApp send failed: ${wa.error ?? "unknown"}`, 502);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-step-1] error:", msg);
    return err(msg, 500);
  }
}
