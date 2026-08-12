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
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer, getSignedReadUrl } from "@/lib/gcs";
import { extractProforma, extractEbill, type ProformaFields, type EbillFields } from "@/lib/loan-docs";
import { geminiExtractProforma, geminiExtractEbill } from "@/lib/doc-extractors";

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

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function compress(file: File): Promise<{ buffer: Buffer; mime: string }> {
  const ab = await file.arrayBuffer();
  const input = Buffer.from(ab);
  if (!file.type.startsWith("image/")) return { buffer: input, mime: file.type };
  const output = await sharp(input)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
  return { buffer: output, mime: "image/jpeg" };
}

function safeName(fileName: string, fallback: string): string {
  return (fileName || fallback).replace(/[^\w.\-]+/g, "_").slice(0, 80) || fallback;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // Admin, or the EPC that owns this application (ownership checked
    // against the loaded row below).
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);

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

    // Row check.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select("id, current_step, epc_business_id")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);
    if (claims.business_type !== "admin" && app.epc_business_id !== claims.business_id) {
      return err("forbidden", 403);
    }
    // Gate relaxed to step 2 — the EPC apply flow uploads the e-bill on
    // its Page 2 (application is at current_step=2 then).
    if ((app.current_step ?? 1) < 2) return err("Complete registration before uploads.", 409);

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
      const { buffer, mime } = await compress(proformaFile);
      const path = `applications/${appId}/loan_docs/proforma/${Date.now()}_${safeName(proformaFile.name, "proforma")}`;
      await uploadBuffer(path, buffer, mime);
      let fields: ProformaFields = { total_project_cost: null, project_size: null, project_size_unit: null };
      const gProforma = await geminiExtractProforma([{ buffer, mime }]);
      if (gProforma) {
        fields = gProforma;
        proformaRaw = JSON.stringify(gProforma);
      } else {
        try {
          const r = await extractProforma(buffer, mime);
          fields = r.fields;
          proformaRaw = r.raw_text;
        } catch (e) {
          visionError = e instanceof Error ? e.message : String(e);
          console.error("[extract-loan-docs] proforma vision error:", visionError);
        }
      }
      let signed: string | null = null;
      try { signed = await getSignedReadUrl(path, 3600); } catch { /* non-fatal */ }
      proformaOut = { fields, storage_path: path, signed_url: signed, uploaded_at: new Date().toISOString() };

      if (proformaRaw) {
        supabase.rpc("append_ocr_raw", { app_id: appId, key_name: "proforma", raw_text: proformaRaw })
          .then((r) => r.error && console.warn("[extract-loan-docs] raw-text save (proforma):", r.error.message));
      }
    }

    if (ebillFile) {
      const { buffer, mime } = await compress(ebillFile);
      const path = `applications/${appId}/loan_docs/ebill/${Date.now()}_${safeName(ebillFile.name, "ebill")}`;
      await uploadBuffer(path, buffer, mime);
      let fields: EbillFields = {
        monthly_bill_amount: null, discom_name: null, ca_number: null,
        pincode: null, ebill_address_line: null, ebill_name: null,
      };
      const gEbill = await geminiExtractEbill([{ buffer, mime }]);
      if (gEbill) {
        fields = gEbill;
        ebillRaw = JSON.stringify(gEbill);
      } else {
        try {
          const r = await extractEbill(buffer, mime);
          fields = r.fields;
          ebillRaw = r.raw_text;
        } catch (e) {
          visionError = e instanceof Error ? e.message : String(e);
          console.error("[extract-loan-docs] ebill vision error:", visionError);
        }
      }
      let signed: string | null = null;
      try { signed = await getSignedReadUrl(path, 3600); } catch { /* non-fatal */ }
      ebillOut = { fields, storage_path: path, signed_url: signed, uploaded_at: new Date().toISOString() };

      if (ebillRaw) {
        supabase.rpc("append_ocr_raw", { app_id: appId, key_name: "ebill", raw_text: ebillRaw })
          .then((r) => r.error && console.warn("[extract-loan-docs] raw-text save (ebill):", r.error.message));
      }
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
