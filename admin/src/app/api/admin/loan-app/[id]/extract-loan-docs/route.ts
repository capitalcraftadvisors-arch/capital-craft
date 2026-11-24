// POST /api/admin/loan-app/[id]/extract-loan-docs
//
// Multipart body — either or both:
//   proforma?: File  (image/PDF)  → parsed for total_project_cost + project_size
//   ebill?:    File  (image/PDF)  → parsed for bill amount, DISCOM, CA no,
//                                    pincode, address, name
//
// The Step 3 page calls this route ONCE per upload — proforma-only on
// the first pass, ebill-only on the second. Server compresses (sharp,
// same pipeline as /api/upload), uploads to GCS under
// applications/{id}/loan_docs/, runs Vision + parser, and returns the
// extracted fields + signed read URLs. No DB write here — the Step 3
// page shows the fields for review and calls complete-step-3 to persist.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { extractProforma, extractEbill, type ProformaFields, type EbillFields } from "@/lib/loan-docs";
import { geminiExtractProforma, geminiExtractEbill } from "@/lib/doc-extractors";
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
    const proforma = form.get("proforma");
    const ebill    = form.get("ebill");
    const proformaFile = proforma instanceof File ? proforma : null;
    const ebillFile    = ebill    instanceof File ? ebill    : null;
    if (!proformaFile && !ebillFile) {
      return err("At least one file (proforma or ebill) is required.", 400);
    }
    if (proformaFile && !ACCEPTED.has(proformaFile.type)) return err("Proforma must be JPEG, PNG, WebP, or PDF.", 400);
    if (ebillFile    && !ACCEPTED.has(ebillFile.type))    return err("E-bill must be JPEG, PNG, WebP, or PDF.", 400);

    // Row check. Gate relaxed to step 2 — the EPC apply flow uploads the
    // e-bill on its Page 2 (application is at current_step=2 then).
    const supabase = dbAs(token);
    const blocked = await checkLoanAppForUpload(supabase, claims, appId, "id, current_step, epc_business_id", "Complete registration before uploads.");
    if (blocked) return blocked;

    // Handle each side independently. If either OCR fails we still keep
    // the upload — admin can fill fields in by hand.
    let proformaOut: {
      fields: ProformaFields;
      storage_path: string;
      signed_url: string | null;
      uploaded_at: string;
    } | null = null;

    let ebillOut: {
      fields: EbillFields;
      storage_path: string;
      signed_url: string | null;
      uploaded_at: string;
    } | null = null;

    // Vision-error surfaces the actual API error message (bad key,
    // API-not-enabled, quota) to the client + Cloud Run logs.
    let visionError: string | null = null;
    let proformaRaw: string | null = null;
    let ebillRaw:    string | null = null;

    if (proformaFile) {
      const { buffer, mime, path } = await storeLoanFile(appId, "loan_docs/proforma", proformaFile, "proforma");
      const r = await readDoc<ProformaFields>(
        { buffer, mime },
        { total_project_cost: null, project_size: null, project_size_unit: null },
        geminiExtractProforma,
        extractProforma,
        "[extract-loan-docs] proforma vision error:",
      );
      proformaRaw = r.rawText;
      visionError = r.visionError ?? visionError;
      const signed = await signedUrlOrNull(path);
      proformaOut = { fields: r.fields, storage_path: path, signed_url: signed, uploaded_at: new Date().toISOString() };

      if (proformaRaw) saveOcrRaw(supabase, appId, "proforma", proformaRaw, "[extract-loan-docs] raw-text save (proforma):");
    }

    if (ebillFile) {
      const { buffer, mime, path } = await storeLoanFile(appId, "loan_docs/ebill", ebillFile, "ebill");
      const r = await readDoc<EbillFields>(
        { buffer, mime },
        {
          monthly_bill_amount: null, discom_name: null, ca_number: null,
          pincode: null, ebill_address_line: null, ebill_name: null,
        },
        geminiExtractEbill,
        extractEbill,
        "[extract-loan-docs] ebill vision error:",
      );
      ebillRaw = r.rawText;
      visionError = r.visionError ?? visionError;
      const signed = await signedUrlOrNull(path);
      ebillOut = { fields: r.fields, storage_path: path, signed_url: signed, uploaded_at: new Date().toISOString() };

      if (ebillRaw) saveOcrRaw(supabase, appId, "ebill", ebillRaw, "[extract-loan-docs] raw-text save (ebill):");
    }

    return NextResponse.json({
      ok: true,
      proforma: proformaOut,
      ebill:    ebillOut,
      debug_vision_error:    visionError,
      debug_raw_text_proforma: proformaRaw,
      debug_raw_text_ebill:    ebillRaw,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-loan-docs] error:", msg);
    return err(msg, 500);
  }
}
