// POST /api/admin/loan-app/[id]/extract-bank-statement
//
// Multipart body:
//   file:   File   (image or PDF)                   — a new statement, OR
//   path:   string                                  — one already on the file
//                                                      (applications/{id}/…), read again
//   method: string ("manual_epdf" | "scanned_pdf")   — echoed back so the
//                                                      client stores the
//                                                      method with the doc.
//
// Server-side:
//   1. Verify the JWT — CC, or the EPC on its own application (the partner
//      chat reads the statement as it lands). The app read is RLS-scoped.
//   2. Confirm the loan app exists.
//   3. Compress the file with sharp (image only — PDFs pass through).
//   4. Upload to applications/{id}/bank_statement/ (a `path` is read in place).
//   5. Run Vision DOCUMENT_TEXT_DETECTION + parseBankStatement to pull
//      the retrieved-bank-info fields (best-effort — every field can be
//      null and the Step 4 UI lets admin fill in what OCR misses).
//   6. Return { fields, storage_path, signed_url, uploaded_at }.
//      NO DB write here — Step 4's Next button calls complete-step-4
//      with the confirmed values.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { downloadBuffer } from "@/lib/gcs";
import { extractBankStatement, type BankStatementFields } from "@/lib/bank-statement";
import { geminiExtractBankStatement } from "@/lib/doc-extractors";
import { readDoc, saveOcrRaw, signedUrlOrNull, storeLoanFile } from "@/lib/extract-server";
import { ACCEPTED } from "@/lib/upload-rules";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const METHODS = new Set(["manual_epdf", "scanned_pdf"]);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireLogin(req); // CC or the application's own EPC — the app read below is RLS-scoped
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const form = await req.formData();
    const file   = form.get("file");
    const onFile = String(form.get("path") ?? "").trim(); // a statement already uploaded
    const method = String(form.get("method") ?? "").trim();
    if (onFile) {
      if (!onFile.startsWith(`applications/${appId}/`)) return err("That file isn't on this application.", 400);
    } else {
      if (!(file instanceof File)) return err("Bank statement file is required.", 400);
      if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);
    }
    if (!METHODS.has(method))     return err("Invalid upload method.", 400);

    const supabase = dbAs(token);
    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select("id, current_step")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);

    let output: Buffer;
    let mime: string;
    let path: string;
    if (onFile) {
      // Read the statement already on the file (e.g. the EPC uploaded it before
      // statements were read on upload) — no new copy is stored.
      try { output = await downloadBuffer(onFile); } catch { return err("Couldn't open the bank statement on file.", 404); }
      mime = /\.pdf$/i.test(onFile) ? "application/pdf" : "image/jpeg";
      path = onFile;
    } else {
      // Compress (images only) + upload.
      const stored = await storeLoanFile(appId, "bank_statement", file as File, "bank_statement");
      output = stored.buffer;
      mime = stored.mime;
      path = stored.path;
    }

    // OCR — Gemini reads the statement faithfully (primary); on any failure
    // it returns null and we fall back to the Vision + regex parser. Every
    // field can still be null and the Step 4 UI lets admin fill in the rest.
    // Vision-error message flows through so we can diagnose from the client
    // Network tab / Cloud Run logs.
    const { fields, rawText, visionError, source } = await readDoc<BankStatementFields>(
      { buffer: output, mime },
      {
        account_holder: null, bank_name: null, account_no: null,
        ifsc: null, account_type: null, mobile: null, email: null,
      },
      geminiExtractBankStatement,
      extractBankStatement,
      "[extract-bank-statement] vision error:",
    );

    const signed = await signedUrlOrNull(path);

    if (rawText) saveOcrRaw(supabase, appId, "bank_statement", rawText, "[extract-bank-statement] raw-text save:");

    return NextResponse.json({
      ok: true,
      method,
      fields,
      storage_path: path,
      signed_url:   signed,
      uploaded_at:  new Date().toISOString(),
      debug_source:       source,
      debug_vision_error: visionError,
      debug_raw_text:     rawText,
    });
  } catch (e) {
    const msg = errText(e);
    console.error("[extract-bank-statement] error:", msg);
    return err(msg, 500);
  }
}
