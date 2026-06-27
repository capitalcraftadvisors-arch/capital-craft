// =========================================================
// Capital Craft — `extract-pan` Edge Function
//
// POST { imageBase64, mimeType? }
//   -> { ok: true, pan, raw_text }
//   or { ok: false, error }
//
// Mirrors extract-cheque / extract-gst-r3b:
//   - Frontend converts the file to base64 and POSTs here.
//   - Image content goes to Vision's images:annotate endpoint.
//   - PDF content goes to files:annotate with inline inputConfig.
//   - We regex-extract the first PAN-format match from the OCR text.
//   - On any failure, return { ok: false, error } so the frontend can
//     fall back to manual entry (PAN field stays editable either way).
//
// No auth check inside this function — same convention as the other two
// Vision OCR functions. Caller has a JWT to reach this endpoint, and the
// file content is already in their possession at the frontend.
//
// Reads only one secret: GOOGLE_VISION_API_KEY (already configured).
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

    // PAN format: 5 uppercase letters + 4 digits + 1 uppercase letter
    // (e.g. ABCDE1234F). First match wins — both PAN cards and allotment
    // letters reliably print the PAN before any look-alike sequences.
    const match = text.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
    const pan = match ? match[0] : null;

    return json({
      ok: true,
      pan,
      raw_text: text.slice(0, RAW_TEXT_CAP),
    });
  } catch (e) {
    console.error("[extract-pan] error:", e);
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

// ── HTTP helper ────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
