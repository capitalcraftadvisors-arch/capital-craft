// POST /api/ocr
//
// JSON body: { type: "pan" | "gst" | "gstr3b", imageBase64: string, mimeType: string }
//
// Unified server-side OCR for the client (EPC onboarding + loan apply flows)
// that previously called the Deno Edge Functions directly. Gemini reads the
// document faithfully (PRIMARY); on ANY Gemini failure this route PROXIES the
// original request to the existing Edge Function — i.e. the exact Vision+regex
// behaviour we shipped before — so nothing can regress. Returns the SAME shape
// each client caller in lib/ocr.ts already expects, plus a `source` flag.
//
// Auth: any authenticated user (EPC or admin). No role restriction — EPCs run
// this during onboarding / apply.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { parsePanFields } from "@/lib/pan-parser";
import { parseGstAddress } from "@/lib/gst-address";
import { isValidPan, isValidGstin } from "@/lib/doc-validation";
import { geminiExtractPan, geminiExtractGst, geminiExtractGstR3b } from "@/lib/doc-extractors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FUNCTIONS_URL =
  process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ||
  "https://hpebydmrpimyuxgsgtmu.supabase.co/functions/v1";

const MAX_DIMENSION = 2000;
const TYPES = new Set(["pan", "gst", "gstr3b"]);
const EDGE: Record<string, string> = {
  pan: "extract-pan",
  gst: "extract-gst-legalname",
  gstr3b: "extract-gst-r3b",
};

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token).catch(() => null);
    if (!claims) return err("unauthorized", 401);

    const body = await req.json().catch(() => null);
    const type = String(body?.type ?? "");
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
    const mimeType = typeof body?.mimeType === "string" && body.mimeType ? body.mimeType : "image/jpeg";
    if (!TYPES.has(type)) return err("Invalid OCR type.", 400);
    if (!imageBase64) return err("imageBase64 is required.", 400);

    // Decode + compress (image only) for the Gemini call. The ORIGINAL
    // base64 is kept untouched for the Edge-Function proxy fallback so its
    // behaviour is byte-identical to today.
    const input = Buffer.from(imageBase64, "base64");
    let buffer: Buffer = input;
    let mime = mimeType;
    if (mimeType.startsWith("image/")) {
      try {
        buffer = await sharp(input)
          .rotate()
          .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 75, mozjpeg: true })
          .toBuffer();
        mime = "image/jpeg";
      } catch {
        buffer = input; // fall back to the raw bytes if sharp can't decode
      }
    }

    // ── PRIMARY: Gemini ────────────────────────────────────────────────────
    if (type === "pan") {
      const g = await geminiExtractPan([{ buffer, mime }]);
      if (g) {
        return NextResponse.json({
          ok: true, source: "gemini", raw_text: JSON.stringify(g),
          pan: g.pan, name: g.name, father_name: g.father_name, dob: g.dob,
        });
      }
    } else if (type === "gst") {
      const g = await geminiExtractGst([{ buffer, mime }]);
      if (g) {
        return NextResponse.json({
          ok: true, source: "gemini", raw_text: JSON.stringify(g),
          gstin: g.gstin, legal_name: g.legal_name, trade_name: g.trade_name, address: g.address,
        });
      }
    } else {
      const g = await geminiExtractGstR3b([{ buffer, mime }]);
      if (g) {
        return NextResponse.json({ ok: true, source: "gemini", raw_text: JSON.stringify(g), ...g });
      }
    }

    // ── FALLBACK: proxy to the existing Edge Function (today's behaviour) ───
    let edge: Record<string, unknown> | null = null;
    try {
      const res = await fetch(`${FUNCTIONS_URL}/${EDGE[type]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      edge = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch (e) {
      return err(e instanceof Error ? e.message : "ocr upstream failed", 502);
    }
    if (!edge || edge.ok === false) {
      return NextResponse.json(edge ?? { ok: false, error: "ocr_failed" });
    }

    // Post-process to the client shape (mirrors lib/ocr.ts's client enrichment).
    const rawText = typeof edge.raw_text === "string" ? edge.raw_text : "";
    if (type === "pan") {
      const parsed = parsePanFields(rawText);
      const cand = (((edge.pan as string) ?? parsed.pan) || "").toUpperCase() || null;
      return NextResponse.json({
        ok: true, source: "vision", raw_text: rawText,
        pan: isValidPan(cand) ? cand : null,
        name: parsed.name, father_name: parsed.father_name, dob: parsed.dob,
      });
    }
    if (type === "gst") {
      let address: string | null = (edge.address as string) ?? null;
      if (!address && rawText) address = parseGstAddress(rawText);
      const gstinRaw = (edge.gstin as string) ?? null;
      return NextResponse.json({
        ok: true, source: "vision", raw_text: rawText,
        gstin: gstinRaw && isValidGstin(gstinRaw) ? gstinRaw : null,
        legal_name: (edge.legal_name as string) ?? null,
        trade_name: (edge.trade_name as string) ?? null,
        address,
      });
    }
    // gstr3b — the Edge Function already returns the full shape.
    return NextResponse.json({ ...edge, source: "vision" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/ocr] error:", msg);
    return err(msg, 500);
  }
}
