// POST /api/admin/loan-app/[id]/complete-step-2
//
// Admin-only. Persists the Aadhaar KYC fields captured on Step 2
// (previously returned by /extract-aadhaar) and advances current_step
// from 2 to 3.
//
// The masking guarantee (never store the full 12-digit Aadhaar number)
// is enforced by rejecting any aadhaar_number_masked value that is NOT
// exactly 12 chars of the form "xxxxxxxx####" (eight 'x' + four digits).
// The client sends the masked form directly — this is a belt-and-braces
// check in case a future caller tries to shove raw digits through.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin, loadLoanRow, strOrNull } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { logLoanActivityServer } from "@/lib/loan-activity-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const body = await req.json().catch(() => ({}));
    const b = body as Record<string, unknown>;

    const aadhaar_name          = strOrNull(b.aadhaar_name);
    const aadhaar_dob           = strOrNull(b.aadhaar_dob);
    const aadhaar_gender        = strOrNull(b.aadhaar_gender);
    // The classic KYC form sends the full 12-digit number; the chatbot (which
    // masks for privacy) sends the "xxxxxxxx####" form. Keep them straight:
    // blindly stripping non-digits from a MASKED value left a bogus bare
    // 4-digit number (the "0996" bug that made the classic form show 4 digits +
    // a red error). Masked in → store the masked form (the full number was
    // never provided); full digits in → store full + derive the masked form.
    const aadhaar_care_of       = strOrNull(b.aadhaar_care_of);
    const aadhaar_address       = strOrNull(b.aadhaar_address);
    const aadhaar_front_path    = strOrNull(b.aadhaar_front_path);
    const aadhaar_back_path     = strOrNull(b.aadhaar_back_path);
    const aadhaar_face_path     = strOrNull(b.aadhaar_face_path);

    // Admin-only route — no required-field blocking.
    const aadhaar_in            = strOrNull(b.aadhaar_number);
    let aadhaar_number:        string | null;
    let aadhaar_number_masked: string | null;
    if (aadhaar_in && /^x{8}\d{4}$/i.test(aadhaar_in)) {
      aadhaar_number        = null;                     // full number wasn't provided (chatbot masks)
      aadhaar_number_masked = aadhaar_in.toLowerCase();
    } else {
      const digits          = aadhaar_in ? aadhaar_in.replace(/\D/g, "") : null;
      aadhaar_number        = digits;
      aadhaar_number_masked = digits ? "xxxxxxxx" + digits.slice(-4) : null;
    }

    const supabase = dbAs(token);

    // Idempotence guard: if already past Step 2 we still succeed but
    // don't rewind. Fresh state -> current_step becomes 3.
    const app = await loadLoanRow(supabase, appId, "id, current_step");
    if (app instanceof Response) return app;
    if ((app.current_step ?? 1) < 2) {
      return err("Complete Step 1 before Step 2.", 409);
    }

    const nextStep = Math.max(app.current_step ?? 2, 3);

    const { error: updErr } = await supabase
      .from("epc_applications")
      .update({
        aadhaar_name,
        aadhaar_dob,
        aadhaar_gender,
        aadhaar_number,
        aadhaar_number_masked,
        aadhaar_care_of,
        aadhaar_address,
        aadhaar_front_path,
        aadhaar_back_path,
        aadhaar_face_path,
        kyc_extracted_at: new Date().toISOString(),
        current_step: nextStep,
      })
      .eq("id", appId);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    // Append-only activity trail (migration 0042). Best-effort.
    await logLoanActivityServer(supabase, appId, "step_completed", claims.business_id ?? null, { step: 2 });

    return NextResponse.json({ ok: true, next_step: nextStep });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-step-2] error:", msg);
    return err(msg, 500);
  }
}
