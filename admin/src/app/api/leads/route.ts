// POST /api/leads   (PUBLIC — no auth)
//
// The non-EPC customer lead form on the marketing site posts here. Anyone can
// submit a lead; the row lands in customer_leads (source='non_epc') and shows
// up in the admin console's "Leads" tab for the team to follow up.
//
// Insert only — RLS (migration 0051) lets the anon role INSERT but not read,
// and only admins can read/update. Basic server-side validation below.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const MOBILE_RE = /^[6-9]\d{9}$/;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const str = (v: unknown): string | null => {
      const s = String(v ?? "").trim();
      return s ? s : null;
    };
    const upper = (v: unknown): string | null => {
      const s = str(v);
      return s ? s.toUpperCase() : null;
    };
    const numOrNull = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const lead_type = String(b.lead_type ?? "").trim();
    if (lead_type !== "loan" && lead_type !== "insurance") {
      return err("Please choose Loan or Insurance.", 400);
    }
    const mobile = String(b.mobile ?? "").replace(/\D/g, "");
    if (!MOBILE_RE.test(mobile)) {
      return err("Enter a valid 10-digit mobile number.", 400);
    }

    const row = {
      lead_type,
      mobile,
      name:         str(b.name),
      city:         str(b.city),
      pincode:      str(b.pincode),
      pan:          upper(b.pan),
      aadhaar:      str(b.aadhaar)?.replace(/\s+/g, "") ?? null,
      project_cost: numOrNull(b.project_cost),
      loan_amount:  numOrNull(b.loan_amount),
      plant_value:  numOrNull(b.plant_value),
      gstin:        upper(b.gstin),
      source:       "non_epc",
    };

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from("customer_leads").insert(row);
    if (error) return err(error.message, 500);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[leads] error:", msg);
    return err(msg, 500);
  }
}
