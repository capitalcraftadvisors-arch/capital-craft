// POST /api/epc/quotation/ocr  (multipart: file=<image>)
//
// One-photo auto-fill for the Quotation Builder: the EPC uploads a single image
// holding the customer's details (a note, form, bill, or screenshot); Gemini
// extracts the quotation fields → the form pre-fills them → the EPC reviews →
// downloads. Returns { ok, fields }. Best-effort: missing fields come back null.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { geminiExtractQuotation } from "@/lib/doc-extractors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(m: string, s: number) { return NextResponse.json({ ok: false, error: m }, { status: s }); }

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    await verifyJwt(token);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) return err("Attach an image.", 400);
    const raw = Buffer.from(await file.arrayBuffer());
    if (!raw.length) return err("Empty file.", 400);

    // Compress/normalise for the model (handles big phone photos).
    let buffer: Buffer = raw;
    let mime = file.type || "image/jpeg";
    if (mime.startsWith("image/")) {
      try {
        buffer = await sharp(raw).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
        mime = "image/jpeg";
      } catch { buffer = raw; }
    }

    const fields = await geminiExtractQuotation([{ buffer, mime }]);
    if (!fields) return NextResponse.json({ ok: true, fields: {} });
    return NextResponse.json({ ok: true, fields });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[quotation/ocr] error:", msg);
    return err(msg, 500);
  }
}
