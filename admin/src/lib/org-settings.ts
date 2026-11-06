// The signed-in EPC's organization settings in the browser — one read each,
// cached per business for the session (Settings tabs and the quote editor
// share it), and kept current on save, so moving between them reads nothing.

import { supabase } from "./supabase";
import { getBusiness } from "./auth";
import { setEpcLogo } from "./epc-name";
import { ORG_COLS, ORG_IMAGE_COLUMN, emptyOrgProfile, type OrgImageKind, type OrgProfile } from "./org-profile";

// The KYC details CC verified (epc_business) — read-only in Settings.
export const KYC_COLS = "id, epc_display_id, trade_name, legal_name, business_type, pan_number, gstin_number, gst_address, " +
  "contact_name, contact_designation, contact_mobile, contact_email, " +
  "bank_name, bank_account_holder, bank_account_number, bank_ifsc, bank_branch, stakeholders";
export type Kyc = Record<string, any>;

function cachedRead<T>(read: (id: string) => Promise<T>) {
  let cached: { id: string; p: Promise<T> } | null = null;
  return {
    get(): Promise<T> {
      const id = getBusiness()?.id;
      if (!id) return Promise.reject(new Error("Not signed in."));
      if (cached?.id === id) return cached.p;
      const p = read(id);
      p.catch(() => { if (cached?.p === p) cached = null; }); // retried on the next call
      cached = { id, p };
      return p;
    },
    set(id: string, v: T) { cached = { id, p: Promise.resolve(v) }; },
  };
}

const org = cachedRead<OrgProfile>(async (id) => {
  const { data, error } = await supabase().from("epc_org_profile").select(ORG_COLS).eq("business_id", id).maybeSingle();
  if (error) throw error;
  return { ...emptyOrgProfile(id), ...((data ?? {}) as Partial<OrgProfile>) };
});

const kyc = cachedRead<Kyc>(async (id) => {
  const { data, error } = await supabase().from("epc_business").select(KYC_COLS).eq("id", id).maybeSingle();
  if (error || !data) throw error ?? new Error("Not found.");
  return data as Kyc;
});

export const fetchOrgSettings = () => org.get();
export const fetchKyc = () => kyc.get();

/** Saves some settings (upsert — the row is made on the first save). */
export async function saveOrgSettings(patch: Partial<Omit<OrgProfile, "business_id">>): Promise<OrgProfile> {
  const cur = await org.get();
  const { error } = await supabase().from("epc_org_profile")
    .upsert({ business_id: cur.business_id, ...patch, updated_at: new Date().toISOString() });
  if (error) throw error;
  const next = { ...cur, ...patch };
  org.set(cur.business_id, next);
  return next;
}

/** After /api/epc/org-image changed a branding image. */
export async function setOrgImage(kind: OrgImageKind, path: string | null) {
  const cur = await org.get();
  org.set(cur.business_id, { ...cur, [ORG_IMAGE_COLUMN[kind]]: path });
  if (kind === "logo") setEpcLogo(path);
}
