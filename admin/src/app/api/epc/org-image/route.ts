// /api/epc/org-image — an EPC's branding images (epc_org_profile, 0116 + 0117):
// its company logo, the authorised signature and the company stamp.
//   POST   multipart { file, kind, business_id? }  upload / replace (admin may pass business_id)
//   DELETE ?kind=&business_id=                      remove
//   GET    ?p=<kind>s/<business_id>/<ms>.png        the image itself
//
// Each image is stored as a ≤512 px PNG (transparency kept) under a new path on
// every upload, so it can be served without a login (an <img> sends no token)
// and cached by the browser for good: a new image is a new URL. Only these
// paths are served.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadBuffer, deleteObject, downloadBuffer } from "@/lib/gcs";
import { verifyJwt, getBearerToken } from "@/lib/jwt";
import { insuranceClient as userClient, UUID_RE } from "@/lib/insurance-server";
import { ORG_IMAGE_COLUMN, type OrgImageKind } from "@/lib/org-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_PATH = /^(logos|signatures|stamps)\/[0-9a-f-]{36}\/\d{10,16}\.png$/i;
const IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("p") || "";
  if (!IMAGE_PATH.test(p)) return new NextResponse("Not found", { status: 404 });
  try {
    const buf = await downloadBuffer(p);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}

// The caller's token + the business it acts on (an admin may name another one).
async function caller(req: NextRequest, requested: string | null) {
  const token = getBearerToken(req);
  if (!token) return null;
  const claims = await verifyJwt(token).catch(() => null);
  if (!claims) return null;
  const target = claims.business_type === "admin" && requested ? requested : claims.business_id;
  return UUID_RE.test(target || "") ? { db: userClient(token), target } : null;
}

const kindOf = (v: unknown): OrgImageKind | null => (v === "logo" || v === "signature" || v === "stamp" ? v : null);

async function currentPath(db: ReturnType<typeof userClient>, target: string, col: string): Promise<string | null> {
  const { data } = await db.from("epc_org_profile").select(col).eq("business_id", target).maybeSingle();
  return ((data as Record<string, string | null> | null)?.[col]) ?? null;
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const who = await caller(req, (form?.get("business_id") as string) || null);
  if (!who) return err("unauthorized", 401);
  const kind = kindOf(form?.get("kind") ?? "logo");
  if (!kind) return err("bad_kind");
  const file = form?.get("file") as File | null;
  if (!file) return err("no_file");
  if (!IMAGES.has(file.type)) return err("Upload a JPG, PNG or WEBP image.");

  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await file.arrayBuffer())).rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return err("Couldn't read this image.");
  }

  const col = ORG_IMAGE_COLUMN[kind];
  const old = await currentPath(who.db, who.target, col);
  const path = `${kind}s/${who.target}/${Date.now()}.png`;
  await uploadBuffer(path, png, "image/png");
  const { error } = await who.db.from("epc_org_profile")
    .upsert({ business_id: who.target, [col]: path, updated_at: new Date().toISOString() });
  if (error) {
    await deleteObject(path).catch(() => {});
    return err("Couldn't save the image.", 500);
  }
  if (old) await deleteObject(old).catch(() => {});
  return NextResponse.json({ ok: true, path });
}

export async function DELETE(req: NextRequest) {
  const who = await caller(req, req.nextUrl.searchParams.get("business_id"));
  if (!who) return err("unauthorized", 401);
  const kind = kindOf(req.nextUrl.searchParams.get("kind") ?? "logo");
  if (!kind) return err("bad_kind");
  const col = ORG_IMAGE_COLUMN[kind];
  const old = await currentPath(who.db, who.target, col);
  const { error } = await who.db.from("epc_org_profile")
    .update({ [col]: null, updated_at: new Date().toISOString() }).eq("business_id", who.target);
  if (error) return err("Couldn't remove the image.", 500);
  if (old) await deleteObject(old).catch(() => {});
  return NextResponse.json({ ok: true });
}
