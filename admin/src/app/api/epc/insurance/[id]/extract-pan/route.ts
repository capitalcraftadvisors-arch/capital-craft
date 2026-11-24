// POST /api/epc/insurance/[id]/extract-pan   multipart { file }
//
// Uploads the PAN to GCS (insurance/{id}/pan), OCRs it with the SAME
// lib/pan-parser + lib/vision-server the loan flow uses, persists the PAN
// number + path on the insurance row, and returns the parsed fields.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { visionDocumentText } from "@/lib/vision-server";
import { parsePanFields } from "@/lib/pan-parser";
import { geminiExtractPan } from "@/lib/doc-extractors";
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

    const stored = await storeInsuranceFile(await req.formData(), id, "pan", "PAN file is required.");
    if (stored instanceof Response) return stored;
    const { buf, mime, path } = stored;

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

    const supabase = dbAs(token);
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
