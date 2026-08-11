import { FUNCTIONS_URL } from "./supabase";
import { getToken } from "./auth";
import { parsePanFields } from "./pan-parser";
import { parseGstAddress } from "./gst-address";
import { isValidPan, isValidGstin } from "./doc-validation";

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
  // Accept the PAN only if it's a valid PAN (shape + holder-type char). A
  // mis-read is blanked rather than shown as a real number.
  const panCandidate = (raw.pan ?? parsed.pan)?.toUpperCase() ?? null;
  return {
    ok: true,
    raw_text:    raw.raw_text,
    pan:         isValidPan(panCandidate) ? panCandidate : null,
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
  if (data.ok) {
    // If the server didn't return an address, derive it from the OCR text so
    // the onboarding form's GST address field auto-populates. Non-fatal: any
    // parse miss just leaves the field for the user to fill manually.
    if (!data.address && data.raw_text) {
      data.address = parseGstAddress(data.raw_text);
    }
    // Reject a GSTIN that fails its mod-36 check-digit (mis-read) — blank it
    // rather than show a wrong number.
    if (data.gstin && !isValidGstin(data.gstin)) data.gstin = null;
  }
  return data;
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
