// POST /api/admin/loan-app/[id]/extract-coapp-pan
//
// Multipart body: file: File (image/PDF)
//
// Compresses the PAN card (sharp), uploads to
// applications/{id}/coapp_pan/, runs Vision OCR, parses name/father/dob/pan
// via the same lib/pan-parser used by Page 1's client-side extractPan.
//
// No DB write here — the Step 3 page shows the fields for review + edit
// and calls complete-step-3 to persist.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { visionDocumentText } from "@/lib/vision-server";
import { parsePanFields, type PanFields } from "@/lib/pan-parser";
import { geminiExtractPan } from "@/lib/doc-extractors";
import { checkLoanAppForUpload, readDoc, saveOcrRaw, signedUrlOrNull, storeLoanFile } from "@/lib/extract-server";
import { ACCEPTED } from "@/lib/upload-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // Admin, or the EPC that owns this application (ownership checked
    // against the loaded row below).
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err("Co-applicant PAN file is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);

    const supabase = dbAs(token);
    // Gate relaxed to step 2 — the EPC apply flow captures co-applicant
    // docs on its Page 2 (application is at current_step=2 then).
    const blocked = await checkLoanAppForUpload(supabase, claims, appId, "id, current_step, epc_business_id", "Complete registration before uploads.");
    if (blocked) return blocked;

    // Compress + upload.
    // The chatbot reuses this route for the APPLICANT's PAN (applicant=1). File
    // it under a matching folder and, below, register a borrower_pan doc row.
    const isApplicant = String(form.get("applicant") ?? "") === "1";
    const folder = isApplicant ? "borrower_pan" : "coapp_pan";
    const { buffer: output, mime, path } = await storeLoanFile(appId, folder, file, folder);

    // Applicant PAN has no path column on epc_applications — the profile shows
    // it from a user_application_docs row (category "borrower_pan"), exactly as
    // the classic Step-1 upload does. Mirror that here so chatbot-built profiles
    // aren't missing the Applicant PAN card. (Co-applicant PAN uses the
    // coapp_pan_path column instead, so it needs no row.) Best-effort.
    // Insert the new row FIRST, then drop the older ones — a failed insert
    // must never leave the applicant without a PAN row.
    if (isApplicant) {
      const { error: docErr } = await supabase.from("user_application_docs").insert({
        application_id: appId, category: "borrower_pan", storage_path: path,
        file_name: file.name, mime_type: mime, uploaded_by: "admin",
      });
      if (docErr) console.warn("[extract-coapp-pan] applicant PAN doc row:", docErr.message);
      else await supabase.from("user_application_docs").delete().eq("application_id", appId).eq("category", "borrower_pan").neq("storage_path", path);
    }

    // OCR + parse. Gemini reads the PAN faithfully (primary); on any failure
    // it returns null and we fall back to Vision + regex. Vision-error message
    // flows through to the client.
    const { fields, rawText, visionError, source } = await readDoc<PanFields>(
      { buffer: output, mime },
      { pan: null, name: null, father_name: null, dob: null },
      geminiExtractPan,
      async (buf, m) => { const raw_text = await visionDocumentText(buf, m); return { fields: parsePanFields(raw_text), raw_text }; },
      "[extract-coapp-pan] vision error:",
    );

    const signed = await signedUrlOrNull(path);

    if (rawText) saveOcrRaw(supabase, appId, "coapp_pan", rawText, "[extract-coapp-pan] raw-text save:");

    return NextResponse.json({
      ok: true,
      fields,
      storage_path: path,
      signed_url:   signed,
      uploaded_at:  new Date().toISOString(),
      debug_source:       source,
      debug_vision_error: visionError,
      debug_raw_text:     rawText,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-coapp-pan] error:", msg);
    return err(msg, 500);
  }
}
