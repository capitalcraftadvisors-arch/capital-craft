import { FUNCTIONS_URL } from "./supabase";
import { getToken } from "./auth";
import { parsePanFields } from "./pan-parser";

export type ChequeOcrResult =
  | {
      ok: true;
      raw: string;
      ifsc: string | null;
      accountNumber: string | null;
      bankName: string | null;
    }
  | { ok: false; error: string };

// Converts a File (image or PDF) to base64 and calls extract-cheque.
// mimeType is forwarded so PDFs route to Vision's files:annotate endpoint
// instead of images:annotate.
export async function extractCheque(file: File): Promise<ChequeOcrResult> {
  const base64 = await fileToBase64(file);
  const res = await fetch(`${FUNCTIONS_URL}/extract-cheque`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
    body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
  });
  return res.json();
}

export type GstR3bOcrResult =
  | {
      ok: true;
      gstin: string | null;
      legal_name: string | null;
      trade_name: string | null;
      total_taxable_value: number | null;
      month: string | null;        // "Jan" | "Feb" | ... | "Dec" or null
      quarter: string | null;      // "Apr-Jun" | "Jul-Sep" | "Oct-Dec" | "Jan-Mar" or null
      year: number | null;         // 4-digit, e.g. 2024
      period_raw: string | null;   // raw text after "Period" label (debug)
      raw_text: string;
    }
  | { ok: false; error: string };

// Mirrors extractCheque: file -> base64 -> Edge Function. Passes mimeType
// through so the function can route PDFs to files:annotate (Vision's PDF
// endpoint) instead of images:annotate.
export async function extractGstR3b(file: File): Promise<GstR3bOcrResult> {
  const base64 = await fileToBase64(file);
  const res = await fetch(`${FUNCTIONS_URL}/extract-gst-r3b`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
    body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
  });
  return res.json();
}

// Extended PAN OCR result. The Deno extract-pan Edge Function still
// returns only { ok, pan, raw_text } — we enrich the success payload
// client-side by running parsePanFields on the raw_text to pull the
// name / father's name / DOB off the card. Existing Page 1 callers
// that only read `pan` are unaffected.
export type PanOcrResult =
  | {
      ok: true;
      raw_text: string;
      pan: string | null;
      name: string | null;
      father_name: string | null;
      dob: string | null;
    }
  | { ok: false; error: string };

export async function extractPan(file: File): Promise<PanOcrResult> {
  const base64 = await fileToBase64(file);
  const res = await fetch(`${FUNCTIONS_URL}/extract-pan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
    body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
  });
  const raw = (await res.json()) as
    | { ok: true; pan: string | null; raw_text: string }
    | { ok: false; error: string };
  if (!raw.ok) return raw;
  const parsed = parsePanFields(raw.raw_text || "");
  return {
    ok: true,
    raw_text:    raw.raw_text,
    pan:         raw.pan ?? parsed.pan,
    name:        parsed.name,
    father_name: parsed.father_name,
    dob:         parsed.dob,
  };
}

export type GstLegalNameOcrResult =
  | {
      ok: true;
      gstin: string | null;
      legal_name: string | null;
      trade_name: string | null;
      // Principal Place of Business address. May be supplied by the Edge
      // Function directly; if absent we derive it client-side from raw_text
      // (see parseGstAddress) so the field auto-fills without a redeploy.
      address: string | null;
      raw_text: string;
    }
  | { ok: false; error: string };

// Mirrors extractPan / extractGstR3b. PDFs and images both supported via
// the Edge Function's internal mimeType branching.
export async function extractGstLegalName(file: File): Promise<GstLegalNameOcrResult> {
  const base64 = await fileToBase64(file);
  const res = await fetch(`${FUNCTIONS_URL}/extract-gst-legalname`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
    body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
  });
  const data = (await res.json()) as GstLegalNameOcrResult;
  // If the server didn't return an address, derive it from the OCR text so
  // the onboarding form's GST address field auto-populates. Non-fatal: any
  // parse miss just leaves the field for the user to fill manually.
  if (data.ok && !data.address && data.raw_text) {
    data.address = parseGstAddress(data.raw_text);
  }
  return data;
}

// ── GST "Principal Place of Business" address parser ────────────────────────
// GST REG-06 certificates list the principal address after an
// "Address of Principal Place of Business" (or "Principal Place of Business")
// label, spanning several lines and ending near the 6-digit PIN. We collect
// the lines after the label until a sibling field label or the PIN line.
const GST_ADDRESS_LABEL_RE =
  /Address\s+of\s+(?:the\s+)?Principal\s+Place\s+of\s+Business|Principal\s+Place\s+of\s+Business/i;

// Field labels that terminate the multi-line address block on a REG-06 cert.
const GST_ADDRESS_STOP_RE =
  /^(?:\s*\d+(?:\.\d+)?\s*[.)]?\s*)?(?:Date\s+of\s+(?:Liability|Validity|Registration|filing)|Period\s+of\s+Validity|Type\s+of\s+Registration|Nature\s+of\s+Business|Particulars\s+of|Approving\s+Authority|Signature|Constitution\s+of\s+Business|GSTIN|Legal\s+Name|Trade\s+Name|Additional\s+trade|Annexure|Note\s*:)\b/i;

export function parseGstAddress(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/^\s*\d+\s*[.)]\s*/, "");
    if (!GST_ADDRESS_LABEL_RE.test(stripped)) continue;

    const parts: string[] = [];
    // Same line may carry the first address segment after the label.
    const sameLine = stripped
      .replace(GST_ADDRESS_LABEL_RE, "")
      .replace(/^[\s:.\-,]+/, "")
      .trim();
    if (sameLine && !GST_ADDRESS_STOP_RE.test(sameLine)) parts.push(sameLine);

    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const raw = lines[j].replace(/^\s*\d+\s*[.)]\s*/, "").trim();
      if (!raw) {
        if (parts.length) break; // blank line after we started = block end
        continue;
      }
      if (GST_ADDRESS_LABEL_RE.test(raw)) continue; // repeated label
      if (GST_ADDRESS_STOP_RE.test(raw)) break;
      parts.push(raw);
      if (/\b\d{6}\b/.test(raw)) break; // PIN code = address end
    }

    if (parts.length) {
      const joined = parts
        .join(", ")
        .replace(/\s*,\s*,\s*/g, ", ")
        .replace(/[,\s]+$/, "")
        .trim();
      if (joined) return joined.length > 300 ? joined.slice(0, 300) : joined;
    }
  }
  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      // Strip "data:image/png;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
