// POST /api/epc/insurance/[id]/extract-gst   multipart { file }
//
// Uploads the GST REG-06 certificate to GCS (insurance/{id}/gst), OCRs it with
// the reliable Cloud Run Vision key, and runs the SAME parser the EPC
// onboarding uses (lib/gst-parser, ported verbatim from extract-gst-legalname)
// to pull Legal Name / Trade Name / GSTIN. Persists them + the path on the
// insurance row and returns them for on-screen review (editable).

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer } from "@/lib/gcs";
import { visionDocumentText } from "@/lib/vision-server";
import { parseGstFields } from "@/lib/gst-parser";
import { geminiExtractGst } from "@/lib/doc-extractors";
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

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err("GST certificate is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);

    const { buf, mime } = await compress(file);
    const path = `insurance/${id}/gst/${Date.now()}_${safeName(file.name, "gst")}`;
    await uploadBuffer(path, buf, mime);

    let fields = { gstin: null as string | null, legal_name: null as string | null, trade_name: null as string | null };
    const g = await geminiExtractGst([{ buffer: buf, mime }]);
    if (g) {
      fields = { gstin: g.gstin, legal_name: g.legal_name, trade_name: g.trade_name };
    } else {
      try {
        const rawText = await visionDocumentText(buf, mime);
        fields = parseGstFields(rawText || "");
      } catch (e) {
        console.warn("[insurance/extract-gst] vision failed:", e);
      }
    }

    const supabase = insuranceClient(token);
    const { error: updErr } = await supabase
      .from("insurance_applications")
      .update({
        gst_path: path,
        gst_legal_name: fields.legal_name ?? null,
        gst_trade_name: fields.trade_name ?? null,
        gstin: fields.gstin ?? null,
      })
      .eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true, fields });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/extract-gst] error:", msg);
    return err(msg, 500);
  }
}
