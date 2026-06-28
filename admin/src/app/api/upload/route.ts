// POST /api/upload — accepts a multipart file + metadata, writes to GCS,
// inserts the doc row in Supabase using the user's JWT (so RLS still enforces
// access). Same compression as before: images resized to 2000px longest side,
// JPEG quality 75; PDFs pass through unchanged.
//
// Admin-only features:
//   - replace=true  → before insert, delete the existing same-category row
//     (and its GCS object) for this business/stakeholder/application.
//     Lets admin overwrite a doc that hits a per-category unique index
//     (pan_business, gstin, cancelled_cheque, stakeholder_pan).
//   - business_id form field → admin acts on behalf of a different EPC.
//
// Audit: every successful epc_documents change writes one admin_edit_log
// row (doc_upload or doc_replace).

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { uploadBuffer, deleteObject } from "@/lib/gcs";
import { verifyJwt, getBearerToken, type JwtClaims } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const MAX_DIMENSION = 2000;
const ACCEPTED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type AllowedTable = "epc_documents" | "user_application_docs";

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    // ── auth ───────────────────────────────────────────────────────────
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── parse multipart ────────────────────────────────────────────────
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return err("no_file");
    if (!ACCEPTED.has(file.type)) return err("unsupported_file_type");

    const table = (form.get("table") as string) || "";
    const category = (form.get("category") as string) || "";
    if (!table || !category) return err("missing_table_or_category");
    if (table !== "epc_documents" && table !== "user_application_docs") {
      return err("bad_table");
    }
    const allowedTable = table as AllowedTable;

    // Admin-only category gate (gst_r3b).
    if (category === "gst_r3b" && claims.business_type !== "admin") {
      return err("admin_only", 403);
    }

    const stakeholderId = (form.get("stakeholder_id") as string) || null;
    const applicationId = (form.get("application_id") as string) || null;
    const uploadedBy = (form.get("uploaded_by") as string) || null;
    const gpsRaw = (form.get("gps") as string) || null;
    let gps: { lat: number; lng: number; captured_at: string } | null = null;
    if (gpsRaw) {
      try { gps = JSON.parse(gpsRaw); } catch { gps = null; }
    }

    const extraMetaRaw = (form.get("extraMetadata") as string) || null;
    let extraMetadata: Record<string, unknown> | null = null;
    if (extraMetaRaw) {
      try { extraMetadata = JSON.parse(extraMetaRaw); } catch { extraMetadata = null; }
    }

    // ── target business (admin-on-behalf) ─────────────────────────────
    const requestedBusinessId = (form.get("business_id") as string) || null;
    const targetBusinessId =
      claims.business_type === "admin" && requestedBusinessId
        ? requestedBusinessId
        : claims.business_id;

    if (allowedTable === "user_application_docs" && !applicationId) {
      return err("missing_application_id");
    }

    // ── replace=true: admin-only delete-existing-then-insert ──────────
    const replaceFlag = (form.get("replace") as string) === "true";
    if (replaceFlag && claims.business_type !== "admin") {
      return err("admin_only_replace", 403);
    }

    if (replaceFlag) {
      let q = supabase.from(allowedTable).select("id, storage_path").eq("category", category);
      if (allowedTable === "epc_documents") {
        q = q.eq("business_id", targetBusinessId);
        q = stakeholderId
          ? q.eq("stakeholder_id", stakeholderId)
          : q.is("stakeholder_id", null);
      } else {
        q = q.eq("application_id", applicationId);
      }
      const { data: existing } = await q;
      if (existing && existing.length > 0) {
        for (const e of existing as { id: string; storage_path: string }[]) {
          await deleteObject(e.storage_path);
          await supabase.from(allowedTable).delete().eq("id", e.id);
        }
      }
    }

    // ── path ───────────────────────────────────────────────────────────
    const docUuid = crypto.randomUUID();
    const safeFileName = (file.name || "doc")
      .replace(/[^\w.\-]+/g, "_")
      .slice(0, 80);

    let finalPath: string;
    if (allowedTable === "epc_documents") {
      finalPath = stakeholderId
        ? `${targetBusinessId}/${stakeholderId}/${category}/${docUuid}_${safeFileName}`
        : `${targetBusinessId}/${category}/${docUuid}_${safeFileName}`;
    } else {
      finalPath = `applications/${applicationId}/${category}/${docUuid}_${safeFileName}`;
    }

    // ── read + compress ────────────────────────────────────────────────
    const ab = await file.arrayBuffer();
    const input = Buffer.from(ab);
    const originalSize = input.length;

    let output: Buffer = input;
    let outMime: string = file.type;

    if (file.type.startsWith("image/")) {
      const pipeline = sharp(input).rotate();
      output = await pipeline
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
      outMime = "image/jpeg";
    }

    // ── upload to GCS ──────────────────────────────────────────────────
    await uploadBuffer(finalPath, output, outMime);

    // ── insert doc row ─────────────────────────────────────────────────
    const mergedMeta: Record<string, unknown> = {};
    if (gps) mergedMeta.gps = gps;
    if (extraMetadata) Object.assign(mergedMeta, extraMetadata);

    const row: Record<string, unknown> = {
      category,
      storage_path: finalPath,
      file_name: file.name,
      mime_type: outMime,
      original_size_bytes: originalSize,
      stored_size_bytes: output.length,
      metadata: Object.keys(mergedMeta).length > 0 ? mergedMeta : null,
    };
    if (allowedTable === "epc_documents") {
      row.business_id = targetBusinessId;
      if (stakeholderId) row.stakeholder_id = stakeholderId;
    } else {
      row.application_id = applicationId;
      row.uploaded_by =
        uploadedBy ?? (claims.business_type === "admin" ? "admin" : "epc");
    }

    const { data: inserted, error: insertErr } = await supabase
      .from(allowedTable)
      .insert(row)
      .select("id, storage_path, mime_type, file_name")
      .single();

    if (insertErr || !inserted) {
      await deleteObject(finalPath);
      return err(insertErr?.message || "db_insert_failed", 403);
    }

    // ── audit (epc_documents only; loan docs have status_history) ─────
    if (allowedTable === "epc_documents") {
      await writeAudit(supabase, claims, {
        business_id: targetBusinessId,
        action: replaceFlag ? "doc_replace" : "doc_upload",
        field: category,
      });
    }

    console.log(
      `[upload] ${file.type} → ${outMime} | original=${originalSize}B stored=${output.length}B reduction=${(
        ((originalSize - output.length) / Math.max(1, originalSize)) * 100
      ).toFixed(1)}% path=${finalPath} replace=${replaceFlag}`,
    );

    return NextResponse.json({
      ok: true,
      id: (inserted as { id: string }).id,
      storage_path: finalPath,
      mime_type: outMime,
      original_size_bytes: originalSize,
      stored_size_bytes: output.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Best-effort audit write. Failure logs but does not block the upload.
async function writeAudit(
  supabase: SupabaseClient,
  claims: JwtClaims,
  row: { business_id: string; action: string; field?: string; old_value?: string | null; new_value?: string | null },
) {
  try {
    await supabase.from("admin_edit_log").insert({
      business_id: row.business_id,
      actor: claims.business_type === "admin" ? "admin" : "epc",
      actor_id: claims.business_id,
      action: row.action,
      field: row.field ?? null,
      old_value: row.old_value ?? null,
      new_value: row.new_value ?? null,
    });
  } catch (e) {
    console.warn("[upload] audit insert failed:", e);
  }
}
