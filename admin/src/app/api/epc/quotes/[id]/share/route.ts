// POST /api/epc/quotes/<id>/share — one-tap WhatsApp share of a saved quotation
// (Partner Portal v2). Paid: only with WhatsApp switched on for the EPC
// (epc_subscriptions, 0128). Builds the PDF (lib/quote-pdf-server), keeps it in
// private Cloud Storage (sharing again overwrites it) and returns a portal link to
// it (lib/file-links, 90 days) for the message. Read with the caller's token.

import { NextRequest, NextResponse } from "next/server";
import { verifyJwt, getBearerToken } from "@/lib/jwt";
import { insuranceClient as userClient, UUID_RE } from "@/lib/insurance-server";
import { buildSavedQuotePdf } from "@/lib/quote-pdf-server";
import { SUBSCRIPTION_MSG } from "@/lib/custom-template";
import { uploadBuffer } from "@/lib/gcs";
import { fileLinkUrl } from "@/lib/file-links";
import { publicOrigin } from "@/lib/login-password-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token || !(await verifyJwt(token).catch(() => null))) return err("unauthorized", 401);
    if (!UUID_RE.test(params.id)) return err("not_found", 404);
    const db = userClient(token);
    const claims = await verifyJwt(token);
    const { data: on } = await db.rpc("epc_has_feature", { p_business: claims.business_id, p_feature: "whatsapp" });
    if (on !== true) return err(SUBSCRIPTION_MSG, 403);

    const pdf = await buildSavedQuotePdf(db, params.id);
    if (!pdf) return err("not_found", 404);
    const path = `customer-docs/${pdf.businessId}/quote-${params.id}.pdf`;
    await uploadBuffer(path, Buffer.from(pdf.bytes), "application/pdf");
    return NextResponse.json({
      ok: true, url: fileLinkUrl(publicOrigin(req), path),
      customer: pdf.doc.customer?.name || "", mobile: pdf.doc.customer?.mobile || "", kw: pdf.doc.kw || null, org: pdf.orgName,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[epc/quotes/share] error:", msg);
    return err(msg, 500);
  }
}
