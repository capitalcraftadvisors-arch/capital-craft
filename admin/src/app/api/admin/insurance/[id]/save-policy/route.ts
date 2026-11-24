// POST /api/admin/insurance/[id]/save-policy   JSON { policy_from_date?, policy_to_date? }
//
// Admin-only. Persists the (manually corrected) policy coverage dates.
// Accepts "YYYY-MM-DD" strings or null/empty to clear. Whitelist only.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return DATE_RE.test(v.trim()) ? v.trim() : null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token } = auth;
    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    const body = await req.json().catch(() => ({}));
    const b = body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if ("policy_from_date" in b) patch.policy_from_date = dateOrNull(b.policy_from_date);
    if ("policy_to_date" in b)   patch.policy_to_date   = dateOrNull(b.policy_to_date);
    if (Object.keys(patch).length === 0) return err("Nothing to save.", 400);

    const supabase = dbAs(token);
    const { error: updErr } = await supabase.from("insurance_applications").update(patch).eq("id", id);
    if (updErr) return err(`Save failed: ${updErr.message}`, 500);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = errText(e);
    console.error("[insurance/save-policy] error:", msg);
    return err(msg, 500);
  }
}
