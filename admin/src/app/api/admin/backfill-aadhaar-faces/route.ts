// POST /api/admin/backfill-aadhaar-faces
//
// One-time maintenance: re-generate the straightened applicant-face crop for
// existing loan applications that already have an Aadhaar front on file. Fixes
// old profiles whose face was stored rotated (or missed) without anyone having
// to re-run OCR per file.
//
// Runs under the ADMIN's token (RLS: MAIN_ADMIN reads/updates all rows) and
// Google Cloud Storage via the Cloud Run service account — so it needs NO
// SUPABASE_SERVICE_ROLE_KEY. Batched: pass { after } to continue.
//
// Body: { limit?: number (1-50, default 15), after?: string (cursor id) }
// Returns: { ok, processed, fixed, noFace, failed, nextAfter, done }

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { downloadBuffer } from "@/lib/gcs";
import { cropAndUploadFace } from "@/lib/aadhaar";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function mimeFor(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const body = (await req.json().catch(() => ({}))) as { limit?: number; after?: string };
    const limit = Math.min(50, Math.max(1, Number(body.limit) || 15));
    const after = typeof body.after === "string" ? body.after : "";

    const supabase = dbAs(token);

    let query = supabase
      .from("epc_applications")
      .select("id, aadhaar_front_path")
      .not("aadhaar_front_path", "is", null)
      .order("id", { ascending: true })
      .limit(limit);
    if (after) query = query.gt("id", after);

    const { data, error } = await query;
    if (error) return err(error.message, 500);

    const rows = (data ?? []) as { id: string; aadhaar_front_path: string }[];
    let fixed = 0, noFace = 0, failed = 0;
    let lastId = after;

    for (const r of rows) {
      lastId = r.id;
      const mime = mimeFor(r.aadhaar_front_path);
      if (!mime.startsWith("image/")) { noFace++; continue; } // PDFs can't be face-cropped
      try {
        const buf = await downloadBuffer(r.aadhaar_front_path);
        const face = await cropAndUploadFace(buf, mime, r.id);
        if (face.storage_path) {
          const { error: uErr } = await supabase
            .from("epc_applications")
            .update({ aadhaar_face_path: face.storage_path })
            .eq("id", r.id);
          if (uErr) { failed++; continue; }
          fixed++;
        } else {
          noFace++;
        }
      } catch {
        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      processed: rows.length,
      fixed,
      noFace,
      failed,
      nextAfter: lastId,
      done: rows.length < limit,
    });
  } catch (e) {
    const msg = errText(e);
    console.error("[backfill-aadhaar-faces] error:", msg);
    return err(msg, 500);
  }
}
