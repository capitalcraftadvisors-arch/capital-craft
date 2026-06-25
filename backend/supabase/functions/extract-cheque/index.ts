// =========================================================
// Capital Craft — `extract-cheque` Edge Function
//
// POST { imageBase64, mimeType? }
//   -> { ok: true, raw, ifsc, accountNumber, bankName }
//   or { ok: false, error }
//
// Routes to:
//   - images:annotate  for JPG/PNG/WEBP (default)
//   - files:annotate   for PDFs (when mimeType includes "pdf")
//
// Extracts:
//   - IFSC          : regex on Vision OCR text
//   - accountNumber : longest 9-18 digit run in OCR text
//   - bankName      : first try IFSC prefix -> known bank, else
//                     scan OCR text for "X Bank" patterns
//
// On any failure: { ok: false, error } so the frontend falls back
// to manual entry. Never blocks onboarding.
// =========================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const VISION_API_KEY = Deno.env.get("GOOGLE_VISION_API_KEY")!;

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

    const ifsc = (text.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/) || [])[0] ?? null;
    const accountNumber =
      (text.match(/\b\d{9,18}\b/g) || [])
        .sort((a: string, b: string) => b.length - a.length)[0] ?? null;
    const bankName = bankFromIfsc(ifsc) ?? bankFromText(text);

    return json({ ok: true, raw: text, ifsc, accountNumber, bankName });
  } catch (e) {
    console.error("[extract-cheque] error:", e);
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
  // files:annotate wraps per-page responses in an inner `responses` array.
  const pages: Array<{ fullTextAnnotation?: { text?: string } }> =
    data?.responses?.[0]?.responses ?? [];
  return pages.map((p) => p.fullTextAnnotation?.text ?? "").join("\n\n");
}

// ── Bank name extraction ───────────────────────────────────────────────────

// First 4 letters of an IFSC code identify the bank. Map covers ~95% of
// Indian banks an EPC is likely to use. Extend as needed.
const IFSC_BANK_PREFIX: Record<string, string> = {
  HDFC: "HDFC Bank",
  ICIC: "ICICI Bank",
  SBIN: "State Bank of India",
  UTIB: "Axis Bank",
  KKBK: "Kotak Mahindra Bank",
  YESB: "YES Bank",
  PUNB: "Punjab National Bank",
  ORBC: "Punjab National Bank",          // former Oriental Bank of Commerce (merged)
  BARB: "Bank of Baroda",
  IDFB: "IDFC FIRST Bank",
  INDB: "IndusInd Bank",
  CNRB: "Canara Bank",
  SYNB: "Canara Bank",                   // former Syndicate Bank (merged)
  BKID: "Bank of India",
  IOBA: "Indian Overseas Bank",
  IBKL: "IDBI Bank",
  FDRL: "Federal Bank",
  CITI: "Citibank",
  HSBC: "HSBC Bank",
  SCBL: "Standard Chartered Bank",
  RATN: "RBL Bank",
  BDBL: "Bandhan Bank",
  AUBL: "AU Small Finance Bank",
  UCBA: "UCO Bank",
  PSIB: "Punjab & Sind Bank",
  UBIN: "Union Bank of India",
  ANDB: "Union Bank of India",           // former Andhra Bank (merged)
  CORP: "Union Bank of India",           // former Corporation Bank (merged)
  CBIN: "Central Bank of India",
  ALLA: "Indian Bank",                   // former Allahabad Bank (merged)
  IDIB: "Indian Bank",
  KARB: "Karnataka Bank",
  TMBL: "Tamilnad Mercantile Bank",
  CIUB: "City Union Bank",
  DCBL: "DCB Bank",
  KVBL: "Karur Vysya Bank",
  SIBL: "South Indian Bank",
  JAKA: "Jammu and Kashmir Bank",
  ESFB: "Equitas Small Finance Bank",
  UJVN: "Ujjivan Small Finance Bank",
  DLXB: "Dhanlaxmi Bank",
  NKGS: "NKGSB Co-op Bank",
  SVCB: "SVC Co-operative Bank",
};

function bankFromIfsc(ifsc: string | null): string | null {
  if (!ifsc || ifsc.length < 4) return null;
  return IFSC_BANK_PREFIX[ifsc.slice(0, 4).toUpperCase()] ?? null;
}

// Fallback: scan top portion of OCR text for "X Bank" / "Bank of X" patterns.
function bankFromText(text: string): string | null {
  const lines = text.split(/\r?\n/).slice(0, 20);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // "Bank of India", "Bank of Baroda" etc.
    const bankOf = line.match(/\b(Bank\s+of\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\b/);
    if (bankOf) return cleanName(bankOf[1]);
    // "HDFC Bank", "ICICI Bank", "State Bank of India" (caught above), etc.
    const xBank = line.match(/\b([A-Z][A-Za-z&]+(?:\s+[A-Z][A-Za-z&]+){0,4})\s+Bank\b/);
    if (xBank) return cleanName(xBank[1] + " Bank");
    // ALL CAPS variant: "HDFC BANK", "AXIS BANK"
    const xBankCaps = line.match(/\b([A-Z][A-Z&]+(?:\s+[A-Z][A-Z&]+){0,4})\s+BANK\b/);
    if (xBankCaps) return cleanName(toTitleCase(xBankCaps[1] + " Bank"));
  }
  return null;
}

function cleanName(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 80);
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

// ── HTTP helper ────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
