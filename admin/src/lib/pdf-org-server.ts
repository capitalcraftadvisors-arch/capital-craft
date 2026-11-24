// Server-only. The letterhead of the EPC's own PDFs (the standard quotation,
// the tax invoice): the organization (StdOrg) from an epc_business row with its
// epc_org_profile embedded, its logo / signature / stamp from storage, and the
// Capital Craft mark for the footer. Each PDF keeps its own column list.

import fs from "fs";
import path from "path";
import { downloadBuffer } from "./gcs";
import type { StdOrg } from "./quotation-standard";
import type { OrgProfile } from "./org-profile";
import { formatGstAddress } from "./gst-address";
import { stateOfGstin } from "./india-states";

let ccMark: Buffer | null | undefined;
/** public/brand/capital-craft-mark.png, read once (null when missing). */
export function mark(): Buffer | null {
  if (ccMark === undefined) {
    try { ccMark = fs.readFileSync(path.join(process.cwd(), "public", "brand", "capital-craft-mark.png")); } catch { ccMark = null; }
  }
  return ccMark;
}
const image = (p: string | null | undefined) => (p ? downloadBuffer(p).catch(() => null) : Promise.resolve(null));

/** The organization as the PDFs print it (+ the profile row, for extra fields). */
export async function stdOrgOf(biz: Record<string, any>): Promise<{ org: StdOrg; op: OrgProfile | null }> {
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
  return { org, op };
}
