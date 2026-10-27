// POST /api/epc/quotation/email — Sustera Ventures (gozerobils) emails one of a
// customer's documents (quotation | pcr | agreement) from its own Gmail
// (SARVATRA.sender, app password SUSTERA_GMAIL_APP_PASSWORD), the PDF attached.
// Body: the saved form values + { doc, date, to, cc, bcc, subject, message }.
// Auth: the caller's token — only an EPC with the gozerobils template.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { epcQuoteTemplate } from "@/lib/quotation";
import { buildSarvatraFile } from "@/lib/quotation-sarvatra";
import { SARVATRA } from "@/lib/quotation-brands";
import { sendMailAs } from "@/lib/mailer";
import { EMAIL_RE } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : []);

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

    const pass = process.env.SUSTERA_GMAIL_APP_PASSWORD || "";
    if (!pass) return err(`Email isn't set up yet — the app password for ${SARVATRA.sender} is missing.`, 503);

    const to = String(b.to ?? "").trim().toLowerCase();
    const cc = list(b.cc), bcc = list(b.bcc);
    if (!EMAIL_RE.test(to)) return err("Enter a valid TO email.", 400);
    if ([...cc, ...bcc].some((e) => !EMAIL_RE.test(e))) return err("A CC / BCC address isn't valid.", 400);
    const subject = String(b.subject ?? "").trim();
    if (!subject) return err("Enter a subject.", 400);
    if (!(Number(b.price) > 0) || !(SARVATRA.kwOf(b.kw) > 0)) return err("This customer has no system size or price.", 400);

    const file = await buildSarvatraFile(String(b.doc ?? ""), b, String(b.date ?? "") || new Date());
    if (!file) return err("Unknown document.", 400);

    const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#12271f;line-height:1.6">${
      String(b.message ?? "").trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`).join("")
    }</div>`;
    await sendMailAs({ user: SARVATRA.sender, pass, name: SARVATRA.senderName }, {
      to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}), subject, html,
      attachments: [{ filename: file.name, content: Buffer.from(file.pdf) }],
    });
    return NextResponse.json({ ok: true, sent_to: to, file: file.name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[epc/quotation/email] error:", msg);
    return err(msg, 500);
  }
}
