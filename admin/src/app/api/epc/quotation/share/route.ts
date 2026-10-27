// POST /api/epc/quotation/share — a link to one of a customer's documents
// (quotation | pcr | agreement) for Sustera Ventures to send on WhatsApp.
// Builds the PDF from the saved form values, keeps it in private Cloud Storage
// and returns a portal link to it (lib/file-links, 90 days). The same values
// map to the same file, so sending again overwrites instead of piling up.
// Body: the saved form values + { doc, date }. Auth: the caller's token — only
// an EPC with the gozerobils template.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { epcQuoteTemplate } from "@/lib/quotation";
import { buildSarvatraFile } from "@/lib/quotation-sarvatra";
import { SARVATRA } from "@/lib/quotation-brands";
import { uploadBuffer } from "@/lib/gcs";
import { fileLinkUrl } from "@/lib/file-links";
import { publicOrigin } from "@/lib/login-password-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const db = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tpl = await epcQuoteTemplate(db, claims.business_id);
    if (tpl?.storage_path !== SARVATRA.key) return err("Not available for your account.", 403);
    if (!(Number(b.price) > 0) || !(Number(b.kw) > 0)) return err("This customer has no system size or price.", 400);

    const doc = String(b.doc ?? "");
    const file = await buildSarvatraFile(doc, b, String(b.date ?? "") || new Date());
    if (!file) return err("Unknown document.", 400);

    const key = createHash("sha256").update(JSON.stringify(b)).digest("hex").slice(0, 20);
    const path = `customer-docs/${claims.business_id}/${doc}-${key}.pdf`;
    await uploadBuffer(path, Buffer.from(file.pdf), "application/pdf");
    return NextResponse.json({ ok: true, url: fileLinkUrl(publicOrigin(req), path), file: file.name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[epc/quotation/share] error:", msg);
    return err(msg, 500);
  }
}
