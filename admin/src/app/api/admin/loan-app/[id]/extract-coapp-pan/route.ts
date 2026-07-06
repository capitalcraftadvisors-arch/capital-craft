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
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

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
      .select("id, current_step")
      .eq("id", appId)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app)    return err("Loan application not found.", 404);
    if ((app.current_step ?? 1) < 3) return err("Complete Step 2 before Step 3 uploads.", 409);

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

    // OCR + parse.
    let fields: { pan: string | null; name: string | null; father_name: string | null; dob: string | null } = {
      pan: null, name: null, father_name: null, dob: null,
    };
    try {
      const text = await visionDocumentText(output, mime);
      fields = parsePanFields(text);
    } catch (e) {
      console.warn("[extract-coapp-pan] OCR failed:", e);
    }

    let signed: string | null = null;
    try { signed = await getSignedReadUrl(path, 3600); } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      fields,
      storage_path: path,
      signed_url:   signed,
      uploaded_at:  new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-coapp-pan] error:", msg);
    return err(msg, 500);
  }
}
