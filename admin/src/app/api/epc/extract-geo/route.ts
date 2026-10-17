// POST /api/epc/extract-geo   multipart { file }
//   -> { ok: true, found: boolean, lat, lng, raw_text }
//   or { ok: false, error }
//
// Reads the location coordinates that GPS-camera apps (GPS Map Camera and
// similar) BURN onto the photo as a visible banner, e.g.
//   "Lat 27.35471° Long 75.405213°".
// Such photos usually carry NO EXIF GPS, so the client's EXIF reader finds
// nothing — this route reads the pixels and pulls the coordinates out of the
// stamp, letting a genuinely location-stamped photo be accepted.
//
// The location is PROOF (geo-tagged photos are mandatory), so the literal
// reader goes first: Google Vision text + the stamp parser, then Vision on a
// zoomed crop of the bottom banner (where the stamp sits; the full photo is
// downscaled, so small stamp text can be lost). Gemini is the last resort for
// layouts the parser misses — and its answer only counts when Vision also saw
// those coordinates' degrees printed, so a photo with no stamp can never pass
// on a guess.
//
// Auth: any authenticated business (the onboarding EPC). No DB write here.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { visionDocumentText } from "@/lib/vision-server";
import { geminiExtractGeoStamp } from "@/lib/doc-extractors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DIMENSION = 2200;
const RAW_TEXT_CAP = 4000;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type Coords = { lat: number; lng: number };

function valid(lat: number, lng: number): Coords | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

const sign = (v: number, hemi: string) => (/[SW]/i.test(hemi) ? -Math.abs(v) : v);

// Pulls a coordinate pair out of a GPS-stamp banner. Handles the common stamp
// layouts (one line or split across lines):
//   "Lat 27.35471° Long 75.405213°" / "Latitude: 27.35 Longitude: 75.40" / "Lng"
//   "27.354710° N 75.405213° E" / "N 27.354710 E 75.405213"
//   "27°21'17.0"N 75°24'18.8"E" (degrees-minutes-seconds)
//   a bare "27.35471, 75.405213" pair.
// A real coordinate carries decimals (or full DMS), which keeps the pincode /
// phone numbers in the stamp from being mistaken for coordinates.
function parseStampCoords(text: string): Coords | null {
  if (!text) return null;
  const t = text
    .replace(/[  ]/g, " ")
    .replace(/(\d)\s*\.\s+(\d{3,})/g, "$1.$2")    // "27. 35471" → "27.35471"
    .replace(/(\d),(\d{4,})/g, "$1.$2");          // decimal comma "27,35471"
  const NUM_LAT = "([+-]?\\d{1,2}\\.\\d{3,})";
  const NUM_LNG = "([+-]?\\d{1,3}\\.\\d{3,})";

  // Labelled: Lat / Latitude … Long / Lon / Lng / Longitude (optional N/E/S/W).
  const latM = t.match(new RegExp(`\\bLat(?:itude)?\\.?[\\s:=]*${NUM_LAT}\\s*°?\\s*([NS])?`, "i"));
  const lngM = t.match(new RegExp(`\\b(?:Long(?:itude)?|Lon|Lng)\\.?[\\s:=]*${NUM_LNG}\\s*°?\\s*([EW])?`, "i"));
  if (latM && lngM) {
    const c = valid(sign(Number(latM[1]), latM[2] ?? ""), sign(Number(lngM[1]), lngM[2] ?? ""));
    if (c) return c;
  }

  // Degrees-minutes-seconds: 27°21'17.0"N 75°24'18.8"E
  const dms = (deg: string, min: string, sec: string, hemi: string) =>
    sign(Number(deg) + Number(min) / 60 + Number(sec || 0) / 3600, hemi);
  const dLat = t.match(/(\d{1,2})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)?\s*["″”]?\s*([NS])\b/i);
  const dLng = t.match(/(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)?\s*["″”]?\s*([EW])\b/i);
  if (dLat && dLng) {
    const c = valid(dms(dLat[1], dLat[2], dLat[3], dLat[4]), dms(dLng[1], dLng[2], dLng[3], dLng[4]));
    if (c) return c;
  }

  // Hemisphere decimals: "27.354710° N 75.405213° E" or "N 27.354710 E 75.405213".
  const hSuffix = t.match(new RegExp(`${NUM_LAT}\\s*°?\\s*([NS])\\b[\\s,]*${NUM_LNG}\\s*°?\\s*([EW])\\b`, "i"));
  if (hSuffix) {
    const c = valid(sign(Number(hSuffix[1]), hSuffix[2]), sign(Number(hSuffix[3]), hSuffix[4]));
    if (c) return c;
  }
  const hPrefix = t.match(new RegExp(`\\b([NS])\\s*${NUM_LAT}\\s*°?[\\s,]*([EW])\\s*${NUM_LNG}`, "i"));
  if (hPrefix) {
    const c = valid(sign(Number(hPrefix[2]), hPrefix[1]), sign(Number(hPrefix[4]), hPrefix[3]));
    if (c) return c;
  }

  // Bare "lat, lng" pair.
  const pair = t.match(/([+-]?\d{1,2}\.\d{4,})\s*°?\s*[,;]?\s*([+-]?\d{1,3}\.\d{4,})/);
  return pair ? valid(Number(pair[1]), Number(pair[2])) : null;
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

    // Downscale before OCR. Keep it fairly large so the small stamp text stays
    // legible.
    const input = Buffer.from(await file.arrayBuffer());
    const upright = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
    const buffer = await sharp(upright.data)
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    const found = (c: Coords | null, raw: string) => NextResponse.json({
      ok: true, found: !!c, lat: c?.lat ?? null, lng: c?.lng ?? null, raw_text: raw.slice(0, RAW_TEXT_CAP),
    });

    // 1) Vision text of the whole photo + the stamp parser.
    let rawText = "";
    try {
      rawText = await visionDocumentText(buffer, "image/jpeg");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[extract-geo] vision error:", msg);
      return err(msg, 502);
    }
    const coords = parseStampCoords(rawText || "");
    if (coords) return found(coords, rawText || "");

    // 2) Vision on the bottom banner, zoomed (the stamp's small text survives).
    let cropText = "";
    const { width: w = 0, height: h = 0 } = upright.info;
    if (w > 0 && h > 0) {
      const top = Math.round(h * 0.55);
      const crop = await sharp(upright.data)
        .extract({ left: 0, top, width: w, height: h - top })
        .resize({ width: 2400, withoutEnlargement: true })
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer();
      cropText = await visionDocumentText(crop, "image/jpeg").catch(() => "");
      const c2 = parseStampCoords(cropText || "");
      if (c2) return found(c2, cropText);
    }

    // 3) Gemini for stamp layouts the parser misses — accepted only when Vision
    // also read both coordinates' whole degrees as printed numbers.
    const seen = `${rawText}\n${cropText}`;
    const printed = (v: number) => new RegExp(`(^|[^\\d])${Math.trunc(Math.abs(v))}\\s*[.,°]`).test(seen);
    const g = seen.trim() ? await geminiExtractGeoStamp([{ buffer, mime: "image/jpeg" }]) : null;
    if (g && printed(g.lat) && printed(g.lng)) return found(g, seen);
    return found(null, rawText || "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-geo] error:", msg);
    return err(msg, 500);
  }
}
