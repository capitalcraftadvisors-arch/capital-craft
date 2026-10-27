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
// Bijlee Solar (bundled:bijlee) and gozerobils (bundled:sarvatra) are their own
// PDFs filled directly — always a PDF. Bijlee's serial no. auto-advances here
// (X-Next-Serial tells the form the next one). gozerobils is the Customer
// applications flow: `doc` picks the quotation, PCR or agreement, `date` is when
// that document was made (the saved customer_quotations row; its insert trigger
// advances the quote no.).
//
// Auth: caller's token (RLS scopes the template lookup to the EPC's own row).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { downloadBuffer } from "@/lib/gcs";
import { buildQuotationData, fillTemplate, readBundledTemplate, epcQuoteTemplate, type QuotationInput } from "@/lib/quotation";
import { docxToPdf } from "@/lib/docx-to-pdf";
import { buildBijleeQuotation } from "@/lib/quotation-bijlee";
import { buildSarvatraFile, safeFileName as safeName } from "@/lib/quotation-sarvatra";
import { BIJLEE, SARVATRA } from "@/lib/quotation-brands";
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
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);

    const body = (await req.json().catch(() => ({}))) as Partial<QuotationInput>;
    if (!body.customer_name || !String(body.customer_name).trim()) return err("Customer name is required.", 400);
    if (!(SARVATRA.kwOf(body.kw) > 0)) return err("System size (kW) is required.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // The EPC must have a configured template — this is rolled out per-EPC, so
    // an EPC without one has no access (no shared default).
    const bizId = claims.business_type === "admin" && body["epc_business_id" as keyof QuotationInput]
      ? String(body["epc_business_id" as keyof QuotationInput])
      : claims.business_id;
    const tpl = await epcQuoteTemplate(supabase, bizId);
    if (!tpl) return err("No quotation template is set up for your account yet.", 403);
    const { storage_path: storagePath, id: templateId } = tpl;

    if (storagePath === BIJLEE.key || storagePath === SARVATRA.key) {
      const b = body as unknown as Record<string, unknown>;
      const s = (k: string) => String(b[k] ?? "").trim();
      const n = (k: string) => Number(b[k]) || 0;
      const name = safeName(s("customer_name"));
      let file: { name: string; pdf: Uint8Array };
      let next = "";
      if (storagePath === BIJLEE.key) {
        if (n("rate_per_kw") <= 0) return err("Price per kW is required.", 400);
        const today = fmtDateIST(new Date()); // DD/MM/YYYY, India time
        const serial = s("serial");
        const pdf = await buildBijleeQuotation({
          customer_name: s("customer_name"), location: s("location"), kw: n("kw"), serial, date: today,
          project_location: s("project_location"), client_name: s("client_name"),
          msedcl_division: s("msedcl_division"), contracted_demand: s("contracted_demand"),
          module_brand: s("module_brand") || BIJLEE.module, inverter_brand: s("inverter_brand") || BIJLEE.inverter,
          cable_brand: s("cable_brand") || BIJLEE.cable,
          rate_per_kw: n("rate_per_kw"), structure_rate_per_kw: n("structure_rate_per_kw"),
        }, await readBundledTemplate(storagePath));
        file = { name: `Quotation_${name}_${safeName(serial)}.pdf`, pdf };
        // Auto-number: the next suggested serial moves past the one just used.
        const used = BIJLEE.serialNo(serial);
        if (used > 0) {
          const { data } = await supabase.rpc("quotation_serial_used", { p_template: templateId, p_used: used });
          if (typeof data === "number") next = BIJLEE.serial(data);
        }
      } else {
        if (n("price") <= 0) return err("System price is required.", 400);
        const built = await buildSarvatraFile(s("doc"), b, s("date") || new Date());
        if (!built) return err("Unknown document.", 400);
        file = built;
      }
      return new NextResponse(new Uint8Array(file.pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${file.name}"`,
          "X-Next-Serial": next,
        },
      });
    }

    const templateBuf = storagePath.startsWith("bundled:")
      ? await readBundledTemplate(storagePath)
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
