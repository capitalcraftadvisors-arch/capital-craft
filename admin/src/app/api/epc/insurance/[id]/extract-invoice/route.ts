// POST /api/epc/insurance/[id]/extract-invoice   multipart { file }
//
// Uploads the invoice to GCS (insurance/{id}/invoice), OCRs it, pulls out the
// FINAL invoice amount (parseInvoiceAmount), persists path + amount + raw text
// on the insurance row, and returns the amount so the EPC can confirm it —
// same reconfirm pattern as the cheque account number.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { visionDocumentText } from "@/lib/vision-server";
import { geminiExtractInvoice } from "@/lib/doc-extractors";
import { parseInvoiceAmount } from "@/lib/insurance-server";
import { storeInsuranceFile } from "@/lib/extract-server";
import { UUID_RE } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RAW_CAP = 4000;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token } = auth;
    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    const stored = await storeInsuranceFile(await req.formData(), id, "invoice", "Invoice file is required.");
    if (stored instanceof Response) return stored;
    const { buf, mime, path } = stored;

    let rawText = "";
    let amount: number | null = null;
    const g = await geminiExtractInvoice([{ buffer: buf, mime }]);
    if (g) {
      amount = g.amount;
      rawText = JSON.stringify(g);
    } else {
      try { rawText = await visionDocumentText(buf, mime); }
      catch (e) { console.warn("[insurance/extract-invoice] vision failed:", e); }
      amount = parseInvoiceAmount(rawText || "");
    }

    const supabase = dbAs(token);
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
