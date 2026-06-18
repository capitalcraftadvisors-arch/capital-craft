// =========================================================
// Capital Craft — `auth` Edge Function
// POST { mobile, otp } -> { ok, token, business }
// For v1, the only valid OTP is "1234".
// JWT is signed with the Supabase project JWT secret, no exp.
// =========================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "https://esm.sh/jose@5.2.0";

const FIXED_OTP = Deno.env.get("FIXED_OTP")!;
const JWT_SECRET = new TextEncoder().encode(Deno.env.get("APP_JWT_SECRET")!);
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*", // tighten to https://app.capitalcraft.in in prod
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { mobile, otp } = await req.json();
    if (otp !== FIXED_OTP) return json({ ok: false, error: "invalid_otp" }, 401);

    // Find or create
    let { data: biz } = await supabase
      .from("epc_business")
      .select("id, status, business_type, current_step, contact_name")
      .eq("contact_mobile", mobile)
      .maybeSingle();

    if (!biz) {
      const { data: created, error } = await supabase
        .from("epc_business")
        .insert({ contact_mobile: mobile })
        .select("id, status, business_type, current_step, contact_name")
        .single();
      if (error) return json({ ok: false, error: error.message }, 500);
      biz = created;
    }

    const token = await new SignJWT({
      sub: biz.id,
      role: "authenticated",
      business_id: biz.id,
      business_type: biz.business_type ?? null,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .sign(JWT_SECRET);

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
