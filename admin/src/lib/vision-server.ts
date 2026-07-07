// Server-only wrapper around the Google Cloud Vision REST API.
//
// Same shape as the Deno Edge Functions in backend/supabase/functions/
// (extract-pan / extract-cheque / extract-gst-r3b / extract-gst-legalname).
// Ported here so Node-side API routes (extract-aadhaar, extract-loan-docs,
// extract-coapp-pan, extract-bank-statement) can call Vision inline instead
// of hopping through a second HTTP endpoint.
//
// Environment: GOOGLE_VISION_API_KEY must be set on Cloud Run.
//
// IMPORTANT — error handling: Vision returns errors at TWO levels:
//   1. Top-level: { "error": { "code": 400, "message": "..." } }
//      — used when the API key is invalid, the API isn't enabled,
//      quota is exhausted, etc. `data.responses` is undefined.
//   2. Per-response: { "responses": [ { "error": { ... } } ] }
//      — used when the specific image failed but the request itself
//      was authorised (bad image, unsupported format, etc.).
// Both surfaces must be checked, otherwise a bad API key silently
// swallows and returns empty text — which is exactly what bit us
// in the loan-app OCR rollout.
//
// Do NOT import this from client code — no bundling, Node-only runtime.

const VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const VISION_BASE = "https://vision.googleapis.com/v1";

// Extract the human-readable error string from a Vision error object,
// preferring `message` and falling back to a JSON dump.
function visionErrText(errObj: unknown): string {
  if (!errObj || typeof errObj !== "object") return String(errObj);
  const e = errObj as { message?: string; code?: number; status?: string };
  const parts: string[] = [];
  if (e.code)    parts.push(`code=${e.code}`);
  if (e.status)  parts.push(`status=${e.status}`);
  if (e.message) parts.push(e.message);
  return parts.length > 0 ? parts.join(" · ") : JSON.stringify(errObj);
}

// Runs DOCUMENT_TEXT_DETECTION on an image or PDF buffer and returns the
// concatenated OCR text. Throws on Vision errors — callers surface the
// real error message so `debug_vision_error` in the route response
// (and Cloud Run logs) show what actually broke.
export async function visionDocumentText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (!VISION_API_KEY) {
    throw new Error("GOOGLE_VISION_API_KEY not configured on the server");
  }
  const base64 = buffer.toString("base64");
  const isPdf = mimeType.toLowerCase().includes("pdf");

  const res = await fetch(
    isPdf
      ? `${VISION_BASE}/files:annotate?key=${VISION_API_KEY}`
      : `${VISION_BASE}/images:annotate?key=${VISION_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [ isPdf ? {
          inputConfig: { mimeType, content: base64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        } : {
          image: { content: base64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        }],
      }),
    },
  );

  // Vision returns HTTP 200 even when the API key is invalid — the
  // error lives inside the JSON body. So we don't gate on res.ok; we
  // parse and inspect. But we DO surface HTTP errors when they exist.
  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`vision_bad_response HTTP=${res.status}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Layer 1 — top-level error (auth / quota / API-not-enabled).
  const topErr = (data as { error?: unknown })?.error;
  if (topErr) {
    throw new Error(`vision_api_error: ${visionErrText(topErr)}`);
  }

  const responses = (data as { responses?: unknown[] })?.responses;
  if (!Array.isArray(responses) || responses.length === 0) {
    throw new Error(`vision_bad_response: no responses array (HTTP ${res.status})`);
  }

  const first = responses[0] as {
    error?: unknown;
    fullTextAnnotation?: { text?: string };
    responses?: Array<{ fullTextAnnotation?: { text?: string } }>;
  };

  // Layer 2 — per-request error (bad image, unsupported format).
  if (first?.error) {
    throw new Error(`vision_image_error: ${visionErrText(first.error)}`);
  }

  if (isPdf) {
    // files:annotate wraps per-page responses in an inner responses array.
    const pages = first?.responses ?? [];
    return pages.map((p) => p.fullTextAnnotation?.text ?? "").join("\n\n");
  }
  return first?.fullTextAnnotation?.text ?? "";
}

// Detects one face on an image buffer and returns the tight bounding
// box (fdBoundingPoly, falling back to the outer boundingPoly). Returns
// null if no face was found. On Vision API error, logs the message and
// returns null — face crop is best-effort and non-blocking.
export async function visionDetectFaceBox(
  buffer: Buffer,
): Promise<{ left: number; top: number; width: number; height: number } | null> {
  if (!VISION_API_KEY) {
    // Fail loudly here too — quieter than throwing but visible in logs.
    console.warn("[visionDetectFaceBox] GOOGLE_VISION_API_KEY not configured");
    return null;
  }
  const base64 = buffer.toString("base64");
  const res = await fetch(`${VISION_BASE}/images:annotate?key=${VISION_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        image: { content: base64 },
        features: [{ type: "FACE_DETECTION", maxResults: 1 }],
      }],
    }),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    console.warn("[visionDetectFaceBox] bad JSON:", e);
    return null;
  }

  const topErr = (data as { error?: unknown })?.error;
  if (topErr) {
    console.warn("[visionDetectFaceBox] top-level error:", visionErrText(topErr));
    return null;
  }

  const first = (data as { responses?: Array<{ error?: unknown; faceAnnotations?: unknown[] }> })
    ?.responses?.[0];
  if (!first) return null;
  if (first.error) {
    console.warn("[visionDetectFaceBox] per-request error:", visionErrText(first.error));
    return null;
  }

  const face = (first.faceAnnotations as Array<{
    fdBoundingPoly?: { vertices?: Array<{ x?: number; y?: number }> };
    boundingPoly?:   { vertices?: Array<{ x?: number; y?: number }> };
  }>)?.[0];
  const poly = face?.fdBoundingPoly ?? face?.boundingPoly;
  const verts = poly?.vertices ?? [];
  if (verts.length < 4) return null;

  const xs = verts.map((v) => v.x ?? 0);
  const ys = verts.map((v) => v.y ?? 0);
  const left   = Math.min(...xs);
  const top    = Math.min(...ys);
  const right  = Math.max(...xs);
  const bottom = Math.max(...ys);
  const width  = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}
