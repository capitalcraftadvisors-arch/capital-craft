// POST /api/epc/insurance/[id]/extract-ebill   multipart { file }
//
// Uploads the site's electricity bill to GCS (insurance/{id}/ebill), OCRs it,
// and reuses the LOAN e-bill parser (lib/loan-docs parseEbill) to pull the
// installation ADDRESS. Persists the path + raw OCR text, and — only when the
// plant address is still blank — seeds plant_address with the read value. The
// returned address is shown editable so the EPC confirms it matches the bill.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { uploadBuffer } from "@/lib/gcs";
import { visionDocumentText } from "@/lib/vision-server";
import { parseEbill } from "@/lib/loan-docs";
import { geminiExtractEbill } from "@/lib/doc-extractors";
import { compress, safeName, ACCEPTED } from "@/lib/insurance-server";
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

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err("Electricity bill is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);

    const { buf, mime } = await compress(file);
    const path = `insurance/${id}/ebill/${Date.now()}_${safeName(file.name, "ebill")}`;
    await uploadBuffer(path, buf, mime);

    let rawText = "";
    let address: string | null = null;
    const g = await geminiExtractEbill([{ buffer: buf, mime }]);
    if (g) {
      address = g.ebill_address_line;
      rawText = JSON.stringify(g);
    } else {
      try {
        rawText = await visionDocumentText(buf, mime);
        address = parseEbill(rawText || "").ebill_address_line;
      } catch (e) {
        console.warn("[insurance/extract-ebill] vision failed:", e);
      }
    }

    const supabase = dbAs(token);
    // Only seed plant_address when it's currently empty — never clobber an
    // address the EPC already typed/confirmed.
    const { data: cur } = await supabase
      .from("insurance_applications")
      .select("plant_address")
      .eq("id", id)
      .maybeSingle();
    const patch: Record<string, unknown> = { ebill_path: path, ebill_ocr_raw: (rawText || "").slice(0, RAW_CAP) };
    if (address && !cur?.plant_address) patch.plant_address = address;

    const { error: updErr } = await supabase.from("insurance_applications").update(patch).eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true, address });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/extract-ebill] error:", msg);
    return err(msg, 500);
  }
}
