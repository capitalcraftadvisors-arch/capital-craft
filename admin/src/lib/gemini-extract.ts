// Server-only. Structured document extraction via Google Gemini, using the
// SAME GOOGLE_VISION_API_KEY that already powers Vision (the key is authorised
// for both APIs). Given one or more document images + a JSON schema + a strict
// "return only what's printed, else null" prompt, Gemini reads the actual
// document and returns validated JSON — far more faithful than regex parsing.
//
// Design: NON-FATAL. Any failure (billing off, model retired, network, bad
// JSON) returns null, so callers fall back to the existing Vision+regex path
// and the OCR route never breaks. The model is an env var so it can be updated
// without a redeploy if Google retires a version.
//
// Do NOT import from client code.

const GEMINI_KEY = process.env.GOOGLE_VISION_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const GEMINI_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

export type GeminiImage = { buffer: Buffer; mime: string };

// Returns the parsed object matching `schema`, or null if extraction failed.
export async function geminiExtract<T = Record<string, unknown>>(opts: {
  images: GeminiImage[];
  prompt: string;
  schema: object; // Gemini responseSchema (OBJECT with nullable properties)
  label?: string; // for logs, e.g. "aadhaar"
}): Promise<T | null> {
  if (!GEMINI_KEY) return null;
  const tag = `[gemini${opts.label ? ":" + opts.label : ""}]`;

  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: opts.prompt },
  ];
  for (const img of opts.images) {
    if (!img?.buffer?.length) continue;
    parts.push({
      inline_data: {
        mime_type: img.mime.toLowerCase().includes("pdf") ? "application/pdf" : "image/jpeg",
        data: img.buffer.toString("base64"),
      },
    });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      temperature: 0, // deterministic — we want faithful copying, not creativity
    },
  };

  try {
    const res = await fetch(GEMINI_URL(GEMINI_MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    if (!j || j.error) {
      console.warn(`${tag} unavailable:`, j?.error?.status, (j?.error?.message || "").slice(0, 140));
      return null;
    }
    const text: string | undefined = j.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (e) {
    console.warn(`${tag} exception:`, (e as Error)?.message);
    return null;
  }
}
