// POST /api/epc/insurance/[id]/upload   multipart { file, kind, gps? }
//
// Generic upload for the docs that DON'T need OCR:
//   kind = "gst"      → optional GST certificate → gst_path
//   kind = "panel"    → customer with panel      → photo_panel_path    + _gps
//   kind = "inverter" → customer with inverter   → photo_inverter_path + _gps
//   kind = "meter"    → customer with meter      → photo_meter_path    + _gps
//   kind = "plant"    → legacy single plant photo (kept so old drafts still work)
//
// The client captures GPS for the photos (EXIF read of the ORIGINAL file, or a
// Vision-read GPS stamp) and passes it as a JSON string; we persist it as-is.
// Image compression happens here, AFTER the client has already read the GPS off
// the original file — so nothing is stripped before capture.

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer } from "@/lib/gcs";
import { insuranceClient, compress, safeName, UUID_RE, ACCEPTED } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    await verifyJwt(token);
    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    // kind → { folder, the columns it writes }. Geo photos carry gps.
    const KINDS: Record<string, { folder: string; pathCol: string; gpsCol?: string }> = {
      gst:      { folder: "gst",      pathCol: "gst_path" },
      panel:    { folder: "panel",    pathCol: "photo_panel_path",    gpsCol: "photo_panel_gps" },
      inverter: { folder: "inverter", pathCol: "photo_inverter_path", gpsCol: "photo_inverter_gps" },
      meter:    { folder: "meter",    pathCol: "photo_meter_path",    gpsCol: "photo_meter_gps" },
      plant:    { folder: "plant",    pathCol: "plant_photo_path",    gpsCol: "plant_photo_gps" },
    };

    const form = await req.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "");
    if (!(file instanceof File)) return err("File is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);
    const spec = KINDS[kind];
    if (!spec) return err("Invalid upload kind.", 400);

    let gps: unknown = null;
    const gpsRaw = form.get("gps");
    if (typeof gpsRaw === "string" && gpsRaw) { try { gps = JSON.parse(gpsRaw); } catch { gps = null; } }

    const { buf, mime } = await compress(file);
    const path = `insurance/${id}/${spec.folder}/${Date.now()}_${safeName(file.name, spec.folder)}`;
    await uploadBuffer(path, buf, mime);

    const patch: Record<string, unknown> = { [spec.pathCol]: path };
    if (spec.gpsCol) patch[spec.gpsCol] = gps;

    const supabase = insuranceClient(token);
    const { error: updErr } = await supabase.from("insurance_applications").update(patch).eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true, path });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/upload] error:", msg);
    return err(msg, 500);
  }
}
