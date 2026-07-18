// POST /api/admin/insurance/[id]/save-policy   JSON { policy_from_date?, policy_to_date? }
//
// Admin-only. Persists the (manually corrected) policy coverage dates.
// Accepts "YYYY-MM-DD" strings or null/empty to clear. Whitelist only.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { SUPABASE_URL, SUPABASE_ANON, UUID_RE } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function dateOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return DATE_RE.test(v.trim()) ? v.trim() : null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);
    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    const body = await req.json().catch(() => ({}));
    const b = body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if ("policy_from_date" in b) patch.policy_from_date = dateOrNull(b.policy_from_date);
    if ("policy_to_date" in b)   patch.policy_to_date   = dateOrNull(b.policy_to_date);
    if (Object.keys(patch).length === 0) return err("Nothing to save.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: updErr } = await supabase.from("insurance_applications").update(patch).eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance/save-policy] error:", msg);
    return err(msg, 500);
  }
}
