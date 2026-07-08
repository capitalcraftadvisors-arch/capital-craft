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
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer, getSignedReadUrl } from "@/lib/gcs";
import { visionDocumentText } from "@/lib/vision-server";
import { parsePanFields } from "@/lib/pan-parser";

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
    const file = form.get("file");
    if (!(file instanceof File)) return err("Co-applicant PAN file is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);

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
    // Gate relaxed to step 2 — the EPC apply flow captures co-applicant
    // docs on its Page 2 (application is at current_step=2 then).
    if ((app.current_step ?? 1) < 2) return err("Complete registration before uploads.", 409);

    // Compress + upload.
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
    const path = `applications/${appId}/coapp_pan/${Date.now()}_${safeName(file.name, "coapp_pan")}`;
    await uploadBuffer(path, output, mime);

    // OCR + parse. Vision-error message flows through to the client.
    let fields: { pan: string | null; name: string | null; father_name: string | null; dob: string | null } = {
      pan: null, name: null, father_name: null, dob: null,
    };
    let rawText: string | null = null;
    let visionError: string | null = null;
    try {
      rawText = await visionDocumentText(output, mime);
      fields = parsePanFields(rawText);
    } catch (e) {
      visionError = e instanceof Error ? e.message : String(e);
      console.error("[extract-coapp-pan] vision error:", visionError);
    }

    let signed: string | null = null;
    try { signed = await getSignedReadUrl(path, 3600); } catch { /* non-fatal */ }

    if (rawText) {
      supabase.rpc("append_ocr_raw", { app_id: appId, key_name: "coapp_pan", raw_text: rawText })
        .then((r) => r.error && console.warn("[extract-coapp-pan] raw-text save:", r.error.message));
    }

    return NextResponse.json({
      ok: true,
      fields,
      storage_path: path,
      signed_url:   signed,
      uploaded_at:  new Date().toISOString(),
      debug_vision_error: visionError,
      debug_raw_text:     rawText,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-coapp-pan] error:", msg);
    return err(msg, 500);
  }
}
