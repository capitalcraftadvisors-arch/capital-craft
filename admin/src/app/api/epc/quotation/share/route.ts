// POST /api/epc/quotation/share — a link to one of a customer's documents
// (quotation | pcr | agreement) for Sustera Ventures to send on WhatsApp.
// Builds the PDF from the saved form values, keeps it in private Cloud Storage
// and returns a portal link to it (lib/file-links, 90 days). The same values
// map to the same file, so sending again overwrites instead of piling up.
// Body: the saved form values + { doc, date }. Auth: the caller's token — only
// an EPC with the gozerobils template.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { err, dbAs, requireLogin } from "@/lib/api";
import { epcQuoteTemplate } from "@/lib/quotation";
import { buildSarvatraFile } from "@/lib/quotation-sarvatra";
import { SARVATRA } from "@/lib/quotation-brands";
import { SUBSCRIPTION_MSG } from "@/lib/custom-template";
import { uploadBuffer } from "@/lib/gcs";
import { fileLinkUrl } from "@/lib/file-links";
import { publicOrigin } from "@/lib/login-password-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const db = dbAs(token);
    const tpl = await epcQuoteTemplate(db, claims.business_id);
    if (tpl?.storage_path !== SARVATRA.key) return err("Not available for your account.", 403);
    // WhatsApp sending comes with the subscription (CC's On switch, 0122).
    if (!tpl.unlocked) return err(SUBSCRIPTION_MSG, 403);
    if (!(Number(b.price) > 0) || !(SARVATRA.kwOf(b.kw) > 0)) return err("This customer has no system size or price.", 400);

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
