// POST /api/epc/insurance/[id]/extract-gst   multipart { file }
//
// Uploads the GST REG-06 certificate to GCS (insurance/{id}/gst), OCRs it with
// the reliable Cloud Run Vision key, and runs the SAME parser the EPC
// onboarding uses (lib/gst-parser, ported verbatim from extract-gst-legalname)
// to pull Legal Name / Trade Name / GSTIN. Persists them + the path on the
// insurance row and returns them for on-screen review (editable).

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { visionDocumentText } from "@/lib/vision-server";
import { parseGstFields } from "@/lib/gst-parser";
import { geminiExtractGst } from "@/lib/doc-extractors";
import { storeInsuranceFile } from "@/lib/extract-server";
import { UUID_RE } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token } = auth;
    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    const stored = await storeInsuranceFile(await req.formData(), id, "gst", "GST certificate is required.");
    if (stored instanceof Response) return stored;
    const { buf, mime, path } = stored;

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

    const supabase = dbAs(token);
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
