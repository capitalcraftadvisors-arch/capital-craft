// POST /api/admin/loan-app/[id]/swap-roles
//
// Admin-only. Swaps the applicant and the co-applicant of a file that has one
// (bill_on_applicant_name === false): identity, KYC, contact and earning
// columns trade places in ONE epc_applications update.
//
// The two PAN cards live in different stores — the applicant's in a
// user_application_docs "borrower_pan" row, the co-applicant's in the
// coapp_pan_path column — so they are moved across: the newest borrower_pan
// row's file → coapp_pan_path, the old coapp_pan_path → a new borrower_pan row.
//
// borrower_dob is a DATE (ISO); coapp_dob is text kept DD/MM/YYYY like the rest
// of the co-applicant form. A relation survives only when it is symmetric
// (Spouse). The 0091 earning columns are swapped once that migration has run
// (42703 → read/write without them).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { logLoanActivityServer, type LoanAction } from "@/lib/loan-activity-server";
import { fmtDate, toIsoDate } from "@/lib/dates";
import { isUndefinedColumn } from "@/lib/optional-column";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Applicant column ↔ co-applicant column, swapped value for value.
const PAIRS: [string, string][] = [
  ["borrower_name",        "coapp_name"],
  ["borrower_pan",         "coapp_pan"],
  ["borrower_father_name", "coapp_father_name"],
  ["borrower_mobile",      "coapp_mobile"],
  ["borrower_email",       "coapp_email"],
  ...["name", "dob", "gender", "number", "number_masked", "care_of", "address", "front_path", "back_path", "face_path"]
    .map((f): [string, string] => [`aadhaar_${f}`, `coapp_aadhaar_${f}`]),
];
// Migration 0091. monthly_income predates it but only moves together with its
// co-applicant counterpart.
const EARNING_PAIRS: [string, string][] = [
  ["applicant_earning", "coapp_earning"],
  ["monthly_income",    "coapp_monthly_income"],
];
const BASE_COLS = ["bill_on_applicant_name", "borrower_dob", "coapp_dob", "coapp_relation", "coapp_pan_path", ...PAIRS.flat()];

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
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

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const load = (cols: string[]) =>
      supabase.from("epc_applications").select(cols.join(", ")).eq("id", appId).maybeSingle();
    let loaded = await load([...BASE_COLS, ...EARNING_PAIRS.flat()]);
    const hasEarning = !isUndefinedColumn(loaded.error);
    if (!hasEarning) loaded = await load(BASE_COLS);
    if (loaded.error) return err(loaded.error.message, 500);
    const app = loaded.data as Record<string, unknown> | null;
    if (!app) return err("Loan application not found.", 404);
    if (app.bill_on_applicant_name !== false) return err("This file has no co-applicant.", 409);

    // Newest first — the newest borrower_pan row is the one the profile shows.
    const { data: panRows, error: panErr } = await supabase
      .from("user_application_docs")
      .select("id, storage_path")
      .eq("application_id", appId)
      .eq("category", "borrower_pan")
      .order("created_at", { ascending: false });
    if (panErr) return err(panErr.message, 500);

    const patch: Record<string, unknown> = {};
    for (const [a, c] of hasEarning ? [...PAIRS, ...EARNING_PAIRS] : PAIRS) {
      patch[a] = app[c] ?? null;
      patch[c] = app[a] ?? null;
    }
    patch.borrower_dob   = toIsoDate(app.coapp_dob as string | null);
    patch.coapp_dob      = app.borrower_dob ? fmtDate(app.borrower_dob as string) : null;
    patch.coapp_relation = app.coapp_relation === "Spouse" ? "Spouse" : null;
    patch.coapp_pan_path = panRows?.[0]?.storage_path ?? null;
    if (hasEarning) patch.coapp_role_reason = "Roles swapped by team";

    // The co-applicant's PAN becomes the applicant's borrower_pan row. Filed
    // BEFORE the update and the old rows removed only AFTER it, so a failure
    // part-way never loses a PAN file (a failed update takes the new row back).
    const oldCoappPan = (app.coapp_pan_path as string | null) || null;
    const newPanRowId = oldCoappPan ? crypto.randomUUID() : null;
    if (oldCoappPan) {
      const { error: insErr } = await supabase.from("user_application_docs").insert({
        id: newPanRowId, application_id: appId, category: "borrower_pan", storage_path: oldCoappPan,
        file_name: oldCoappPan.split("/").pop(),
        mime_type: /\.pdf$/i.test(oldCoappPan) ? "application/pdf" : "image/jpeg",
        uploaded_by: "admin",
      });
      if (insErr) return err(`Swap failed: ${insErr.message}`, 500);
    }

    const { error: updErr } = await supabase.from("epc_applications").update(patch).eq("id", appId);
    if (updErr) {
      if (newPanRowId) await supabase.from("user_application_docs").delete().eq("id", newPanRowId);
      return err(`Swap failed: ${updErr.message}`, 500);
    }

    if (panRows?.length) {
      const { error: delErr } = await supabase
        .from("user_application_docs")
        .delete()
        .in("id", panRows.map((r) => r.id));
      if (delErr) console.warn("[swap-roles] old applicant PAN rows:", delErr.message);
    }

    // Append-only activity trail. LoanAction doesn't list this action yet; the
    // column is free text and the log modal shows the detail.
    await logLoanActivityServer(supabase, appId, "roles_swapped" as LoanAction, claims.business_id ?? null, {
      detail: "Applicant ↔ co-applicant swapped",
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[swap-roles] error:", msg);
    return err(msg, 500);
  }
}
