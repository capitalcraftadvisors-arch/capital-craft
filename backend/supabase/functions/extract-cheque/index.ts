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

    const ifsc = (text.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/) || [])[0] ?? null;
    // Account number lookup — LABEL-ANCHORED ONLY. If we can't find an
    // "A/c No" / "Account No" / "खा. सं." label, we return null. The
    // client shows a blank field for manual entry rather than accepting
    // a wrong number (e.g. the "VALID UP TO ₹100 LACS" reference number
    // stamped on the right side of some cheques would win a length-based
    // race otherwise).
    const accountNumber = findAccountByLabel(text);
    const bankName = bankFromIfsc(ifsc) ?? bankFromText(text);

    return json({
      ok: true,
      // Capped audit copy of the OCR text — matches extract-gst-r3b /
      // extract-gst-legalname. Written to epc_documents.metadata.ocr_raw_text
      // by the Step 4 upload handler so future misreads can be diagnosed
      // without re-running Vision.
      raw: text.slice(0, RAW_TEXT_CAP),
      ifsc,
      accountNumber,
      bankName,
    });
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

// ── Account number extraction ─────────────────────────────────────────────

// LABEL-ANCHORED lookup — English + Hindi variants. Two tiers, in order:
//   1. Inline: "<LABEL> : <digits>" on the same OCR line.
//   2. Label on one line, digits on the next 1-2 lines.
//
// If neither tier fires, returns null. The caller does NOT fall back to a
// length-based heuristic — grabbing the "longest 9-18 digit run" on a
// cheque risks returning the "VALID UP TO ₹XXX LACS" reference stamped on
// the right side, or the MICR band digits at the bottom.
//
// Labels recognized (case-insensitive):
//   English: "A/c No", "A/C No", "A/c No.", "A c No", "Account No",
//            "Account No.", "Account Number"
//   Hindi:   "खा. सं.", "खाता सं", "खाता संख्या"
//
// The regex is tolerant of whitespace/dots between letters because
// Vision OCR sometimes emits e.g. "A / c   No.".
function findAccountByLabel(text: string): string | null {
  // Common label form for BOTH tiers.
  const LABEL = new RegExp(
    "(?:"
    + "A\\s*[\\/\\.]?\\s*[cC]\\s*(?:No\\.?)?"          // A/c No, A/C No, A c No, A.c.No
    + "|Account\\s+(?:No\\.?|Number)"                  // Account No, Account Number
    + "|खा\\s*\\.?\\s*सं\\s*\\.?"                       // खा. सं.
    + "|खाता\\s*(?:सं\\s*\\.?|संख्या)"                    // खाता सं, खाता संख्या
    + ")",
    "i",
  );

  // Tier 1: "<LABEL> [:.-]? <digits>" — same OCR line.
  const inline = text.match(
    new RegExp(LABEL.source + "\\s*[:.\\-]?\\s*(\\d{9,18})", "i"),
  );
  if (inline) return inline[1];

  // Tier 2: label somewhere on line i, digits within lines i..i+2.
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!LABEL.test(lines[i])) continue;
    const same = lines[i].match(/\b(\d{9,18})\b/);
    if (same) return same[1];
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const next = lines[j].match(/\b(\d{9,18})\b/);
      if (next) return next[1];
    }
  }
  return null;
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
