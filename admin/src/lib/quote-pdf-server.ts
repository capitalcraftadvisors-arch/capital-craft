// Server-only. A saved quotation (epc_quotes, 0118) as the standard PDF
// (lib/quotation-standard), built from the quotation + the EPC's organization
// settings (one read, the profile embedded) + its branding images. Read with the
// caller's client: RLS decides who may. Used by the download and the WhatsApp share.

import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeName } from "./insurance-server";
import { downloadBuffer } from "./gcs";
import { buildStandardQuotation, type StdOrg } from "./quotation-standard";
import { ORG_COLS, type OrgProfile } from "./org-profile";
import { formatGstAddress } from "./gst-address";
import { stateOfGstin } from "./india-states";
import type { QuoteDoc } from "./quote-calc";

const ORG_SELECT = "trade_name, legal_name, gstin_number, gst_address, contact_name, contact_mobile, contact_email, " +
  `bank_name, bank_account_holder, bank_account_number, bank_ifsc, bank_branch, epc_org_profile(${ORG_COLS})`;

let ccMark: Buffer | null | undefined;
function mark(): Buffer | null {
  if (ccMark === undefined) {
    try { ccMark = fs.readFileSync(path.join(process.cwd(), "public", "brand", "capital-craft-mark.png")); } catch { ccMark = null; }
  }
  return ccMark;
}
const image = (p: string | null | undefined) => (p ? downloadBuffer(p).catch(() => null) : Promise.resolve(null));

export type SavedQuotePdf = { bytes: Uint8Array; name: string; quoteNo: string; doc: QuoteDoc; businessId: string; orgName: string };

/** The quotation's PDF, or null when the caller can't read it. */
export async function buildSavedQuotePdf(db: SupabaseClient, id: string): Promise<SavedQuotePdf | null> {
  const { data: q } = await db.from("epc_quotes").select("quote_no, business_id, payload").eq("id", id).maybeSingle();
  if (!q) return null;
  const { data: b } = await db.from("epc_business").select(ORG_SELECT).eq("id", q.business_id).maybeSingle();
  if (!b) return null;
  const biz = b as Record<string, any>;
  const op = (Array.isArray(biz.epc_org_profile) ? biz.epc_org_profile[0] : biz.epc_org_profile) as OrgProfile | null;

  const [logo, signature, stamp] = await Promise.all([image(op?.logo_path), image(op?.signature_path), image(op?.stamp_path)]);
  const own = [op?.address_line, op?.city, [op?.state, op?.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const org: StdOrg = {
    name: op?.display_name || biz.trade_name || biz.legal_name || "",
    address: own || formatGstAddress(biz.gst_address),
    gstin: biz.gstin_number || "",
    phone: op?.phone || biz.contact_mobile || "",
    email: op?.email || biz.contact_email || "",
    website: op?.website || "",
    contact: biz.contact_name || "",
    state: stateOfGstin(biz.gstin_number) || op?.state || "",
    accent: op?.accent ?? null,
    bank: biz.bank_account_number ? { name: biz.bank_name || "", holder: biz.bank_account_holder || "", account: biz.bank_account_number, ifsc: biz.bank_ifsc || "", branch: biz.bank_branch || "" } : null,
    logo, signature, stamp,
  };

  const doc = q.payload as QuoteDoc;
  const bytes = await buildStandardQuotation(doc, q.quote_no, org, mark());
  const name = `Quotation ${safeName(q.quote_no, "quote")} - ${safeName(doc.customer?.name || "customer", "customer")}.pdf`;
  return { bytes, name, quoteNo: q.quote_no, doc, businessId: q.business_id, orgName: org.name };
}
