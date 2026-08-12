// POST /api/epc/insurance/[id]/extract-pan   multipart { file }
//
// Uploads the PAN to GCS (insurance/{id}/pan), OCRs it with the SAME
// lib/pan-parser + lib/vision-server the loan flow uses, persists the PAN
// number + path on the insurance row, and returns the parsed fields.

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer } from "@/lib/gcs";
import { visionDocumentText } from "@/lib/vision-server";
import { parsePanFields } from "@/lib/pan-parser";
import { geminiExtractPan } from "@/lib/doc-extractors";
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
    if (!(file instanceof File)) return err("PAN file is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);

    const { buf, mime } = await compress(file);
    const path = `insurance/${id}/pan/${Date.now()}_${safeName(file.name, "pan")}`;
    await uploadBuffer(path, buf, mime);

    let fields = { pan: null as string | null, name: null as string | null, father_name: null as string | null, dob: null as string | null };
    const g = await geminiExtractPan([{ buffer: buf, mime }]);
    if (g) {
      fields = g;
    } else {
      try {
        const rawText = await visionDocumentText(buf, mime);
        fields = parsePanFields(rawText || "");
      } catch (e) {
        console.warn("[insurance/extract-pan] vision failed:", e);
      }
    }

    const supabase = insuranceClient(token);
    const { error: updErr } = await supabase
      .from("insurance_applications")
      .update({ pan_number: fields.pan ?? null, pan_path: path })
      .eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true, fields });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/extract-pan] error:", msg);
    return err(msg, 500);
  }
}
