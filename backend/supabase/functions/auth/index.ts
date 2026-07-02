// =========================================================
// Capital Craft — `auth` Edge Function
// POST { mobile, otp } -> { ok, token, business }
//
// Signing key selection (no code change needed to roll back):
//   - If APP_SIGNING_JWK is set, sign with ES256 using that private JWK.
//   - Otherwise, sign with HS256 using APP_JWT_SECRET (legacy fallback).
//
// To roll back from ES256 to HS256: unset APP_SIGNING_JWK, redeploy.
// =========================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importJWK, type KeyLike } from "https://esm.sh/jose@5.2.0";

const FIXED_OTP = Deno.env.get("FIXED_OTP")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*", // tighten to https://app.capitalcraft.in in prod
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Signing-key setup at cold start ─────────────────────────────────────────
// If APP_SIGNING_JWK is set and parses, we use ES256. We deliberately let
// JSON.parse / importJWK throw at startup if the secret is malformed — better
// to fail the deploy loudly than to silently fall back and mask a bug.

const SIGNING_JWK_RAW = Deno.env.get("APP_SIGNING_JWK");
const HS256_RAW = Deno.env.get("APP_JWT_SECRET");

let ES256_KEY: KeyLike | null = null;
let ES256_KID: string | null = null;
if (SIGNING_JWK_RAW) {
  // APP_SIGNING_JWK is base64-encoded JSON (avoids PowerShell quoting issues
  // when setting the secret). Decode -> parse -> import.
  const jwk = JSON.parse(atob(SIGNING_JWK_RAW.trim()));
  ES256_KEY = (await importJWK(jwk, "ES256")) as KeyLike;
  ES256_KID = jwk.kid ?? null;
  if (!ES256_KID) throw new Error("APP_SIGNING_JWK is missing the kid field");
}

const HS256_KEY = HS256_RAW ? new TextEncoder().encode(HS256_RAW) : null;

if (!ES256_KEY && !HS256_KEY) {
  throw new Error(
    "No signing key configured: set APP_SIGNING_JWK (preferred) or APP_JWT_SECRET",
  );
}

console.log(
  "auth function loaded; signing with " + (ES256_KEY ? "ES256 (kid " + ES256_KID + ")" : "HS256 (legacy)"),
);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { mobile, otp } = await req.json();
    

    // Find or create
    let { data: biz } = await supabase
      .from("epc_business")
      .select("id, status, business_type, current_step, contact_name, loan_app_unlocked")
      .eq("contact_mobile", mobile)
      .maybeSingle();

    if (!biz) {
      const { data: created, error } = await supabase
        .from("epc_business")
        .insert({ contact_mobile: mobile })
        .select("id, status, business_type, current_step, contact_name, loan_app_unlocked")
        .single();
      if (error) return json({ ok: false, error: error.message }, 500);
      biz = created;
    }

    const claims = {
      sub: biz.id,
      role: "authenticated",
      business_id: biz.id,
      business_type: biz.business_type ?? null,
    };

    let token: string;
    if (ES256_KEY && ES256_KID) {
      token = await new SignJWT(claims)
        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: ES256_KID })
        .setIssuedAt()
        .setAudience("authenticated")
        .sign(ES256_KEY);
    } else {
      token = await new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuedAt()
        .setAudience("authenticated")
        .sign(HS256_KEY!);
    }

    return json({ ok: true, token, business: biz });
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
