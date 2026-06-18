// =========================================================
// Capital Craft — `extract-cheque` Edge Function
// POST { imageBase64 } -> { ok, raw, ifsc, accountNumber }
// Calls Google Vision DOCUMENT_TEXT_DETECTION and regex-extracts
// IFSC + the longest 9-18 digit number as account number.
// Branch + account holder are left for manual entry.
// On any failure: { ok: false, error } — frontend falls back to manual.
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
    const { imageBase64 } = await req.json();

    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: imageBase64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          }],
        }),
      },
    );

    const data = await visionRes.json();
    const text: string = data?.responses?.[0]?.fullTextAnnotation?.text ?? "";

    const ifsc = (text.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/) || [])[0] ?? null;
    const accountNumber =
      (text.match(/\b\d{9,18}\b/g) || [])
        .sort((a: string, b: string) => b.length - a.length)[0] ?? null;

    return json({ ok: true, raw: text, ifsc, accountNumber });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
