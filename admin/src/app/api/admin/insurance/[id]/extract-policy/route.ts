// POST /api/admin/insurance/[id]/extract-policy   multipart { file }
//
// Admin-only. Uploads the SBI-issued policy document to GCS
// (insurance/{id}/policy), OCRs it, and pulls the coverage period (from / to)
// via parsePolicyPeriod. Persists the path + both dates + the raw OCR text
// (policy_ocr_raw, for tuning the parser to the real layout). The returned
// dates are shown editable on the admin View so a miss is correctable.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer } from "@/lib/gcs";
import { visionDocumentText } from "@/lib/vision-server";
import { geminiExtractPolicy } from "@/lib/doc-extractors";
import {
  SUPABASE_URL, SUPABASE_ANON, compress, safeName, parsePolicyPeriod, UUID_RE, ACCEPTED,
} from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RAW_CAP = 4000;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);
    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err("Policy document is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);

    const { buf, mime } = await compress(file);
    const path = `insurance/${id}/policy/${Date.now()}_${safeName(file.name, "policy")}`;
    await uploadBuffer(path, buf, mime);

    let rawText = "";
    let from: string | null = null;
    let to: string | null = null;
    const g = await geminiExtractPolicy([{ buffer: buf, mime }]);
    if (g) {
      from = g.from; to = g.to;
      rawText = JSON.stringify(g);
    } else {
      try {
        rawText = await visionDocumentText(buf, mime);
        const p = parsePolicyPeriod(rawText || "");
        from = p.from; to = p.to;
      } catch (e) {
        console.warn("[insurance/extract-policy] vision failed:", e);
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: updErr } = await supabase
      .from("insurance_applications")
      .update({
        policy_path: path,
        policy_from_date: from,
        policy_to_date: to,
        policy_ocr_raw: (rawText || "").slice(0, RAW_CAP),
      })
      .eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true, from, to });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/extract-policy] error:", msg);
    return err(msg, 500);
  }
}
