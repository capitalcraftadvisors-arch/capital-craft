// =========================================================
// Capital Craft — `store-document` Edge Function
// POST { staging_path, final_path, mime_type }
//   -> { ok, storage_path, mime_type, original_size_bytes, stored_size_bytes }
//
// Flow:
//  1. Client uploads original to epc-docs/staging/{uuid} via resumable upload.
//  2. Client calls this function with the staging + final paths.
//  3. Images: resize to 2000px longest side, encode JPEG q75. PDFs: pass through.
//  4. Upload to final path; delete staging.
// =========================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode, Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const BUCKET = "epc-docs";
const MAX_DIMENSION = 2000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { staging_path, final_path, mime_type } = await req.json();

    // Download original from staging
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(staging_path);
    if (error || !blob) return json({ ok: false, error: "download failed" }, 500);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const originalSize = bytes.length;
    let out: Uint8Array = bytes;
    let outMime: string = mime_type;

    // Compress images; PDFs pass through
    if (mime_type.startsWith("image/")) {
      const img = (await decode(bytes)) as Image;
      const longest = Math.max(img.width, img.height);
      if (longest > MAX_DIMENSION) {
        const s = MAX_DIMENSION / longest;
        img.resize(Math.round(img.width * s), Math.round(img.height * s));
      }
      out = await img.encodeJPEG(75);
      outMime = "image/jpeg";
    }

    // Upload to final path
    await supabase.storage.from(BUCKET).upload(final_path, out, {
      contentType: outMime,
      upsert: true,
    });

    // Delete staging
    await supabase.storage.from(BUCKET).remove([staging_path]);

    return json({
      ok: true,
      storage_path: final_path,
      mime_type: outMime,
      original_size_bytes: originalSize,
      stored_size_bytes: out.length,
    });
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
