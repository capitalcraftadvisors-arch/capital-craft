// POST /api/messages/attach — upload one photo/PDF for a "Message to EPC"
// thread. Type-agnostic across loan + insurance: files land in GCS under
// messages/<kind>/<parentId>/… (never in the document lists), and the caller
// must be able to see the parent profile (admin = all, EPC = own). Returns the
// stored path; the client puts it in the message's `attachments` array.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadBuffer } from "@/lib/gcs";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DIMENSION = 2000;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const PARENT = { loan: "epc_applications", insurance: "insurance_applications" } as const;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const kind = String(form.get("kind") ?? "") as keyof typeof PARENT;
    const parentId = String(form.get("id") ?? "");
    if (!file) return err("no_file");
    if (!ACCEPTED.has(file.type)) return err("unsupported_file_type");
    if (!PARENT[kind]) return err("bad_kind");
    if (!UUID_RE.test(parentId)) return err("bad_id");

    const supabase = dbAs(token);
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
