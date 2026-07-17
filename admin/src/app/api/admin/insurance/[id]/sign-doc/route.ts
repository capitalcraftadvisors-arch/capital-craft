// POST /api/admin/insurance/[id]/sign-doc   { path }
//
// Admin-only. Mints a 1-hour signed read URL for a document stored as a
// *_path column on the insurance row. The path is whitelisted against THIS
// row's own *_path columns, so admin can only sign a path that belongs to the
// application being viewed. Same pattern as the loan sign-doc route.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { getSignedReadUrl } from "@/lib/gcs";
import { SUPABASE_URL, SUPABASE_ANON, UUID_RE } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH_COLUMNS = [
  "pan_path", "aadhaar_front_path", "aadhaar_back_path", "aadhaar_face_path",
  "gst_path", "invoice_path",
  "photo_panel_path", "photo_inverter_path", "photo_meter_path",
  "plant_photo_path", // legacy single plant photo
] as const;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    const body = await req.json().catch(() => ({}));
    const path = typeof (body as Record<string, unknown>).path === "string"
      ? String((body as Record<string, unknown>).path).trim() : "";
    if (!path) return err("Missing document path.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error: loadErr } = await supabase
      .from("insurance_applications")
      .select(PATH_COLUMNS.join(", "))
      .eq("id", id)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!data) return err("Insurance application not found.", 404);

    const row = data as unknown as Record<string, unknown>;
    const allowed = PATH_COLUMNS.some((c) => row[c] === path);
    if (!allowed) return err("Document does not belong to this application.", 403);

    const url = await getSignedReadUrl(path, 3600);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/sign-doc] error:", msg);
    return err(msg, 500);
  }
}
