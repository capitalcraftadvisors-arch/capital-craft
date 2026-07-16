// POST /api/epc/insurance/[id]/extract-invoice   multipart { file }
//
// Uploads the invoice to GCS (insurance/{id}/invoice), OCRs it, pulls out the
// FINAL invoice amount (parseInvoiceAmount), persists path + amount + raw text
// on the insurance row, and returns the amount so the EPC can confirm it —
// same reconfirm pattern as the cheque account number.

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer } from "@/lib/gcs";
import { visionDocumentText } from "@/lib/vision-server";
import { insuranceClient, compress, safeName, parseInvoiceAmount, UUID_RE, ACCEPTED } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RAW_CAP = 4000;

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

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err("Invoice file is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);

    const { buf, mime } = await compress(file);
    const path = `insurance/${id}/invoice/${Date.now()}_${safeName(file.name, "invoice")}`;
    await uploadBuffer(path, buf, mime);

    let rawText = "";
    try { rawText = await visionDocumentText(buf, mime); }
    catch (e) { console.warn("[insurance/extract-invoice] vision failed:", e); }
    const amount = parseInvoiceAmount(rawText || "");

    const supabase = insuranceClient(token);
    const { error: updErr } = await supabase
      .from("insurance_applications")
      .update({ invoice_path: path, invoice_amount: amount, invoice_ocr_raw: (rawText || "").slice(0, RAW_CAP) })
      .eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true, amount });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/extract-invoice] error:", msg);
    return err(msg, 500);
  }
}
