// POST /api/epc/quotation — Quotation Builder.
//
// Fills the EPC's quotation template (.docx, their exact format) with the
// 60-second form values and returns a downloadable file:
//   • PDF when LibreOffice is available (prod) — auto-converted,
//   • .docx otherwise (localhost) — identical format, one-click Save-as-PDF.
//
// Template resolution (per EPC): epc_quotation_templates row for the caller's
// business → "bundled:…" reads the app-shipped template, else a GCS object.
// When no row exists yet it falls back to the bundled GHANPRIYA template.
//
// Bijlee Solar (bundled:bijlee) is their own PDF filled directly — always a PDF —
// and its serial number auto-advances (X-Next-Serial tells the form the next one).
//
// Auth: caller's token (RLS scopes the template lookup to the EPC's own row).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { downloadBuffer } from "@/lib/gcs";
import { buildQuotationData, fillTemplate, readBundledTemplate, type QuotationInput } from "@/lib/quotation";
import { docxToPdf } from "@/lib/docx-to-pdf";
import { buildBijleeQuotation, type BijleeInput } from "@/lib/quotation-bijlee";
import { BIJLEE } from "@/lib/quotation-brands";
import { fmtDateIST } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function safeName(s: string): string {
  return (s || "quotation").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "quotation";
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);

    const body = (await req.json().catch(() => ({}))) as Partial<QuotationInput>;
    if (!body.customer_name || !String(body.customer_name).trim()) return err("Customer name is required.", 400);
    if (!body.kw || Number(body.kw) <= 0) return err("System size (kW) is required.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // The EPC must have a configured template — this is rolled out per-EPC, so
    // an EPC without one has no access (no shared default).
    const bizId = claims.business_type === "admin" && body["epc_business_id" as keyof QuotationInput]
      ? String(body["epc_business_id" as keyof QuotationInput])
      : claims.business_id;
    let storagePath = "", templateId = "";
    try {
      const { data: tpl } = await supabase
        .from("epc_quotation_templates")
        .select("id, storage_path")
        .eq("epc_business_id", bizId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tpl?.storage_path) { storagePath = tpl.storage_path; templateId = tpl.id; }
    } catch { /* table missing → treated as no template */ }
    if (!storagePath) return err("No quotation template is set up for your account yet.", 403);

    if (storagePath === BIJLEE.key) {
      const b = body as unknown as Partial<Record<keyof BijleeInput, string | number>>;
      const s = (k: keyof BijleeInput) => String(b[k] ?? "").trim();
      const input: BijleeInput = {
        customer_name: s("customer_name"), location: s("location"), kw: Number(b.kw),
        serial: s("serial"), date: fmtDateIST(new Date()),
        project_location: s("project_location"), client_name: s("client_name"),
        msedcl_division: s("msedcl_division"), contracted_demand: s("contracted_demand"),
        module_brand: s("module_brand") || BIJLEE.module, inverter_brand: s("inverter_brand") || BIJLEE.inverter,
        cable_brand: s("cable_brand") || BIJLEE.cable,
        rate_per_kw: Number(b.rate_per_kw) || 0, structure_rate_per_kw: Number(b.structure_rate_per_kw) || 0,
      };
      if (input.rate_per_kw <= 0) return err("Price per kW is required.", 400);
      const pdf = await buildBijleeQuotation(input, readBundledTemplate(storagePath));
      // Auto-number: the next suggested serial moves past the one just used.
      const used = Number(/\d+/.exec(input.serial)?.[0]);
      let next = "";
      if (used > 0) {
        const { data } = await supabase.rpc("quotation_serial_used", { p_template: templateId, p_used: used });
        if (typeof data === "number") next = BIJLEE.serial(data);
      }
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="Quotation_${safeName(input.customer_name)}_${safeName(input.serial)}.pdf"`,
          "X-Next-Serial": next,
        },
      });
    }

    const templateBuf = storagePath.startsWith("bundled:")
      ? readBundledTemplate(storagePath)
      : await downloadBuffer(storagePath);

    const data = buildQuotationData(body as QuotationInput);
    const docx = fillTemplate(templateBuf, data);

    const base = `Quotation_${safeName(String(body.customer_name))}_${safeName(String(body.quote_no || ""))}`;

    // Try PDF (prod); fall back to .docx (localhost / no LibreOffice).
    try {
      const pdf = docxToPdf(docx);
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${base}.pdf"`,
        },
      });
    } catch {
      return new NextResponse(new Uint8Array(docx), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${base}.docx"`,
        },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[epc/quotation] error:", msg);
    return err(msg, 500);
  }
}
