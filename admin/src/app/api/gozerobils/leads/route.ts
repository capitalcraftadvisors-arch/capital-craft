// POST /api/gozerobils/leads   (secret key in the x-api-key header)
//
// The gozerobils.com server sends each solar enquiry here. The key is checked
// in the database (gozerobils_save_lead, migration 0123 — only its hash is
// stored), then the row is saved in gozerobils_leads and shows in the admin
// console's "gozerobils Leads" window. The same submission_id sent again
// updates that row.
//
// Body (JSON): submission_id*, mobile*, name, pincode, city, state,
//   monthly_bill, looking_for, timeline, utm_source, utm_medium, utm_campaign,
//   utm_content, utm_term, landing_page
// Answers: 201 {ok, id, created:true} · 200 {ok, id, created:false} ·
//   401 bad key · 400 bad data

import { NextRequest, NextResponse } from "next/server";
import { err, publicDb } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = [
  "submission_id", "mobile", "name", "pincode", "city", "state",
  "monthly_bill", "looking_for", "timeline",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "landing_page",
] as const;

export async function POST(req: NextRequest) {
  try {
    const key = (req.headers.get("x-api-key") ?? "").trim();
    // Keys are 32 random bytes in hex — anything else is refused here, without a
    // database request (each request counts on the Free plan).
    if (!/^[0-9a-f]{64}$/i.test(key)) return err("unauthorized", 401);

    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b !== "object" || Array.isArray(b)) return err("Send a JSON object.", 400);

    const lead: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = b[f];
      if (typeof v === "string" || typeof v === "number") lead[f] = String(v).slice(0, 500);
    }

    const { data, error } = await publicDb().rpc("gozerobils_save_lead", { p_key: key, p_lead: lead });
    if (error) return err(error.message, 500);

    const r = (data ?? {}) as { ok?: boolean; error?: string; id?: string; created?: boolean };
    if (!r.ok) return err(r.error || "not_saved", r.error === "invalid_key" ? 401 : 400);
    return NextResponse.json({ ok: true, id: r.id, created: !!r.created }, { status: r.created ? 201 : 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[gozerobils/leads] error:", msg);
    return err(msg, 500);
  }
}
