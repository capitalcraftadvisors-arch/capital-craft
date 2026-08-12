// POST /api/admin/loan-app/[id]/extract-bank-statement
//
// Multipart body:
//   file:   File   (image or PDF)
//   method: string ("manual_epdf" | "scanned_pdf")   — echoed back so the
//                                                      client stores the
//                                                      method with the doc.
//
// Server-side:
//   1. Verify admin JWT.
//   2. Confirm the loan app exists and is at current_step ≥ 4.
//   3. Compress the file with sharp (image only — PDFs pass through).
//   4. Upload to applications/{id}/bank_statement/.
//   5. Run Vision DOCUMENT_TEXT_DETECTION + parseBankStatement to pull
//      the retrieved-bank-info fields (best-effort — every field can be
//      null and the Step 4 UI lets admin fill in what OCR misses).
//   6. Return { fields, storage_path, signed_url, uploaded_at }.
//      NO DB write here — Step 4's Next button calls complete-step-4
//      with the confirmed values.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer, getSignedReadUrl } from "@/lib/gcs";
import { extractBankStatement, type BankStatementFields } from "@/lib/bank-statement";
import { geminiExtractBankStatement } from "@/lib/doc-extractors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DIMENSION = 2000;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const METHODS = new Set(["manual_epdf", "scanned_pdf"]);

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function safeName(fileName: string, fallback: string): string {
  return (fileName || fallback).replace(/[^\w.\-]+/g, "_").slice(0, 80) || fallback;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const form = await req.formData();
    const file   = form.get("file");
    const method = String(form.get("method") ?? "").trim();
    if (!(file instanceof File)) return err("Bank statement file is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);
    if (!METHODS.has(method))     return err("Invalid upload method.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select("id, current_step")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);
    if ((app.current_step ?? 1) < 4) return err("Complete Step 3 before Step 4 uploads.", 409);

    // Compress (images only) + upload.
    const ab = await file.arrayBuffer();
    const input = Buffer.from(ab);
    let output: Buffer = input;
    let mime = file.type;
    if (file.type.startsWith("image/")) {
      output = await sharp(input)
        .rotate()
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
      mime = "image/jpeg";
    }
    const path = `applications/${appId}/bank_statement/${Date.now()}_${safeName(file.name, "bank_statement")}`;
    await uploadBuffer(path, output, mime);

    // OCR — Gemini reads the statement faithfully (primary); on any failure
    // it returns null and we fall back to the Vision + regex parser. Every
    // field can still be null and the Step 4 UI lets admin fill in the rest.
    // Vision-error message flows through so we can diagnose from the client
    // Network tab / Cloud Run logs.
    let fields: BankStatementFields = {
      account_holder: null, bank_name: null, account_no: null,
      ifsc: null, account_type: null, mobile: null, email: null,
    };
    let rawText: string | null = null;
    let visionError: string | null = null;
    let source: "gemini" | "vision" = "gemini";

    const gemini = await geminiExtractBankStatement([{ buffer: output, mime }]);
    if (gemini) {
      fields = gemini;
      rawText = JSON.stringify(gemini);
    } else {
      source = "vision";
      try {
        const r = await extractBankStatement(output, mime);
        fields = r.fields;
        rawText = r.raw_text;
      } catch (e) {
        visionError = e instanceof Error ? e.message : String(e);
        console.error("[extract-bank-statement] vision error:", visionError);
      }
    }

    let signed: string | null = null;
    try { signed = await getSignedReadUrl(path, 3600); } catch { /* non-fatal */ }

    if (rawText) {
      supabase.rpc("append_ocr_raw", { app_id: appId, key_name: "bank_statement", raw_text: rawText })
        .then((r) => r.error && console.warn("[extract-bank-statement] raw-text save:", r.error.message));
    }

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
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-bank-statement] error:", msg);
    return err(msg, 500);
  }
}
