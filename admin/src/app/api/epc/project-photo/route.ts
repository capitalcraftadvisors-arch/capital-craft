// Site photos of a project (epc_projects.photos, 0128) — Partner Portal v2.
//   GET    ?project=<id>              → { ok, photos: [{ path, at, url }] }  (1-hour links)
//   POST   multipart { project, file } → { ok, photos }  compressed, kept in the private bucket
//   DELETE ?project=<id>&path=<path>  → { ok, photos }
// Everything goes through the caller's token: the project rules (RLS + the 0128
// trigger) decide who may see it or change its photos — Site staff only their own.

import { NextRequest, NextResponse } from "next/server";
import { verifyJwt, getBearerToken } from "@/lib/jwt";
import { insuranceClient as userClient, UUID_RE } from "@/lib/insurance-server";
import { uploadBuffer, deleteObject, getSignedReadUrl } from "@/lib/gcs";
import { compressUpload } from "@/lib/image-compress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Photo = { path: string; at: string };
const IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
async function caller(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token || !(await verifyJwt(token).catch(() => null))) return null;
  return userClient(token);
}
const withLinks = async (photos: Photo[]) =>
  Promise.all(photos.map(async (p) => ({ ...p, url: await getSignedReadUrl(p.path, 3600).catch(() => "") })));
// The database's refusals (0128 trigger / RLS) in plain words.
const refusal = (m: string) => (/site_staff_limit|row-level|42501/.test(m) ? "You don't have access to change this project." : m);

export async function GET(req: NextRequest) {
  const db = await caller(req);
  if (!db) return err("unauthorized", 401);
  const id = req.nextUrl.searchParams.get("project") || "";
  if (!UUID_RE.test(id)) return err("not_found", 404);
  const { data } = await db.from("epc_projects").select("photos").eq("id", id).maybeSingle();
  if (!data) return err("not_found", 404);
  return NextResponse.json({ ok: true, photos: await withLinks((data.photos ?? []) as Photo[]) });
}

export async function POST(req: NextRequest) {
  const db = await caller(req);
  if (!db) return err("unauthorized", 401);
  const form = await req.formData();
  const id = String(form.get("project") || "");
  const file = form.get("file") as File | null;
  if (!UUID_RE.test(id)) return err("not_found", 404);
  if (!file || !IMAGES.has(file.type)) return err("Choose a photo (JPG or PNG).");
  const { data: p } = await db.from("epc_projects").select("business_id").eq("id", id).maybeSingle();
  if (!p) return err("not_found", 404);

  const { output, mime } = await compressUpload(Buffer.from(await file.arrayBuffer()), file.type);
  const path = `projects/${p.business_id}/${id}/${crypto.randomUUID()}.jpg`;
  await uploadBuffer(path, output, mime);
  const { data, error } = await db.rpc("epc_project_add_photo", { p_project: id, p_path: path });
  if (error || !data) {
    await deleteObject(path);
    return err(refusal(error?.message || "You don't have access to change this project."), 403);
  }
  return NextResponse.json({ ok: true, photos: await withLinks(data as Photo[]) });
}

export async function DELETE(req: NextRequest) {
  const db = await caller(req);
  if (!db) return err("unauthorized", 401);
  const id = req.nextUrl.searchParams.get("project") || "";
  const path = req.nextUrl.searchParams.get("path") || "";
  if (!UUID_RE.test(id)) return err("not_found", 404);
  // Only a photo of THIS project (as the caller may read it) is ever removed from the bucket.
  const { data: p } = await db.from("epc_projects").select("photos").eq("id", id).maybeSingle();
  if (!p || !((p.photos ?? []) as Photo[]).some((x) => x.path === path)) return err("not_found", 404);
  const { data, error } = await db.rpc("epc_project_remove_photo", { p_project: id, p_path: path });
  if (error || !data) return err(refusal(error?.message || "You don't have access to change this project."), 403);
  await deleteObject(path);
  return NextResponse.json({ ok: true, photos: await withLinks(data as Photo[]) });
}
