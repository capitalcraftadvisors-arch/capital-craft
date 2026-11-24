// Server-only. A saved quotation (epc_quotes, 0118) as the standard PDF
// (lib/quotation-standard), built from the quotation + the EPC's organization
// settings (one read, the profile embedded) + its branding images. Read with the
// caller's client: RLS decides who may. Used by the download and the WhatsApp share.

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeName } from "./upload-rules";
import { buildStandardQuotation } from "./quotation-standard";
import { ORG_COLS } from "./org-profile";
import { mark, stdOrgOf } from "./pdf-org-server";
import type { QuoteDoc } from "./quote-calc";

const ORG_SELECT = "trade_name, legal_name, gstin_number, gst_address, contact_name, contact_mobile, contact_email, " +
  `bank_name, bank_account_holder, bank_account_number, bank_ifsc, bank_branch, epc_org_profile(${ORG_COLS})`;

export type SavedQuotePdf = { bytes: Uint8Array; name: string; quoteNo: string; doc: QuoteDoc; businessId: string; orgName: string };

/** The quotation's PDF, or null when the caller can't read it. */
export async function buildSavedQuotePdf(db: SupabaseClient, id: string): Promise<SavedQuotePdf | null> {
  const { data: q } = await db.from("epc_quotes").select("quote_no, business_id, payload").eq("id", id).maybeSingle();
  if (!q) return null;
  const { data: b } = await db.from("epc_business").select(ORG_SELECT).eq("id", q.business_id).maybeSingle();
  if (!b) return null;
  const biz = b as Record<string, any>;
  const { org } = await stdOrgOf(biz);

  const doc = q.payload as QuoteDoc;
  const bytes = await buildStandardQuotation(doc, q.quote_no, org, mark());
  const name = `Quotation ${safeName(q.quote_no, "quote")} - ${safeName(doc.customer?.name || "customer", "customer")}.pdf`;
  return { bytes, name, quoteNo: q.quote_no, doc, businessId: q.business_id, orgName: org.name };
}
