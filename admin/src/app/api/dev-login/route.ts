// LOCAL DEV ONLY — mints an admin session token for the local stack so you can
// log in without the internet-only `auth` edge function. Hard-guarded to refuse
// unless the app is pointed at a LOCAL Supabase (127.0.0.1 / localhost), so it
// is completely inert in production.
import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!/127\.0\.0\.1|localhost/.test(URL)) {
    return NextResponse.json({ ok: false, error: "dev-login is local-only" }, { status: 403 });
  }
  const secret = process.env.APP_JWT_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "missing local env: APP_JWT_SECRET / SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 },
    );
  }

  const supa = createClient(URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: admin, error } = await supa
    .from("epc_business")
    .select("id,status,business_type,current_step,contact_name,loan_app_unlocked,service_type")
    .eq("business_type", "admin")
    .limit(1)
    .maybeSingle();
  if (error || !admin) {
    return NextResponse.json({ ok: false, error: error?.message || "no admin row found" }, { status: 500 });
  }

  const token = await new SignJWT({
    sub: admin.id,
    role: "authenticated",
    business_id: admin.id,
    business_type: "admin",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setAudience("authenticated")
    .sign(new TextEncoder().encode(secret));

  return NextResponse.json({ ok: true, token, business: admin });
}
