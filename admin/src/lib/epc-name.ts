// The EPC partner's own display name for their portal greeting (+ its logo).
//
// The login/token only carries `contact_name` (the point-of-contact person),
// but the partner should be greeted by their BUSINESS name — so we read
// trade_name / legal_name from epc_business (RLS scopes it to the caller's own
// row) and shorten it by dropping the legal suffix:
//   "Ayush Solutions Private Limited" → "Ayush Solutions"

import { supabase } from "./supabase";
import { getBusiness } from "./auth";

// Trailing corporate/legal words to drop from a business name.
const SUFFIX = new Set([
  "private", "limited", "pvt", "ltd", "llp", "company", "co",
  "incorporated", "inc", "corporation", "corp", "enterprise", "enterprises",
]);

export function shortEpcName(name: string | null | undefined): string {
  const s = (name || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  const words = s.split(" ");
  while (words.length > 1) {
    const last = words[words.length - 1].toLowerCase().replace(/[.,&()]/g, "");
    if (last === "" || SUFFIX.has(last)) words.pop();
    else break;
  }
  return words.join(" ");
}

// The name + the company logo (epc_org_profile, 0116) come in ONE read, cached
// per business id — so logging in as a DIFFERENT EPC (without a full page
// reload, which would clear this module) refetches rather than showing the
// previous partner's name / logo.
type Profile = { name: string; logo: string | null };
let cached: { id: string; p: Promise<Profile> } | null = null;

function load(): Promise<Profile> {
  const b = getBusiness();
  const fallback = shortEpcName(b?.contact_name) || "there";
  if (!b?.id) return Promise.resolve({ name: fallback, logo: null });
  if (cached && cached.id === b.id) return cached.p;
  const id = b.id;
  const p = (async (): Promise<Profile> => {
    const { data, error } = await supabase()
      .from("epc_business")
      .select("trade_name, legal_name, contact_name, epc_org_profile(logo_path)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    const name = data?.trade_name || data?.legal_name || data?.contact_name || b.contact_name;
    const org = data?.epc_org_profile as { logo_path: string | null } | { logo_path: string | null }[] | null | undefined;
    return { name: shortEpcName(name) || fallback, logo: (Array.isArray(org) ? org[0] : org)?.logo_path ?? null };
  })().catch(() => {
    if (cached?.p === p) cached = null; // retried on the next call
    return { name: fallback, logo: null };
  });
  cached = { id, p };
  return p;
}

// Fetch the current EPC's short business name (cached per business for the
// session). Falls back to a shortened contact_name, then "there", so a greeting
// always renders.
export async function fetchEpcName(): Promise<string> {
  return (await load()).name;
}

/** The current EPC's logo path (null = none) — from the same cached read as the name. */
export async function fetchEpcLogo(): Promise<string | null> {
  return (await load()).logo;
}

/** After an upload / removal, so every page shows the new logo without a re-read. */
export function setEpcLogo(path: string | null) {
  if (cached) cached = { id: cached.id, p: cached.p.then((x) => ({ ...x, logo: path })) };
}
