import { FUNCTIONS_URL } from "./supabase";
import { getToken } from "./auth";

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
      period: string | null;
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
