// =========================================================
// Capital Craft — `extract-gst-r3b` Edge Function
//
// POST { imageBase64, mimeType? }
//   -> {
//        ok: true,
//        gstin, legal_name, trade_name,
//        total_taxable_value,           // number, from row 3.1(a)
//        month:   "Apr" | ... | null,   // normalized 3-letter month if detected
//        quarter: "Apr-Jun" | "Jul-Sep" | "Oct-Dec" | "Jan-Mar" | null,
//        year:    2024 | null,          // 4-digit calendar year
//        period_raw: string | null,     // raw text after "Period" label, for debugging
//        raw_text                        // truncated full OCR (4000 char cap)
//      }
//   or { ok: false, error }
//
// What changed in the redesign:
//   - Removed: single `period` free-text field
//   - Added: `month`, `quarter`, `year` (normalized), plus `period_raw`
//   - Quarter takes precedence: if the period text contains both a month
//     and a quarter range (common in quarterly forms), we return only the
//     quarter and leave month null. The frontend's mode (monthly/quarterly)
//     decides which one to display.
//
// Supports BOTH images (jpeg/png/webp) and PDFs.
// No auth check; admin-only enforcement is at /api/upload (rejects
// gst_r3b uploads from non-admins).
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

    const parsed = parseGstR3b(text);
    return json({
      ok: true,
      gstin: parsed.gstin,
      legal_name: parsed.legal_name,
      trade_name: parsed.trade_name,
      total_taxable_value: parsed.total_taxable_value,
      month: parsed.month,
      quarter: parsed.quarter,
      year: parsed.year,
      period_raw: parsed.period_raw,
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
  month: string | null;
  quarter: string | null;
  year: number | null;
  period_raw: string | null;
};

function parseGstR3b(text: string): Parsed {
  const periodRaw = matchAfterLabel(text, /(?:^|\b)Period\b/i);
  const monthFromPeriod = parseMonth(periodRaw);
  const quarterFromPeriod = parseQuarter(periodRaw);

  // Precedence: if the period text is a quarter range, prefer quarter and
  // leave month null (the frontend's mode controls which one is shown).
  const month = quarterFromPeriod ? null : monthFromPeriod;
  const quarter = quarterFromPeriod;

  return {
    gstin: matchGstin(text),
    legal_name: matchAfterLabel(
      text,
      /Legal\s+name\s+of\s+the\s+registered\s+person/i,
    ),
    trade_name: matchAfterLabel(text, /Trade\s+name(?:[\s,]+if\s+any)?/i),
    total_taxable_value: parseTotalTaxableValue(text),
    month,
    quarter,
    year: parseYear(text),
    period_raw: periodRaw,
  };
}

// 15-char GSTIN: 2 digits + 5 letters + 4 digits + 1 letter +
// 1 alphanumeric + 'Z' + 1 alphanumeric.
function matchGstin(text: string): string | null {
  const m = text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/);
  return m ? m[0] : null;
}

// Generic "label : value" / "label\nvalue" extractor (same as before).
function matchAfterLabel(text: string, labelRe: RegExp): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;

    const sameLine = lines[i].replace(labelRe, "");
    const sameLineVal = sameLine.replace(/^[\s:.\-,]+/, "").trim();
    if (sameLineVal) return cap(sameLineVal);

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

// ── New: month / quarter / year parsers ────────────────────────────────────

// Normalize an OCR Period string to a 3-letter month name, or null.
// Tries longer names first so "september" → "Sep", not "Sep" then "tember".
function parseMonth(s: string | null): string | null {
  if (!s) return null;
  // Order matters: longest forms first.
  const table: Array<[RegExp, string]> = [
    [/\bjanuary\b/i, "Jan"],   [/\bjan\b/i, "Jan"],
    [/\bfebruary\b/i, "Feb"],  [/\bfeb\b/i, "Feb"],
    [/\bmarch\b/i, "Mar"],     [/\bmar\b/i, "Mar"],
    [/\bapril\b/i, "Apr"],     [/\bapr\b/i, "Apr"],
    [/\bmay\b/i, "May"],
    [/\bjune\b/i, "Jun"],      [/\bjun\b/i, "Jun"],
    [/\bjuly\b/i, "Jul"],      [/\bjul\b/i, "Jul"],
    [/\baugust\b/i, "Aug"],    [/\baug\b/i, "Aug"],
    [/\bseptember\b/i, "Sep"], [/\bsept\b/i, "Sep"],  [/\bsep\b/i, "Sep"],
    [/\boctober\b/i, "Oct"],   [/\boct\b/i, "Oct"],
    [/\bnovember\b/i, "Nov"],  [/\bnov\b/i, "Nov"],
    [/\bdecember\b/i, "Dec"],  [/\bdec\b/i, "Dec"],
  ];
  for (const [re, label] of table) {
    if (re.test(s)) return label;
  }
  return null;
}

// Normalize an OCR Period string to one of the 4 Indian fiscal quarters.
// Matches "Apr-Jun", "April - June", "Apr/Jun", "Q1" (= Apr-Jun), etc.
function parseQuarter(s: string | null): string | null {
  if (!s) return null;
  const upper = s.toUpperCase();

  // Hyphen/slash separated month-pair patterns.
  // The pattern allows extra letters between the two anchor months
  // (e.g. "JULY-SEPTEMBER" matches the JUL..SEP rule).
  const ranges: Array<{ from: string; to: string; label: string }> = [
    { from: "APR", to: "JUN", label: "Apr-Jun" },
    { from: "JUL", to: "SEP", label: "Jul-Sep" },
    { from: "OCT", to: "DEC", label: "Oct-Dec" },
    { from: "JAN", to: "MAR", label: "Jan-Mar" },
  ];
  for (const r of ranges) {
    // {FROM}[letters][- /][letters]{TO}  e.g. APR-JUN, APRIL-JUNE, APR/JUN
    const re = new RegExp(`\\b${r.from}[A-Z]*\\s*[-/]+\\s*[A-Z]*${r.to}\\b`);
    if (re.test(upper)) return r.label;
  }

  // Q1..Q4 notation (Indian fiscal year starts in April).
  if (/\bQ\s*1\b/.test(upper)) return "Apr-Jun";
  if (/\bQ\s*2\b/.test(upper)) return "Jul-Sep";
  if (/\bQ\s*3\b/.test(upper)) return "Oct-Dec";
  if (/\bQ\s*4\b/.test(upper)) return "Jan-Mar";

  // "Quarter 1..4" spelled out.
  if (/\bQUARTER\s*1\b/.test(upper)) return "Apr-Jun";
  if (/\bQUARTER\s*2\b/.test(upper)) return "Jul-Sep";
  if (/\bQUARTER\s*3\b/.test(upper)) return "Oct-Dec";
  if (/\bQUARTER\s*4\b/.test(upper)) return "Jan-Mar";

  return null;
}

// Extract a 4-digit year. Prefers a value next to a "Year"/"Financial Year"
// label; falls back to the first plausible 4-digit year anywhere in the doc.
// Handles "2024", "2024-25", "2024-2025", "FY 2024-25", etc. — always
// returns the starting year (e.g. 2024 for "2024-25").
function parseYear(text: string): number | null {
  const labeled = matchAfterLabel(text, /(?:Financial\s+)?Year\b/i);
  const fromLabel = labeled ? extractYear(labeled) : null;
  if (fromLabel !== null) return fromLabel;

  // Fallback: scan entire OCR text for the first plausible year.
  const all = text.match(/\b(20\d{2})\b/g);
  if (!all) return null;
  for (const cand of all) {
    const y = parseInt(cand, 10);
    if (y >= 2017 && y <= 2050) return y;
  }
  return null;
}

function extractYear(s: string): number | null {
  const m = s.match(/\b(20\d{2})\b/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return y >= 2017 && y <= 2050 ? y : null;
}

// Extract the "Total taxable value" cell from row 3.1(a). Unchanged.
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
    const matches = [
      ...lines[i].matchAll(/\b(\d{1,3}(?:,\d{2,3})*\.\d{1,2}|\d+\.\d{1,2})\b/g),
    ];
    for (const m of matches) {
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
