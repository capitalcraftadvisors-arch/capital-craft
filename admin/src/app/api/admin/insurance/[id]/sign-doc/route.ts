// POST /api/admin/insurance/[id]/sign-doc   { path }
//
// Admin-only. Mints a 1-hour signed read URL for a document stored as a
// *_path column on the insurance row. The path is whitelisted against THIS
// row's own *_path columns, so admin can only sign a path that belongs to the
// application being viewed. Same pattern as the loan sign-doc route.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { getSignedReadUrl } from "@/lib/gcs";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH_COLUMNS = [
  "pan_path", "aadhaar_front_path", "aadhaar_back_path", "aadhaar_face_path",
  "gst_path", "ebill_path", "invoice_path", "policy_path", "plant_photo_path",
  "photo_panel_path", "photo_inverter_path", "photo_meter_path",
] as const;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    const body = await req.json().catch(() => ({}));
    const path = typeof (body as Record<string, unknown>).path === "string"
      ? String((body as Record<string, unknown>).path).trim() : "";
    if (!path) return err("Missing document path.", 400);

    const supabase = dbAs(token);
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
    const msg = errText(e);
    console.error("[insurance/sign-doc] error:", msg);
    return err(msg, 500);
  }
}
