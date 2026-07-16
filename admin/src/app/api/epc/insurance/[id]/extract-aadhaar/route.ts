// POST /api/epc/insurance/[id]/extract-aadhaar   multipart { front, back }
//
// Uploads both Aadhaar sides to GCS (insurance/{id}/aadhaar_*), OCRs them with
// the SAME lib/aadhaar the loan flow uses, persists the parsed fields + paths
// onto the insurance row (RLS-scoped so the EPC can only write its own), and
// returns the fields for on-screen review. Face crop is best-effort.

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer } from "@/lib/gcs";
import { extractAadhaar, cropAndUploadFace } from "@/lib/aadhaar";
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
    const front = form.get("front");
    const back  = form.get("back");
    if (!(front instanceof File) || !(back instanceof File)) return err("Both Aadhaar sides are required.", 400);
    if (!ACCEPTED.has(front.type) || !ACCEPTED.has(back.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);

    const [f, b] = await Promise.all([compress(front), compress(back)]);
    const frontPath = `insurance/${id}/aadhaar_front/${Date.now()}_${safeName(front.name, "front")}`;
    const backPath  = `insurance/${id}/aadhaar_back/${Date.now()}_${safeName(back.name, "back")}`;
    await Promise.all([
      uploadBuffer(frontPath, f.buf, f.mime),
      uploadBuffer(backPath,  b.buf, b.mime),
    ]);

    // OCR each side separately (extractAadhaar takes one image); front is the
    // canonical identity, the back fills care_of / address which live there.
    const [fr, bk] = await Promise.all([extractAadhaar(f.buf, f.mime), extractAadhaar(b.buf, b.mime)]);
    const fields = {
      name:           fr.fields.name           ?? bk.fields.name,
      dob:            fr.fields.dob            ?? bk.fields.dob,
      gender:         fr.fields.gender         ?? bk.fields.gender,
      aadhaar_number: fr.fields.aadhaar_number ?? bk.fields.aadhaar_number,
      aadhaar_masked: fr.fields.aadhaar_masked ?? bk.fields.aadhaar_masked,
      care_of:        bk.fields.care_of        ?? fr.fields.care_of,
      address:        bk.fields.address        ?? fr.fields.address,
    };

    let facePath: string | null = null;
    try {
      const face = await cropAndUploadFace(f.buf, f.mime, id);
      facePath = face?.storage_path ?? null;
    } catch { /* best-effort */ }

    const supabase = insuranceClient(token);
    const { error: updErr } = await supabase
      .from("insurance_applications")
      .update({
        aadhaar_name:   fields.name ?? null,
        aadhaar_dob:    fields.dob ?? null,
        aadhaar_gender: fields.gender ?? null,
        aadhaar_number: fields.aadhaar_number ?? null,
        aadhaar_number_masked: fields.aadhaar_masked ?? null,
        aadhaar_care_of: fields.care_of ?? null,
        aadhaar_address: fields.address ?? null,
        aadhaar_front_path: frontPath,
        aadhaar_back_path:  backPath,
        aadhaar_face_path:  facePath,
      })
      .eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true, fields });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/extract-aadhaar] error:", msg);
    return err(msg, 500);
  }
}
