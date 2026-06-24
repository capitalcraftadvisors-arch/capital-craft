// =========================================================
// Capital Craft — `extract-gst-r3b` Edge Function
//
// POST { imageBase64, mimeType? }
//   -> {
//        ok: true,
//        gstin, legal_name, trade_name,
//        total_taxable_value,        // number, from row 3.1(a) Total taxable value
//        period,                     // free text e.g. "Jul-Sep", "August 2024"
//        raw_text                    // truncated full OCR (4000 char cap, for audit)
//      }
//   or { ok: false, error }
//
// Mirrors the pattern of `extract-cheque`:
//   - Frontend converts the file to base64 and POSTs here.
//   - We call Google Vision DOCUMENT_TEXT_DETECTION.
//   - Parsing is regex over the OCR text — best-effort, never blocks.
//   - On any failure, return { ok: false, error } and the admin UI
//     falls back to manual entry / lets the admin correct the values.
//
// Supports BOTH images (jpeg/png/webp) and PDFs (typical GSTR-3B
// is a 1-2 page PDF). PDF uses the files:annotate endpoint;
// image uses images:annotate (same as extract-cheque).
//
// Reads only one secret: GOOGLE_VISION_API_KEY (already configured
// from the cheque OCR work).
//
// IMPORTANT: this function performs NO auth check. Like extract-cheque,
// it's called from the admin UI with the file's base64. Admin-only
// enforcement happens at /api/upload (which rejects gst_r3b uploads
// from non-admins). Frontend never calls this for non-admin users.
// =========================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const VISION_API_KEY = Deno.env.get("GOOGLE_VISION_API_KEY")!;
const RAW_TEXT_CAP = 4000; // chars stored in metadata — enough for audit, not bloat

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return json({ ok: false, error: "missing_imageBase64" }, 400);
    }

    const isPdf = (mimeType ?? "").toLowerCase().includes("pdf");
    const text = isPdf
      ? await ocrPdf(imageBase64, mimeType ?? "application/pdf")
      : await ocrImage(imageBase64);

    if (!text) {
      return json({ ok: false, error: "ocr_returned_empty" });
    }

    const parsed = parseGstR3b(text);
    return json({
      ok: true,
      gstin: parsed.gstin,
      legal_name: parsed.legal_name,
      trade_name: parsed.trade_name,
      total_taxable_value: parsed.total_taxable_value,
      period: parsed.period,
      raw_text: text.slice(0, RAW_TEXT_CAP),
    });
  } catch (e) {
    console.error("[extract-gst-r3b] error:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

// ── Vision API helpers ─────────────────────────────────────────────────────

async function ocrImage(base64: string): Promise<string> {
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        }],
      }),
    },
  );
  const data = await res.json();
  if (data?.responses?.[0]?.error) {
    throw new Error("vision_image_error: " + JSON.stringify(data.responses[0].error));
  }
  return data?.responses?.[0]?.fullTextAnnotation?.text ?? "";
}

async function ocrPdf(base64: string, mimeType: string): Promise<string> {
  const res = await fetch(
    `https://vision.googleapis.com/v1/files:annotate?key=${VISION_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          inputConfig: { mimeType, content: base64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        }],
      }),
    },
  );
  const data = await res.json();
  if (data?.responses?.[0]?.error) {
    throw new Error("vision_pdf_error: " + JSON.stringify(data.responses[0].error));
  }
  // files:annotate wraps per-page responses in an inner `responses` array
  const pages: Array<{ fullTextAnnotation?: { text?: string } }> =
    data?.responses?.[0]?.responses ?? [];
  return pages.map((p) => p.fullTextAnnotation?.text ?? "").join("\n\n");
}

// ── GSTR-3B field extraction ───────────────────────────────────────────────

type Parsed = {
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  total_taxable_value: number | null;
  period: string | null;
};

function parseGstR3b(text: string): Parsed {
  return {
    gstin: matchGstin(text),
    legal_name: matchAfterLabel(
      text,
      /Legal\s+name\s+of\s+the\s+registered\s+person/i,
    ),
    trade_name: matchAfterLabel(text, /Trade\s+name(?:[\s,]+if\s+any)?/i),
    total_taxable_value: parseTotalTaxableValue(text),
    period: matchAfterLabel(text, /(?:^|\b)Period\b/i),
  };
}

// 15-char GSTIN: 2 digits + 5 letters + 4 digits + 1 letter +
// 1 alphanumeric + 'Z' + 1 alphanumeric.
function matchGstin(text: string): string | null {
  const m = text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/);
  return m ? m[0] : null;
}

// Generic "label : value" or "label\nvalue" extractor.
// Tries same-line first (after any : - or , separator), then the next
// 1-3 non-empty lines.
function matchAfterLabel(text: string, labelRe: RegExp): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;

    // Try same line: strip the label off and grab whatever's left.
    const sameLine = lines[i].replace(labelRe, "");
    const sameLineVal = sameLine.replace(/^[\s:.\-,]+/, "").trim();
    if (sameLineVal) return cap(sameLineVal);

    // Otherwise take the first non-empty line within a small window.
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const next = lines[j].trim();
      if (next) return cap(next);
    }
    return null;
  }
  return null;
}

function cap(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) : s;
}

// Extract the "Total taxable value" cell from row 3.1(a).
//
// Strategy:
//   1. Find the row by either "(a) Outward taxable supplies" or "3.1(a)".
//   2. Within the same line + next 5 lines, find the first number that
//      looks like a monetary amount (has a decimal portion).
//   3. Skip row-identifier patterns like "3.1" so we don't pick the label.
//
// OCR mangles tabular layouts in unpredictable ways — sometimes the
// columns end up on separate lines, sometimes inline. This 6-line
// window handles both. If parsing fails, the admin UI shows the field
// blank and the admin types the value manually.
function parseTotalTaxableValue(text: string): number | null {
  const lines = text.split(/\r?\n/);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (
      /\(\s*a\s*\)\s*Outward\s+taxable\s+supplies/i.test(lines[i]) ||
      /3\.1\s*\(\s*a\s*\)/i.test(lines[i])
    ) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  for (let i = startIdx; i < Math.min(startIdx + 6, lines.length); i++) {
    // Matches Indian-format (62,55,464.39), Western-format (6,255,464.39),
    // or plain decimals (6255464.39). Requires at least one decimal digit.
    const matches = [
      ...lines[i].matchAll(/\b(\d{1,3}(?:,\d{2,3})*\.\d{1,2}|\d+\.\d{1,2})\b/g),
    ];
    for (const m of matches) {
      // Skip the row identifier itself if it happens to match (e.g. "3.1").
      if (/^3\.10?$/.test(m[1])) continue;
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

// ── HTTP helper ────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
