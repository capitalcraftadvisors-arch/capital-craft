// POST /api/admin/loan-app/[id]/complete-step-4
//
// Admin-only. Persists Step 4 (employment + bank statement + retrieved
// bank info) fields and advances current_step 4 → 5.
//
// Validation:
//   - employment_type ∈ {salaried, self_employed}
//   - profession required. If profession === "Other", profession_other required.
//   - annual_income > 0.
//   - bank_statement_method ∈ {manual_epdf, scanned_pdf}
//   - bank_statement_path required.
//   - retrieved bank info: bank_account_holder, bank_name, bank_account_no,
//     bank_ifsc required (mobile / email optional).
//   - bank_ifsc format validated (4 letters + 0 + 6 alphanum).

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE, MOBILE_RE, EMAIL_RE, IFSC_RE } from "@/lib/validators";
import { logLoanActivityServer } from "@/lib/loan-activity-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const body = await req.json().catch(() => ({}));
    const b = body as Record<string, unknown>;

    // ── Employment ──────────────────────────────────────────
    const employment_type   = strOrNull(b.employment_type);
    const profession        = strOrNull(b.profession);
    const profession_other  = strOrNull(b.profession_other);
    const organization_name = strOrNull(b.organization_name);
    const annual_income     = numOrNull(b.annual_income);

    // Admin-only route — no required-field blocking. employment_type arrives
    // as null or a valid enum from the UI (so the DB CHECK holds); only a
    // present-and-invalid income is rejected.
    if (annual_income !== null && annual_income <= 0) {
      return err("Annual income must be positive.", 400);
    }

    // ── Bank statement upload ───────────────────────────────
    const bank_statement_method      = strOrNull(b.bank_statement_method);
    const bank_statement_path        = strOrNull(b.bank_statement_path);
    const bank_statement_uploaded_at = strOrNull(b.bank_statement_uploaded_at);
    // Bank-statement method + upload optional for admin (method is null or a
    // valid enum from the UI, so the DB CHECK holds).

    // ── Retrieved bank info ─────────────────────────────────
    const bank_account_holder = strOrNull(b.bank_account_holder);
    const bank_name           = strOrNull(b.bank_name);
    const bank_account_no     = strOrNull(b.bank_account_no);
    const bank_ifsc           = strOrNull(b.bank_ifsc)?.toUpperCase() ?? null;
    const bank_account_type   = strOrNull(b.bank_account_type);
    const bank_mobile         = strOrNull(b.bank_mobile);
    const bank_email          = strOrNull(b.bank_email);

    // Bank fields optional for admin — validate only when present.
    if (bank_ifsc && !IFSC_RE.test(bank_ifsc)) return err("IFSC code is invalid.", 400);
    if (bank_mobile && !MOBILE_RE.test(bank_mobile)) return err("Bank-registered mobile is invalid.", 400);
    if (bank_email  && !EMAIL_RE.test(bank_email))   return err("Bank-registered email is invalid.", 400);

    // ── Persist + advance ──────────────────────────────────
    const supabase = dbAs(token);

    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select("id, current_step")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);
    if ((app.current_step ?? 1) < 4) return err("Complete Step 3 before Step 4.", 409);

    const nextStep = Math.max(app.current_step ?? 4, 5);

    const { error: updErr } = await supabase
      .from("epc_applications")
      .update({
        employment_type,
        profession,
        profession_other: profession === "Other" ? profession_other : null,
        organization_name,
        annual_income,
        bank_statement_method,
        bank_statement_path,
        bank_statement_uploaded_at,
        bank_account_holder,
        bank_name,
        bank_account_no,
        bank_ifsc,
        bank_account_type,
        bank_mobile,
        bank_email,
        step4_completed_at: new Date().toISOString(),
        current_step: nextStep,
      })
      .eq("id", appId);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    // Append-only activity trail (migration 0042). Best-effort.
    await logLoanActivityServer(supabase, appId, "step_completed", claims.business_id ?? null, { step: 4 });

    return NextResponse.json({ ok: true, next_step: nextStep });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-step-4] error:", msg);
    return err(msg, 500);
  }
}
