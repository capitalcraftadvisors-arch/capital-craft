// POST /api/epc/quotes/<id>/proposal — a public proposal link for a saved
// quotation (Partner Portal v2, epc_proposals 0129): the Owner, a Manager or
// Sales. Builds the PDF (lib/quote-pdf-server), keeps it in private Cloud
// Storage (proposals/<business>/<token>.pdf) and adds the proposal row with what
// the customer sees (the snapshot) — with the caller's token, so RLS decides who
// may. Returns the link to the customer's page (/p/<token>).

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { buildSavedQuotePdf } from "@/lib/quote-pdf-server";
import { quoteTotals } from "@/lib/quote-calc";
import { uploadBuffer, deleteObject } from "@/lib/gcs";
import { publicOrigin } from "@/lib/login-password-server";
import type { ProposalSnapshot } from "@/lib/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_ACCESS = "You don't have access to make a proposal link.";

type Contact = { contact_mobile: string | null; contact_email: string | null; epc_org_profile: { phone: string | null; email: string | null } | { phone: string | null; email: string | null }[] | null };

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;
    if (!UUID_RE.test(params.id)) return err("not_found", 404);
    if (claims.business_type === "admin" || claims.member_role === "VIEWER" || claims.member_role === "SITE") return err(NO_ACCESS, 403);
    const db = dbAs(token);

    // The PDF and the company's phone / email (the same ones the PDF prints) in parallel.
    const [pdf, contact] = await Promise.all([
      buildSavedQuotePdf(db, params.id),
      db.from("epc_business").select("contact_mobile, contact_email, epc_org_profile(phone, email)").eq("id", claims.business_id).maybeSingle(),
    ]);
    if (!pdf) return err("This quotation was not found.", 404);
    const c = contact.data as Contact | null;
    const op = Array.isArray(c?.epc_org_profile) ? c?.epc_org_profile[0] : c?.epc_org_profile;

    const doc = pdf.doc;
    const t = quoteTotals(doc, ""); // the state only splits the tax (CGST + SGST / IGST), never the total
    const snapshot: ProposalSnapshot = {
      customer_name: doc.customer?.name?.trim() || "",
      mobile: doc.customer?.mobile || "",
      city: "",
      kw: doc.kw || null,
      total: t.total,
      net: doc.segment === "residential" && t.eligible ? t.net : null,
      quote_no: pdf.quoteNo,
      quote_date: doc.date,
      valid_till: doc.valid_till || null,
      segment: doc.segment,
      org: { name: pdf.orgName, phone: op?.phone || c?.contact_mobile || "", email: op?.email || c?.contact_email || "" },
      lines: (doc.items ?? []).filter((it) => it.item?.trim()).slice(0, 30).map((it) => ({
        description: [it.item.trim(), it.spec?.trim()].filter(Boolean).join(" — "),
        make: it.make?.trim() || "",
        qty: [it.qty?.trim(), it.unit?.trim()].filter(Boolean).join(" "),
      })),
    };

    // EPCs can't update a proposal row, so the token is made here and the row goes in after the upload.
    const proposal = randomUUID().replace(/-/g, "");
    const path = `proposals/${pdf.businessId}/${proposal}.pdf`;
    try {
      await uploadBuffer(path, Buffer.from(pdf.bytes), "application/pdf");
    } catch (e) {
      console.error("[epc/quotes/proposal] upload:", e instanceof Error ? e.message : e);
      return err("Couldn't save the quotation PDF. Please try again.", 502);
    }
    const { error } = await db.from("epc_proposals").insert({
      token: proposal, business_id: pdf.businessId, quote_id: params.id, snapshot, pdf_path: path,
    });
    if (error) {
      await deleteObject(path).catch(() => {});
      if (/row-level|42501|permission/i.test(`${error.code} ${error.message}`)) return err(NO_ACCESS, 403);
      console.error("[epc/quotes/proposal] insert:", error.message);
      return err("Couldn't make the proposal link. Please try again.", 500);
    }
    return NextResponse.json({ ok: true, url: `${publicOrigin(req)}/p/${proposal}`, org: pdf.orgName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[epc/quotes/proposal] error:", msg);
    return err("Couldn't make the proposal link. Please try again.", 500);
  }
}
