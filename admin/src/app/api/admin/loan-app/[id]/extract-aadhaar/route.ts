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
// PRIVACY: full 12-digit Aadhaar number NEVER leaves this route's memory
// (see lib/aadhaar.ts). The response contains only the masked form.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer, getSignedReadUrl } from "@/lib/gcs";
import { extractAadhaar, cropAndUploadFace, type AadhaarFields } from "@/lib/aadhaar";

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
const ACCEPTED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// Compress an image with the same pipeline as /api/upload. PDFs pass
// through untouched. Returns { output, outputMime, originalSize }.
async function compress(file: File): Promise<{ output: Buffer; outputMime: string; originalSize: number }> {
  const ab = await file.arrayBuffer();
  const input = Buffer.from(ab);
  const originalSize = input.length;
  if (!file.type.startsWith("image/")) {
    return { output: input, outputMime: file.type, originalSize };
  }
  const output = await sharp(input)
    .rotate()
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
  return { output, outputMime: "image/jpeg", originalSize };
}

function safeName(fileName: string, fallback: string): string {
  const raw = (fileName || fallback).replace(/[^\w.\-]+/g, "_").slice(0, 80);
  return raw || fallback;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // ── auth ─────────────────────────────────────────────────
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

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
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: app, error: loadErr } = await supabase
      .from("epc_applications")
      .select("id, current_step, status")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);
    if ((app.current_step ?? 1) < 2) {
      return err("Complete Step 1 before uploading Aadhaar.", 409);
    }

    // ── compress + upload ────────────────────────────────────
    const [frontComp, backComp] = await Promise.all([compress(front), compress(back)]);

    const frontPath = `applications/${appId}/aadhaar_front/${Date.now()}_${safeName(front.name, "front")}`;
    const backPath  = `applications/${appId}/aadhaar_back/${Date.now()}_${safeName(back.name, "back")}`;

    await Promise.all([
      uploadBuffer(frontPath, frontComp.output, frontComp.outputMime),
      uploadBuffer(backPath,  backComp.output,  backComp.outputMime),
    ]);

    // ── OCR both sides ───────────────────────────────────────
    // Front carries most identity fields; back carries care_of/address.
    // Merge with front-wins for the identity fields and back-fills for
    // the address block. If Vision throws (bad key, API-not-enabled,
    // quota) the error message flows straight through to the client
    // response and to Cloud Run logs — no silent-swallow.
    let frontOut: { fields: AadhaarFields; raw_text: string } | null = null;
    let backOut:  { fields: AadhaarFields; raw_text: string } | null = null;
    let visionError: string | null = null;
    try {
      [frontOut, backOut] = await Promise.all([
        extractAadhaar(frontComp.output, frontComp.outputMime),
        extractAadhaar(backComp.output,  backComp.outputMime),
      ]);
    } catch (e) {
      visionError = e instanceof Error ? e.message : String(e);
      console.error("[extract-aadhaar] vision error:", visionError);
    }

    const frontFields = frontOut?.fields ?? null;
    const backFields  = backOut?.fields  ?? null;

    const merged: AadhaarFields = {
      name:           frontFields?.name           ?? backFields?.name           ?? null,
      dob:            frontFields?.dob            ?? backFields?.dob            ?? null,
      gender:         frontFields?.gender         ?? backFields?.gender         ?? null,
      aadhaar_masked: frontFields?.aadhaar_masked ?? backFields?.aadhaar_masked ?? null,
      care_of:        backFields?.care_of         ?? frontFields?.care_of       ?? null,
      address:        backFields?.address         ?? frontFields?.address       ?? null,
    };

    // Persist raw OCR text (both sides) so parser misses on real docs
    // can be debugged without re-uploading. Two fire-and-forget RPCs
    // for atomic jsonb || merge — see 0027_ocr_raw_text.sql.
    if (frontOut) {
      supabase.rpc("append_ocr_raw", {
        app_id: appId,
        key_name: "aadhaar_front",
        raw_text: frontOut.raw_text,
      }).then((r) => r.error && console.warn("[extract-aadhaar] raw-text save (front):", r.error.message));
    }
    if (backOut) {
      supabase.rpc("append_ocr_raw", {
        app_id: appId,
        key_name: "aadhaar_back",
        raw_text: backOut.raw_text,
      }).then((r) => r.error && console.warn("[extract-aadhaar] raw-text save (back):", r.error.message));
    }

    // ── face crop on front (image only) ──────────────────────
    let facePath: string | null = null;
    try {
      const face = await cropAndUploadFace(frontComp.output, frontComp.outputMime, appId);
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
      debug_vision_error: visionError,
      debug_raw_text_front: frontOut?.raw_text ?? null,
      debug_raw_text_back:  backOut?.raw_text  ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-aadhaar] error:", msg);
    return err(msg, 500);
  }
}
