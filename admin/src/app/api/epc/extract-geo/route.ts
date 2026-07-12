// POST /api/epc/extract-geo   multipart { file }
//   -> { ok: true, found: boolean, lat, lng, raw_text }
//   or { ok: false, error }
//
// Reads the location coordinates that GPS-camera apps (GPS Map Camera and
// similar) BURN onto the photo as a visible banner, e.g.
//   "Lat 27.35471° Long 75.405213°".
// Such photos usually carry NO EXIF GPS, so the client's EXIF reader finds
// nothing — this route OCRs the pixels (same Cloud Run Google Vision setup as
// the cheque / PAN / Aadhaar OCR) and pulls the coordinates out of the stamp,
// letting Step-5 accept a genuinely location-stamped office photo.
//
// Auth: any authenticated business (the onboarding EPC). No DB write here.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { visionDocumentText } from "@/lib/vision-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DIMENSION = 2200;
const RAW_TEXT_CAP = 4000;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// Pulls a coordinate pair out of a GPS-stamp banner. Matches
// "Lat 27.35471° Long 75.405213°" (with or without the degree sign, on one
// line or split across two), and falls back to a bare "lat, lng" pair. A
// real coordinate carries decimals, so we require them — that keeps the
// pincode / phone numbers in the stamp from being mistaken for coordinates.
function parseStampCoords(text: string): { lat: number; lng: number } | null {
  if (!text) return null;
  const t = text.replace(/ /g, " ");

  const latM = t.match(/\bLat(?:itude)?[\s:]*([+-]?\d{1,2}\.\d{3,})/i);
  const lngM = t.match(/\bLong(?:itude)?[\s:]*([+-]?\d{1,3}\.\d{3,})/i);
  let lat = latM ? Number(latM[1]) : NaN;
  let lng = lngM ? Number(lngM[1]) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const pair = t.match(/([+-]?\d{1,2}\.\d{4,})\s*[,°]?\s*([+-]?\d{1,3}\.\d{4,})/);
    if (pair) { lat = Number(pair[1]); lng = Number(pair[2]); }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    await verifyJwt(token); // any authenticated business may OCR its own photo

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err("Photo is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, or WebP.", 400);

    // Downscale before Vision. Keep it fairly large so the small stamp text
    // stays legible to OCR.
    const input = Buffer.from(await file.arrayBuffer());
    const buffer = await sharp(input)
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    let rawText = "";
    try {
      rawText = await visionDocumentText(buffer, "image/jpeg");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[extract-geo] vision error:", msg);
      return err(msg, 502);
    }

    const coords = parseStampCoords(rawText || "");
    return NextResponse.json({
      ok: true,
      found: !!coords,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      raw_text: (rawText || "").slice(0, RAW_TEXT_CAP),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-geo] error:", msg);
    return err(msg, 500);
  }
}
