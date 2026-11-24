// POST /api/epc/bill-to-quote   multipart { file }  (a photo or PDF of an electricity bill)
//   → { ok: true, fields: BillQuoteFields }  or  { ok: false, error }
//
// "From bill photo" on Quotations (Partner Portal v2): Gemini reads the
// customer's bill — units and the bill a month, the sanctioned load, domestic
// or not, the consumer's name and address, DISCOM, state — and the portal
// drafts the quotation from it (lib/bill-quote). Same compression and Gemini
// call as /api/ocr. Nothing is stored and no table is read.
//
// Auth: a signed-in login that may make quotations (not Viewer / Site staff).

import { NextRequest, NextResponse } from "next/server";
import { err, requireLogin } from "@/lib/api";
import { compressUpload } from "@/lib/image-compress";
import { geminiExtractBillForQuote } from "@/lib/doc-extractors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { claims } = auth;
    if (claims.member_role === "VIEWER" || claims.member_role === "SITE") return err("You don't have access to make quotations.", 403);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob) || !file.size) return err("Choose a photo of the bill.");
    const type = file.type || "image/jpeg";
    if (!type.startsWith("image/") && type !== "application/pdf") return err("Choose a photo or a PDF of the bill.");
    if (file.size > MAX_BYTES) return err("This file is too big. Choose one under 20 MB.");

    // Images → JPEG, 2000 px, as /api/ocr; PDFs as they are. Raw bytes if the image can't be decoded.
    const raw = Buffer.from(await file.arrayBuffer());
    const { output, mime } = await compressUpload(raw, type).catch(() => ({ output: raw, mime: type }));
    const fields = await geminiExtractBillForQuote([{ buffer: output, mime }]);
    if (!fields) return err("Couldn't read this bill. Try a clearer photo.", 422);
    return NextResponse.json({ ok: true, fields });
  } catch (e) {
    console.error("[bill-to-quote] error:", e instanceof Error ? e.message : String(e));
    return err("Couldn't read this bill. Please try again.", 500);
  }
}
