// GET  /api/epc/quotation/brands        → { ok, options: { field: string[] } }
// POST /api/epc/quotation/brands {field,value} → persists a custom option forever
//
// Powers the "add custom" in the builder's searchable dropdowns. Custom values
// are global (shared across EPCs) so a brand typed once is there for everyone.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const ALLOWED = new Set(["module_brand", "inverter_brand", "mount", "acdb", "dcdb", "cable", "battery"]);

function client(token: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function err(m: string, s: number) { return NextResponse.json({ ok: false, error: m }, { status: s }); }

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    await verifyJwt(token);
    const { data } = await client(token).from("quotation_brand_options").select("field, value");
    const options: Record<string, string[]> = {};
    for (const r of (data ?? []) as { field: string; value: string }[]) {
      (options[r.field] ??= []).push(r.value);
    }
    return NextResponse.json({ ok: true, options });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    await verifyJwt(token);
    const body = (await req.json().catch(() => ({}))) as { field?: string; value?: string };
    const field = String(body.field ?? "").trim();
    const value = String(body.value ?? "").trim();
    if (!ALLOWED.has(field)) return err("Invalid field.", 400);
    if (!value || value.length > 80) return err("Enter a valid value.", 400);
    const { error } = await client(token)
      .from("quotation_brand_options")
      .upsert({ field, value }, { onConflict: "field,value" });
    if (error) return err(error.message, 500);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
