// =========================================================
// Capital Craft — `extract-gst-legalname` Edge Function
//
// POST { imageBase64, mimeType? }
//   -> { ok: true, gstin, legal_name, trade_name, raw_text }
//   or { ok: false, error }
//
// Purpose: pull Legal Name + Trade Name from a GST REGISTRATION
// document (Form GST REG-06, the issued certificate). Distinct
// from `extract-gst-r3b` which parses GSTR-3B RETURNS. Different
// label conventions (this one is "Legal Name of Business").
//
// Image + PDF supported via the same dispatch pattern as the
// other OCR functions.
//
// Parsing strategy:
//   1. Try in-place label matchers, primary then fallback:
//      - "Legal Name of Business"        (GST REG-06 standard)
//      - "Legal name of the registered person"  (GSTR-3B phrasing,
//        sometimes also on certs)
//   2. If either returns null or a label/prefix scrap, fall back
//      to columnar-layout reading: find the line that IS the
//      GSTIN value, walk forward, take the next 2 plausible
//      value lines as legal_name + trade_name.
//
// No auth check — same convention as the other OCR functions.
// Admin-only enforcement is at /api/upload (gst_r3b) and at the
// page level (admin pages gated by AuthGuard).
// =========================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const VISION_API_KEY = Deno.env.get("GOOGLE_VISION_API_KEY")!;
const RAW_TEXT_CAP = 4000;

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

    if (!text) return json({ ok: false, error: "ocr_returned_empty" });

    const gstin = matchGstin(text);

    // Step 1: in-place label matchers. Try primary then fallback.
    let legal_name = matchAfterFormLabel(text, /Legal\s+Name\s+of\s+Business/i)
                  ?? matchAfterFormLabel(text, /Legal\s+name\s+of\s+the\s+registered\s+person/i);
    let trade_name = matchAfterFormLabel(text, /Trade\s+Name(?:\s*\(\s*if\s+any\s*\))?/i)
                  ?? matchAfterFormLabel(text, /Trade\s+name(?:[\s,]+if\s+any)?/i);

    // Step 2: columnar fallback if either is null or label-ish.
    if (!legal_name || isLabelOrPrefix(legal_name) ||
        !trade_name || isLabelOrPrefix(trade_name)) {
      const fb = parseColumnarHeader(text, gstin);
      if (!legal_name || isLabelOrPrefix(legal_name)) legal_name = fb.legal_name;
      if (!trade_name || isLabelOrPrefix(trade_name)) trade_name = fb.trade_name;
    }

    return json({
      ok: true,
      gstin,
      legal_name,
      trade_name,
      raw_text: text.slice(0, RAW_TEXT_CAP),
    });
  } catch (e) {
    console.error("[extract-gst-legalname] error:", e);
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
  const pages: Array<{ fullTextAnnotation?: { text?: string } }> =
    data?.responses?.[0]?.responses ?? [];
  return pages.map((p) => p.fullTextAnnotation?.text ?? "").join("\n\n");
}

// ── Parsers ────────────────────────────────────────────────────────────────

function matchGstin(text: string): string | null {
  const m = text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/);
  return m ? m[0] : null;
}

const SECTION_PREFIX_RE =
  /^\s*\d+(?:\.\d+)?\s*\(\s*[a-z]\s*\)\s*\.?\s*/i;
const SECTION_PREFIX_ONLY_RE =
  /^\s*\d+(?:\.\d+)?\s*\(\s*[a-z]\s*\)\s*\.?\s*$/i;

function stripSectionPrefix(s: string): string {
  return s.replace(SECTION_PREFIX_RE, "").trim();
}
function isJustSectionPrefix(s: string): boolean {
  return SECTION_PREFIX_ONLY_RE.test(s);
}

// Lines that look like another GST-doc label (used to stop the search window).
const OTHER_FORM_LABEL_RE =
  /^(?:\s*\d+(?:\.\d+)?\s*\(\s*[a-z]\s*\)\s*\.?\s*)?(?:Legal\s+Name|Trade\s+Name|GSTIN|Period|(?:Financial\s+)?Year|Status|ARN|Constitution|Date\s+of\s+(?:Registration|filing|liability)|Address|Type\s+of\s+Registration)\b/i;

function isOtherFormLabel(s: string, currentLabelRe: RegExp): boolean {
  if (!OTHER_FORM_LABEL_RE.test(s)) return false;
  return !currentLabelRe.test(s);
}

function isLabelOrPrefix(s: string | null): boolean {
  if (!s) return false;
  if (isJustSectionPrefix(s)) return true;
  if (OTHER_FORM_LABEL_RE.test(s)) return true;
  return false;
}

function cap(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) : s;
}

// In-place "label : value" / "label\nvalue" matcher with prefix-aware
// cleanup. Same pattern as extract-gst-r3b's matchAfterFormLabel.
function matchAfterFormLabel(text: string, labelRe: RegExp): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;

    // Same line first.
    const sameLineRemainder = lines[i].replace(labelRe, "");
    const trimmed = sameLineRemainder.replace(/^[\s:.\-,]+/, "").trim();
    const sameLineVal = stripSectionPrefix(trimmed);
    if (sameLineVal) return cap(sameLineVal);

    // Forward window.
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const raw = lines[j].trim();
      if (!raw) continue;
      if (isJustSectionPrefix(raw)) continue;
      if (labelRe.test(raw)) continue;            // skip duplicate of our label
      if (isOtherFormLabel(raw, labelRe)) break;  // stop at sibling label

      const candidate = stripSectionPrefix(raw);
      if (candidate) return cap(candidate);
    }
    return null;
  }
  return null;
}

// Columnar layout fallback (GSTN-portal cert style). Same approach as
// extract-gst-r3b's parseColumnarHeader.
function parseColumnarHeader(
  text: string,
  gstin: string | null,
): { legal_name: string | null; trade_name: string | null } {
  if (!gstin) return { legal_name: null, trade_name: null };

  const lines = text.split(/\r?\n/);

  let gstinValueIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === gstin) {
      gstinValueIdx = i;
      break;
    }
  }
  if (gstinValueIdx === -1) return { legal_name: null, trade_name: null };

  const collected: string[] = [];
  for (
    let j = gstinValueIdx + 1;
    j < lines.length && collected.length < 2;
    j++
  ) {
    const raw = lines[j].trim();
    if (!raw) continue;

    if (OTHER_FORM_LABEL_RE.test(raw)) break;
    if (/^[A-Z]{2}\d{12,16}$/.test(raw)) break;         // ARN
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(raw)) break;  // date
    if (isJustSectionPrefix(raw)) break;

    const candidate = stripSectionPrefix(raw);
    if (candidate) collected.push(cap(candidate));
  }

  return {
    legal_name: collected[0] ?? null,
    trade_name: collected[1] ?? null,
  };
}

// ── HTTP helper ────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
