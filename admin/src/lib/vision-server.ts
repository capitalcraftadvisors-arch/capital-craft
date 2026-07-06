// Server-only wrapper around the Google Cloud Vision REST API.
//
// Same shape as the Deno Edge Functions in backend/supabase/functions/
// (extract-pan / extract-cheque / extract-gst-r3b / extract-gst-legalname).
// Ported here so Node-side API routes (extract-aadhaar, extract-loan-docs,
// extract-coapp-pan) can call Vision inline instead of hopping through
// a second HTTP endpoint.
//
// Environment: GOOGLE_VISION_API_KEY must be set on Cloud Run.
//
// Do NOT import this from client code — no bundling, Node-only runtime.

const VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const VISION_BASE = "https://vision.googleapis.com/v1";

// Runs DOCUMENT_TEXT_DETECTION on an image or PDF buffer and returns the
// concatenated OCR text. Throws on Vision errors; callers surface these
// to the API-route response.
export async function visionDocumentText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (!VISION_API_KEY) {
    throw new Error("GOOGLE_VISION_API_KEY not configured on the server");
  }
  const base64 = buffer.toString("base64");
  const isPdf = mimeType.toLowerCase().includes("pdf");

  if (isPdf) {
    const res = await fetch(`${VISION_BASE}/files:annotate?key=${VISION_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          inputConfig: { mimeType, content: base64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        }],
      }),
    });
    const data = await res.json();
    const first = data?.responses?.[0];
    if (first?.error) throw new Error("vision_pdf_error: " + JSON.stringify(first.error));
    const pages: Array<{ fullTextAnnotation?: { text?: string } }> = first?.responses ?? [];
    return pages.map((p) => p.fullTextAnnotation?.text ?? "").join("\n\n");
  }

  const res = await fetch(`${VISION_BASE}/images:annotate?key=${VISION_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        image: { content: base64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      }],
    }),
  });
  const data = await res.json();
  const first = data?.responses?.[0];
  if (first?.error) throw new Error("vision_image_error: " + JSON.stringify(first.error));
  return first?.fullTextAnnotation?.text ?? "";
}

// Detects one face on an image buffer and returns the tight bounding
// box (fdBoundingPoly, falling back to the outer boundingPoly). Returns
// null if no face was found or Vision returned an error.
export async function visionDetectFaceBox(
  buffer: Buffer,
): Promise<{ left: number; top: number; width: number; height: number } | null> {
  if (!VISION_API_KEY) {
    throw new Error("GOOGLE_VISION_API_KEY not configured on the server");
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
  const data = await res.json();
  const first = data?.responses?.[0];
  if (first?.error) return null;
  const face = first?.faceAnnotations?.[0];
  const poly = face?.fdBoundingPoly ?? face?.boundingPoly;
  const verts: Array<{ x?: number; y?: number }> = poly?.vertices ?? [];
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
