// =========================================================
// Capital Craft — `extract-gst-legalname` Edge Function
//
// POST { imageBase64, mimeType? }
//   -> { ok: true, gstin, legal_name, trade_name, raw_text }
//   or { ok: false, error }
//
// Purpose: pull Legal Name + Trade Name from a GST REGISTRATION
// document (Form GST REG-06, the issued certificate). Distinct
// from `extract-gst-r3b` which parses GSTR-3B RETURNS.
//
// Real REG-06 certs use a numbered TABLE layout:
//
//   1.  Legal Name                        LALIT KUMAR SAINI
//   2.  Trade Name, if any                ANJALI AGENCIES
//   3.  Additional trade names, if any    (often blank)
//
// GSTR-3B PDFs use "Legal name of the registered person" phrasing.
// Older certs use "Legal Name of Business" phrasing.
//
// Parsing strategy:
//   1. Try in-place label matchers, chained by specificity:
//      Legal: "Legal Name of Business" → "Legal name of the registered
//             person" → generic "Legal Name" (catches the 2-word cert form).
//      Trade: "Trade Name" (with ", if any" / "(if any)" consumed as part
//             of the label). Lines matching "Additional trade" are skipped
//             so the row-3 label never leaks in.
//   2. Strip table numbering ("1. ", "2. ", "3. ") from a line BEFORE
//      running the label regex — otherwise the value comes back with a
//      "1." prefix.
//   3. Reject label-fragment scraps ("if any", "additional") so if any
//      slips through the primary matcher, the columnar fallback runs.
//   4. Columnar fallback: anchor on the GSTIN value line and read the
//      next 2 plausible value lines as legal + trade.
//
// No auth check — same convention as other OCR functions.
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

    // Step 1: in-place label matchers, specific → generic.
    // For Legal Name: three chained patterns. Generic 2-word `/Legal\s+Name/i`
    // is the LAST resort so it doesn't outrun the more descriptive labels
    // on documents that use them.
    let legal_name =
         matchAfterFormLabel(text, /Legal\s+Name\s+of\s+Business/i)
      ?? matchAfterFormLabel(text, /Legal\s+name\s+of\s+the\s+registered\s+person/i)
      ?? matchAfterFormLabel(text, /Legal\s+Name/i);

    // For Trade Name: one pattern that consumes ", if any" / "(if any)"
    // as part of the label. Lines containing "Additional trade" are
    // skipped by skipLine so REG-06 row 3 ("Additional trade names,
    // if any") never satisfies this matcher.
    let trade_name = matchAfterFormLabel(
      text,
      /Trade\s+Name(?:\s*[,\(]?\s*if\s+any\s*\)?)?/i,
      { skipLine: ADDITIONAL_TRADE_RE },
    );

    // Step 2: columnar fallback if either field came back null or as a
    // label/prefix/fragment scrap.
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

// Strip "1. ", "2. ", "3. " from the head of a line so label matchers
// can see past REG-06 table numbering. `\s*` (not `\s+`) at the tail so
// a line that IS JUST a table number (e.g. Vision OCR emits "2." as its
// own line in columnar layouts) reduces to "" and gets skipped by the
// forward-walk. Otherwise it would come back as the "value" of the
// preceding label — which is exactly the "Legal name = 2., Trade name = 3."
// bug we saw on real REG-06 certs.
const TABLE_NUMBER_PREFIX_RE = /^\s*\d+\s*\.\s*/;
function stripTableNumber(s: string): string {
  return s.replace(TABLE_NUMBER_PREFIX_RE, "");
}
// True if a raw line is JUST a bare table number ("1.", " 2 . ", etc.).
const BARE_TABLE_NUMBER_RE = /^\s*\d+\s*\.\s*$/;

// GSTR-3B PDF section prefixes ("2(a).", "3.1(b)", etc.) — different beast
// from REG-06 table numbering. Retained from the previous parser.
const SECTION_PREFIX_RE = /^\s*\d+(?:\.\d+)?\s*\(\s*[a-z]\s*\)\s*\.?\s*/i;
const SECTION_PREFIX_ONLY_RE = /^\s*\d+(?:\.\d+)?\s*\(\s*[a-z]\s*\)\s*\.?\s*$/i;
function stripSectionPrefix(s: string): string {
  return s.replace(SECTION_PREFIX_RE, "").trim();
}
function isJustSectionPrefix(s: string): boolean {
  return SECTION_PREFIX_ONLY_RE.test(s);
}

// Line matching "Additional trade names, if any" — REG-06 row 3.
// Must never be treated as a Trade Name label.
const ADDITIONAL_TRADE_RE = /Additional\s+trade/i;

// Sibling-label detector. Includes "Additional trade" so the forward-walk
// window stops at row 3 even if it wasn't pre-skipped.
const OTHER_FORM_LABEL_RE =
  /^(?:\s*\d+(?:\.\d+)?\s*\(\s*[a-z]\s*\)\s*\.?\s*)?(?:Additional\s+trade|Legal\s+Name|Trade\s+Name|GSTIN|Period|(?:Financial\s+)?Year|Status|ARN|Constitution|Date\s+of\s+(?:Registration|filing|liability)|Address|Type\s+of\s+Registration)\b/i;

function isOtherFormLabel(s: string, currentLabelRe: RegExp): boolean {
  if (!OTHER_FORM_LABEL_RE.test(s)) return false;
  return !currentLabelRe.test(s);
}

// A value that is really a label leftover: "if any", "additional", etc.
// If the primary matcher returns one of these, treat it as null and let
// the columnar fallback try.
function looksLikeLabelFragment(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (!t) return true;
  if (t === "if any" || t.startsWith("if any ")) return true;
  if (t === "additional") return true;
  // Belt-and-suspenders: even if stripTableNumber missed for some reason,
  // reject a bare "2." / "3." from being returned as a value.
  if (BARE_TABLE_NUMBER_RE.test(t)) return true;
  return false;
}

function isLabelOrPrefix(s: string | null): boolean {
  if (!s) return false;
  if (isJustSectionPrefix(s)) return true;
  if (OTHER_FORM_LABEL_RE.test(s)) return true;
  if (looksLikeLabelFragment(s)) return true;
  return false;
}

function cap(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) : s;
}

// In-place "label : value" / "label\nvalue" matcher.
//
// Strategy:
//   1. For each line, optionally skip via opts.skipLine.
//   2. Strip REG-06 table numbering ("1. ", "2. ") from the head.
//   3. Test the label regex against the stripped line.
//   4. Same-line: replace the label match, strip leading punctuation +
//      section prefix, return the remainder if non-empty.
//   5. Otherwise walk forward up to 6 lines:
//      - skip empty, section-prefix-only, or opts.skipLine lines
//      - skip lines that repeat OUR label
//      - STOP at a sibling label (Trade Name if we're searching Legal,
//        Additional Trade, GSTIN, Period, etc.)
//      - first surviving line, after prefix strip, is the value
//   6. If this occurrence's walk yielded nothing, CONTINUE the outer
//      loop to look for the NEXT occurrence of the label. Real REG-06
//      certs repeat the label three times (page 1 table + Annexure A
//      + Annexure B); on page 1 Vision reads the table column-by-column
//      so the walk-forward hits sibling labels ("Trade Name") before
//      the values ("LALIT KUMAR SAINI"). The Annexure pages then have
//      labels immediately adjacent to their values and give a clean
//      match on the second/third try.
function matchAfterFormLabel(
  text: string,
  labelRe: RegExp,
  opts: { skipLine?: RegExp } = {},
): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (opts.skipLine && opts.skipLine.test(lines[i])) continue;
    const line = stripTableNumber(lines[i]);
    if (!labelRe.test(line)) continue;

    // Same-line attempt.
    const sameLineRemainder = line.replace(labelRe, "");
    const trimmed = sameLineRemainder.replace(/^[\s:.\-,]+/, "").trim();
    const sameLineVal = stripSectionPrefix(trimmed);
    if (sameLineVal && !looksLikeLabelFragment(sameLineVal)) {
      return cap(sameLineVal);
    }

    // Forward window.
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      if (opts.skipLine && opts.skipLine.test(lines[j])) continue;
      const raw = stripTableNumber(lines[j]).trim();
      if (!raw) continue;
      if (isJustSectionPrefix(raw)) continue;
      if (labelRe.test(raw)) continue;            // duplicate of OUR label
      if (isOtherFormLabel(raw, labelRe)) break;  // stop at a sibling label

      const candidate = stripSectionPrefix(raw);
      if (candidate && !looksLikeLabelFragment(candidate)) {
        return cap(candidate);
      }
    }
    // Deliberate: DON'T return null here. Let the outer loop try the
    // next occurrence of the same label further down the document.
  }
  return null;
}

// Columnar layout fallback (GSTN-portal cert / R3B style). Anchors on the
// GSTIN value line and reads the next 2 plausible value lines as legal +
// trade. Retained from previous parser.
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
    const raw = stripTableNumber(lines[j]).trim();
    if (!raw) continue;

    if (OTHER_FORM_LABEL_RE.test(raw)) break;
    if (ADDITIONAL_TRADE_RE.test(raw)) break;
    if (/^[A-Z]{2}\d{12,16}$/.test(raw)) break;               // ARN
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(raw)) break;   // date
    if (isJustSectionPrefix(raw)) break;

    const candidate = stripSectionPrefix(raw);
    if (candidate && !looksLikeLabelFragment(candidate)) {
      collected.push(cap(candidate));
    }
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
