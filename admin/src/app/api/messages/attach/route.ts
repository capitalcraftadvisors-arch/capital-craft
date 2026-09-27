// POST /api/messages/attach — upload one photo/PDF for a "Message to EPC"
// thread. Type-agnostic across loan + insurance: files land in GCS under
// messages/<kind>/<parentId>/… (never in the document lists), and the caller
// must be able to see the parent profile (admin = all, EPC = own). Returns the
// stored path; the client puts it in the message's `attachments` array.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { uploadBuffer } from "@/lib/gcs";
import { getBearerToken, verifyJwt } from "@/lib/jwt";

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
const PARENT = { loan: "epc_applications", insurance: "insurance_applications" } as const;

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    await verifyJwt(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const kind = String(form.get("kind") ?? "") as keyof typeof PARENT;
    const parentId = String(form.get("id") ?? "");
    if (!file) return err("no_file");
    if (!ACCEPTED.has(file.type)) return err("unsupported_file_type");
    if (!PARENT[kind]) return err("bad_kind");
    if (!UUID_RE.test(parentId)) return err("bad_id");

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Ownership: the parent row is only visible under RLS to the admin (all) or
    // the owning EPC — a missing row means "not yours".
    const { data: parent } = await supabase.from(PARENT[kind]).select("id").eq("id", parentId).maybeSingle();
    if (!parent) return err("forbidden", 403);

    const ab = await file.arrayBuffer();
    const input = Buffer.from(ab);
    let output: Buffer = input;
    let outMime: string = file.type;
    if (file.type.startsWith("image/")) {
      output = await sharp(input).rotate()
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75, mozjpeg: true }).toBuffer();
      outMime = "image/jpeg";
    }

    const safeName = (file.name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 80);
    const path = `messages/${kind}/${parentId}/${crypto.randomUUID()}_${safeName}`;
    await uploadBuffer(path, output, outMime);

    return NextResponse.json({ ok: true, path, name: file.name || safeName, mime: outMime });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[messages/attach] error:", msg);
    return err(msg, 500);
  }
}
