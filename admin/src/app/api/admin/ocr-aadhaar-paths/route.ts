// POST /api/admin/ocr-aadhaar-paths
//
// Re-runs Aadhaar OCR against images ALREADY stored in GCS (by path) and
// returns the extracted fields — it performs NO database write. Used by the
// one-shot backfill that recovers the full 12-digit number for chatbot apps
// created while the intake flow was persisting only the masked last-4. The DB
// update is done separately by the operator (direct SQL, last-4 cross-checked),
// so this route stays a pure, side-effect-free reader.
//
// Auth: admin only. Runs on Cloud Run where GCS ADC + the Gemini key exist.

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { downloadBuffer } from "@/lib/gcs";
import { geminiExtractAadhaar } from "@/lib/aadhaar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function mimeOf(path: string): string {
  return /\.pdf$/i.test(path) ? "application/pdf" : "image/jpeg";
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const body = (await req.json().catch(() => ({}))) as { front?: string; back?: string };
    const front = String(body.front ?? "").trim();
    const back = String(body.back ?? "").trim();
    if (!front) return err("front path is required.", 400);

    const images: { buffer: Buffer; mime: string }[] = [];
    try {
      images.push({ buffer: await downloadBuffer(front), mime: mimeOf(front) });
      if (back) images.push({ buffer: await downloadBuffer(back), mime: mimeOf(back) });
    } catch (e) {
      return err("Could not read stored image: " + (e instanceof Error ? e.message : String(e)), 404);
    }

    const fields = await geminiExtractAadhaar(images);
    // geminiExtractAadhaar only returns a number that is a valid 12-digit
    // Verhoeff-passing Aadhaar; otherwise aadhaar_number is null.
    return NextResponse.json({
      ok: true,
      aadhaar_number: fields?.aadhaar_number ?? null,
      aadhaar_masked: fields?.aadhaar_masked ?? null,
      name: fields?.name ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ocr-aadhaar-paths] error:", msg);
    return err(msg, 500);
  }
}
