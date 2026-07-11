// POST /api/epc/extract-cheque   multipart { file }
//   -> { ok: true, accountNumber, ifsc, bankName, raw_text }
//   or { ok: false, error }
//
// Cancelled-cheque OCR for EPC onboarding Step 4. Runs on the SAME Cloud
// Run Google Vision setup as the loan-applicant PAN/Aadhaar OCR
// (lib/vision-server + GOOGLE_VISION_API_KEY) — NOT the Supabase Edge
// Function, whose separate key store was returning empty text. The cheque
// is already uploaded by the FileUpload component; this route only OCRs
// the in-memory file and returns the parsed fields for the form to prefill.
//
// Auth: any authenticated business (the onboarding EPC). No DB write here.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { visionDocumentText } from "@/lib/vision-server";
import { parseChequeFields } from "@/lib/cheque-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DIMENSION = 2000;
const RAW_TEXT_CAP = 4000;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    await verifyJwt(token); // any authenticated business may OCR its own cheque

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err("Cheque file is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);

    // Compress images before Vision (same as the loan-app routes); PDFs pass through.
    const input = Buffer.from(await file.arrayBuffer());
    let buffer: Buffer = input;
    let mime = file.type;
    if (file.type.startsWith("image/")) {
      buffer = await sharp(input)
        .rotate()
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      mime = "image/jpeg";
    }

    let rawText = "";
    let visionError: string | null = null;
    try {
      rawText = await visionDocumentText(buffer, mime);
    } catch (e) {
      visionError = e instanceof Error ? e.message : String(e);
      console.error("[extract-cheque] vision error:", visionError);
      return err(visionError, 502);
    }

    const fields = parseChequeFields(rawText || "");

    return NextResponse.json({
      ok: true,
      accountNumber: fields.accountNumber,
      ifsc:          fields.ifsc,
      bankName:      fields.bankName,
      raw_text:      (rawText || "").slice(0, RAW_TEXT_CAP),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-cheque] error:", msg);
    return err(msg, 500);
  }
}
