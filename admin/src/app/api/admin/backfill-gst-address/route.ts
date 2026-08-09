// POST /api/admin/backfill-gst-address
//
// Admin-only maintenance job. Fills epc_business.gst_address for profiles that
// already have a GST registration document but a blank address, so existing
// EPCs get the same auto-filled address that new onboardings now capture.
//
// For each EPC missing a gst_address it looks up the latest `gstin` document
// and:
//   1. parses the address from the stored OCR text (epc_documents.metadata
//      .ocr_raw_text) — no external calls; OR
//   2. with { reOcr: true }, re-runs the GST OCR edge function on the stored
//      file for docs that have no cached text (needs Vision — prod only).
//
// Body: { dryRun?: boolean (default TRUE), reOcr?: boolean, limit?: number }
// Idempotent — only ever fills blanks, never overwrites an existing address.
//
// NOTE: unverifiable on the local stack (no real GST docs; edge functions are
// network-blocked locally). Run dryRun first in production, review the report,
// then run with dryRun:false (and reOcr:true to cover older docs).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { parseGstAddress } from "@/lib/gst-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const FUNCTIONS_URL =
  process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ||
  "https://hpebydmrpimyuxgsgtmu.supabase.co/functions/v1";
const DOC_BUCKET = "epc-docs";

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function guessMime(path: string): string {
  return /\.pdf$/i.test(path) ? "application/pdf"
    : /\.png$/i.test(path) ? "image/png"
    : "image/jpeg";
}

type Report = {
  id: string;
  name: string;
  outcome: "filled" | "would-fill" | "no-doc" | "no-text" | "parse-failed" | "reocr-failed";
  address?: string;
};

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);
    if (!SERVICE_KEY) return err("missing SUPABASE_SERVICE_ROLE_KEY", 500);

    const body = (await req.json().catch(() => ({}))) as {
      dryRun?: boolean; reOcr?: boolean; limit?: number;
    };
    const dryRun = body.dryRun !== false; // default DRY-RUN (safe)
    const reOcr = body.reOcr === true;
    const limit = Math.min(Number(body.limit) || 500, 2000);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Candidate EPCs (blank gst_address). Filter emptiness in JS to avoid
    // PostgREST empty-string quirks.
    const { data: epcRows, error: e1 } = await admin
      .from("epc_business")
      .select("id, trade_name, legal_name, gst_address")
      .neq("business_type", "admin")
      .limit(limit);
    if (e1) return err(e1.message, 500);
    const epcs = (epcRows ?? []).filter(
      (e) => !((e.gst_address as string | null) ?? "").trim(),
    );

    const summary = {
      dryRun, reOcr,
      candidates: epcs.length,
      filled: 0, wouldFill: 0, noDoc: 0, noText: 0, parseFailed: 0, reOcrFailed: 0,
    };
    const items: Report[] = [];

    for (const epc of epcs) {
      const name = (epc.trade_name as string) || (epc.legal_name as string) || epc.id;

      const { data: docs } = await admin
        .from("epc_documents")
        .select("id, storage_path, metadata, created_at")
        .eq("business_id", epc.id)
        .eq("category", "gstin")
        .order("created_at", { ascending: false })
        .limit(1);
      const doc = docs?.[0] as { storage_path: string | null; metadata: Record<string, unknown> | null } | undefined;
      if (!doc) { summary.noDoc++; items.push({ id: epc.id, name, outcome: "no-doc" }); continue; }

      let rawText = (doc.metadata?.ocr_raw_text as string | null) ?? null;
      let serverAddress: string | null = null;

      // Re-OCR fallback for docs that have no cached text.
      if (!rawText && reOcr && doc.storage_path) {
        try {
          const dl = await admin.storage.from(DOC_BUCKET).download(doc.storage_path);
          if (dl.data) {
            const b64 = Buffer.from(await dl.data.arrayBuffer()).toString("base64");
            const res = await fetch(`${FUNCTIONS_URL}/extract-gst-legalname`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ imageBase64: b64, mimeType: guessMime(doc.storage_path) }),
            });
            const j = (await res.json().catch(() => ({}))) as { ok?: boolean; address?: string | null; raw_text?: string | null };
            if (j?.ok) { serverAddress = j.address ?? null; rawText = j.raw_text ?? null; }
            else { summary.reOcrFailed++; items.push({ id: epc.id, name, outcome: "reocr-failed" }); continue; }
          } else { summary.reOcrFailed++; items.push({ id: epc.id, name, outcome: "reocr-failed" }); continue; }
        } catch { summary.reOcrFailed++; items.push({ id: epc.id, name, outcome: "reocr-failed" }); continue; }
      }

      if (!rawText && !serverAddress) { summary.noText++; items.push({ id: epc.id, name, outcome: "no-text" }); continue; }

      const address = serverAddress || (rawText ? parseGstAddress(rawText) : null);
      if (!address) { summary.parseFailed++; items.push({ id: epc.id, name, outcome: "parse-failed" }); continue; }

      if (dryRun) {
        summary.wouldFill++;
        items.push({ id: epc.id, name, outcome: "would-fill", address });
      } else {
        const { error: uErr } = await admin
          .from("epc_business")
          .update({ gst_address: address })
          .eq("id", epc.id);
        if (uErr) { summary.parseFailed++; items.push({ id: epc.id, name, outcome: "parse-failed" }); continue; }
        summary.filled++;
        items.push({ id: epc.id, name, outcome: "filled", address });
      }
    }

    return NextResponse.json({ ok: true, summary, items });
  } catch (e) {
    return err((e as Error)?.message ?? "backfill_failed", 500);
  }
}
