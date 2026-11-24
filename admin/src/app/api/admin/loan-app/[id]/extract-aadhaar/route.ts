// POST /api/admin/loan-app/[id]/extract-aadhaar
//
// Multipart body:
//   front:  File   (image/PDF)
//   back:   File   (image/PDF)
//
// Server-side flow:
//   1. Verify admin JWT.
//   2. Confirm loan app exists and is at current_step=2.
//   3. Compress each file with sharp (image only) — same 2000px cap +
//      JPEG-75 pipeline used by /api/upload for consistency.
//   4. Upload both compressed docs to GCS under applications/{id}/aadhaar_*.
//   5. Run Vision DOCUMENT_TEXT_DETECTION on both, parse Aadhaar fields.
//      Front's fields are the canonical set (name/dob/gender/number/gender);
//      back's fields fill gaps for care_of/address which live on the back.
//   6. Try FACE_DETECTION on front; if a face is found, crop + upload.
//   7. Return { fields, storage_paths, face_path } — NO DB write here.
//      The Step 2 page shows fields for admin review, then calls
//      complete-step-2 to persist.
//
// PRIVACY: the response carries BOTH the full number (`aadhaar_number`) and
// the masked form (`aadhaar_masked`). The RM-facing intake chat DISPLAYS the
// full number for identity verification but PERSISTS only the masked form to
// epc_applications (see intake/page.tsx mapExtract). Do not mask the response
// here — that would blank the number the RM needs to verify against the card.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { uploadBuffer, getSignedReadUrl } from "@/lib/gcs";
import { extractAadhaar, geminiExtractAadhaar, cropAndUploadFace, type AadhaarFields } from "@/lib/aadhaar";
import { checkLoanAppForUpload, compressFile, saveOcrRaw } from "@/lib/extract-server";
import { ACCEPTED, safeName } from "@/lib/upload-rules";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // ── auth ─────────────────────────────────────────────────
    // Admin, or the EPC that owns this application (EPC-facing apply
    // flow). Ownership is verified against the loaded row below; the
    // caller-token supabase client's RLS also scopes the SELECT.
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    // ── input parse ──────────────────────────────────────────
    const form = await req.formData();
    const front = form.get("front");
    const back  = form.get("back");
    if (!(front instanceof File) || !(back instanceof File)) {
      return err("Both front and back files are required.", 400);
    }
    if (!ACCEPTED.has(front.type) || !ACCEPTED.has(back.type)) {
      return err("Files must be JPEG, PNG, WebP, or PDF.", 400);
    }

    // ── target row check ─────────────────────────────────────
    // Admin (incl. the AI intake chat) may upload documents before step 1 is
    // formally completed; the EPC-facing flow still follows the step order.
    const supabase = dbAs(token);
    const blocked = await checkLoanAppForUpload(supabase, claims, appId, "id, current_step, status, epc_business_id", "Complete Step 1 before uploading Aadhaar.");
    if (blocked) return blocked;

    // ── compress + upload ────────────────────────────────────
    // Same pipeline as /api/upload (images → JPEG, 2000 px; PDFs untouched).
    const [frontComp, backComp] = await Promise.all([compressFile(front), compressFile(back)]);

    const frontPath = `applications/${appId}/aadhaar_front/${Date.now()}_${safeName(front.name, "front")}`;
    const backPath  = `applications/${appId}/aadhaar_back/${Date.now()}_${safeName(back.name, "back")}`;

    await Promise.all([
      uploadBuffer(frontPath, frontComp.output, frontComp.mime),
      uploadBuffer(backPath,  backComp.output,  backComp.mime),
    ]);

    // ── Extract fields ───────────────────────────────────────
    // PRIMARY: Gemini reads BOTH sides faithfully with a strict "copy only
    // what's printed, else null" prompt. It never throws — any failure
    // (billing, retired model, network) returns null and we fall back to the
    // Vision + regex parser below. The face crop further down always uses
    // Vision regardless.
    let merged = await geminiExtractAadhaar([
      { buffer: frontComp.output, mime: frontComp.mime },
      { buffer: backComp.output,  mime: backComp.mime },
    ]);
    let source: "gemini" | "vision" = "gemini";
    let frontOut: { fields: AadhaarFields; raw_text: string } | null = null;
    let backOut:  { fields: AadhaarFields; raw_text: string } | null = null;
    let visionError: string | null = null;

    if (!merged) {
      // FALLBACK — Vision DOCUMENT_TEXT_DETECTION + regex, front-wins for the
      // identity fields and back-fills for the address block.
      source = "vision";
      try {
        [frontOut, backOut] = await Promise.all([
          extractAadhaar(frontComp.output, frontComp.mime),
          extractAadhaar(backComp.output,  backComp.mime),
        ]);
      } catch (e) {
        visionError = errText(e);
        console.error("[extract-aadhaar] vision error:", visionError);
      }
      const frontFields = frontOut?.fields ?? null;
      const backFields  = backOut?.fields  ?? null;
      merged = {
        name:           frontFields?.name           ?? backFields?.name           ?? null,
        dob:            frontFields?.dob            ?? backFields?.dob            ?? null,
        gender:         frontFields?.gender         ?? backFields?.gender         ?? null,
        aadhaar_number: frontFields?.aadhaar_number ?? backFields?.aadhaar_number ?? null,
        aadhaar_masked: frontFields?.aadhaar_masked ?? backFields?.aadhaar_masked ?? null,
        care_of:        backFields?.care_of         ?? frontFields?.care_of       ?? null,
        address:        backFields?.address         ?? frontFields?.address       ?? null,
      };
    }

    // Audit trail (fire-and-forget): the Vision raw text on the fallback path,
    // or the Gemini result when it was used — so misses can be debugged without
    // re-uploading. See 0027_ocr_raw_text.sql.
    if (frontOut) saveOcrRaw(supabase, appId, "aadhaar_front", frontOut.raw_text, "[extract-aadhaar] raw-text save (front):");
    if (backOut)  saveOcrRaw(supabase, appId, "aadhaar_back",  backOut.raw_text,  "[extract-aadhaar] raw-text save (back):");
    if (source === "gemini") saveOcrRaw(supabase, appId, "aadhaar_gemini", JSON.stringify(merged), "[extract-aadhaar] gemini audit:");

    // ── face crop on front (image only) ──────────────────────
    let facePath: string | null = null;
    try {
      const face = await cropAndUploadFace(frontComp.output, frontComp.mime, appId);
      facePath = face.storage_path;
    } catch (e) {
      // Non-fatal: KYC still works without the cropped face; the front
      // upload itself is available for admin to reference.
      console.warn("[extract-aadhaar] face crop failed:", e);
    }

    // Sign the face-crop URL for immediate thumbnail display. Only the
    // face path needs a signed URL — front/back are represented by the
    // File objects still held by the browser (no round-trip needed).
    let faceSignedUrl: string | null = null;
    if (facePath) {
      try {
        faceSignedUrl = await getSignedReadUrl(facePath, 3600);
      } catch (e) {
        console.warn("[extract-aadhaar] face sign failed:", e);
      }
    }

    return NextResponse.json({
      ok: true,
      fields: merged,
      storage_paths: {
        front: frontPath,
        back:  backPath,
        face:  facePath,
      },
      face_signed_url: faceSignedUrl,
      // Diagnostics surfaced for the client + Network tab. Non-null
      // `debug_vision_error` means Vision itself broke — fields will
      // all be null; admin fills in manually. Raw text is included
      // for immediate parser tuning against real docs.
      debug_source: source,
      debug_vision_error: visionError,
      debug_raw_text_front: frontOut?.raw_text ?? null,
      debug_raw_text_back:  backOut?.raw_text  ?? null,
    });
  } catch (e) {
    const msg = errText(e);
    console.error("[extract-aadhaar] error:", msg);
    return err(msg, 500);
  }
}
