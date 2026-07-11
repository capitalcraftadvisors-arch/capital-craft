// POST /api/admin/loan-app/[id]/sign-doc
//
// Admin-only. Mints a 1-hour V4 signed read URL for a document stored as
// a *_path column on the epc_applications (loan) row — the Aadhaar
// front/back, e-bill, proforma invoice, bank statement and co-applicant
// documents that live as raw GCS paths rather than user_application_docs
// rows (those are viewed via /api/document/[id]).
//
// Security: the requested path is whitelisted against the actual
// *_path columns of THIS application, so an admin can only sign a path
// that genuinely belongs to the row they're viewing — never an arbitrary
// object key.
//
// Body: { path: string }  →  { ok: true, url } | { ok: false, error }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { getSignedReadUrl } from "@/lib/gcs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every *_path column on epc_applications that stores a viewable document.
const PATH_COLUMNS = [
  "aadhaar_front_path",
  "aadhaar_back_path",
  "aadhaar_face_path",
  "ebill_path",
  "proforma_invoice_path",
  "bank_statement_path",
  "customer_photo_path",
  "rooftop_photo_path",
  "coapp_pan_path",
  "coapp_aadhaar_front_path",
  "coapp_aadhaar_back_path",
  "coapp_aadhaar_face_path",
] as const;

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

    const body = await req.json().catch(() => ({}));
    const path = typeof (body as Record<string, unknown>).path === "string"
      ? String((body as Record<string, unknown>).path).trim()
      : "";
    if (!path) return err("Missing document path.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select(PATH_COLUMNS.join(", "))
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);

    // Whitelist: the path must match one of this row's stored *_path values.
    const row = app as unknown as Record<string, unknown>;
    const allowed = PATH_COLUMNS.some((col) => row[col] === path);
    if (!allowed) return err("Document does not belong to this application.", 403);

    const url = await getSignedReadUrl(path, 3600);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sign-doc] error:", msg);
    return err(msg, 500);
  }
}
