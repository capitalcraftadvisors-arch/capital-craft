// Server-only plumbing shared by the document-reading routes: the loan
// application ones (/api/admin/loan-app/[id]/extract-*) and the insurance ones
// (/api/epc/insurance/[id]/extract-*). Each route keeps its own fields, checks,
// messages and database writes; only the identical steps live here.

import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { err, loadLoanRow } from "./api";
import type { JwtClaims } from "./jwt";
import { getSignedReadUrl, uploadBuffer } from "./gcs";
import { compressUpload } from "./image-compress";
import { compress } from "./insurance-server";
import { ACCEPTED, safeName } from "./upload-rules";
import type { GeminiImage } from "./gemini-extract";
import { errText } from "./errors";

// ── Loan application (epc_applications, applications/{id}/… in storage) ──────

/** The upload compression of /api/upload (images → JPEG, 2000 px, quality 75; PDFs as they are). */
export async function compressFile(file: File): Promise<{ output: Buffer; mime: string }> {
  return compressUpload(Buffer.from(await file.arrayBuffer()), file.type);
}

/** Compresses an uploaded file and stores it under applications/{appId}/{folder}/. */
export async function storeLoanFile(appId: string, folder: string, file: File, fallbackName: string): Promise<{ buffer: Buffer; mime: string; path: string }> {
  const { output, mime } = await compressFile(file);
  const path = `applications/${appId}/${folder}/${Date.now()}_${safeName(file.name, fallbackName)}`;
  await uploadBuffer(path, output, mime);
  return { buffer: output, mime, path };
}

/**
 * The loan row check before an upload: 404 when it's missing; for an EPC login,
 * 403 unless it's its own application and 409 (`beforeStep2`) while it's still
 * before step 2. Admin (the intake chat included) may upload at any step.
 * Answers the reply to send back, or null to go on.
 */
export async function checkLoanAppForUpload(
  supabase: SupabaseClient, claims: JwtClaims, appId: string, select: string, beforeStep2: string,
): Promise<NextResponse | null> {
  const app = await loadLoanRow(supabase, appId, select);
  if (app instanceof Response) return app;
  if (claims.business_type !== "admin" && app.epc_business_id !== claims.business_id) {
    return err("forbidden", 403);
  }
  if (claims.business_type !== "admin" && (app.current_step ?? 1) < 2) return err(beforeStep2, 409);
  return null;
}

type DocRead<F> = { fields: F; rawText: string | null; visionError: string | null; source: "gemini" | "vision" };

/**
 * Reads one document. PRIMARY: Gemini (never throws — null on any failure).
 * FALLBACK: Vision OCR + the regex parser (`vision`); a Vision error is logged
 * under `logLabel` and handed back (debug_vision_error) with the `empty` fields.
 * rawText = the Gemini result as JSON, or the Vision text.
 */
export async function readDoc<F>(
  doc: GeminiImage,
  empty: F,
  gemini: (images: GeminiImage[]) => Promise<F | null>,
  vision: (buffer: Buffer, mime: string) => Promise<{ fields: F; raw_text: string }>,
  logLabel: string,
): Promise<DocRead<F>> {
  const g = await gemini([doc]);
  if (g) return { fields: g, rawText: JSON.stringify(g), visionError: null, source: "gemini" };
  try {
    const r = await vision(doc.buffer, doc.mime);
    return { fields: r.fields, rawText: r.raw_text, visionError: null, source: "vision" };
  } catch (e) {
    const visionError = errText(e);
    console.error(logLabel, visionError);
    return { fields: empty, rawText: null, visionError, source: "vision" };
  }
}

/** A 1-hour read link for a stored file, or null (non-fatal). */
export async function signedUrlOrNull(path: string): Promise<string | null> {
  try { return await getSignedReadUrl(path, 3600); } catch { return null; }
}

/** Fire-and-forget: keep what was read on the loan row so misses can be debugged without re-uploading (0027_ocr_raw_text). */
export function saveOcrRaw(supabase: SupabaseClient, appId: string, key: string, rawText: string, warnLabel: string): void {
  supabase.rpc("append_ocr_raw", { app_id: appId, key_name: key, raw_text: rawText })
    .then((r) => r.error && console.warn(warnLabel, r.error.message));
}

// ── Insurance application (insurance_applications, insurance/{id}/… in storage) ──

/** The one uploaded `file` of an insurance extract route: checked, compressed and stored under insurance/{id}/{folder}/. */
export async function storeInsuranceFile(form: FormData, id: string, folder: string, missing: string):
  Promise<{ buf: Buffer; mime: string; path: string } | NextResponse> {
  const file = form.get("file");
  if (!(file instanceof File)) return err(missing, 400);
  if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);
  const { buf, mime } = await compress(file);
  const path = `insurance/${id}/${folder}/${Date.now()}_${safeName(file.name, folder)}`;
  await uploadBuffer(path, buf, mime);
  return { buf, mime, path };
}
