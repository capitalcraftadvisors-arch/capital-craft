// The EPC partner's own display name for their portal greeting.
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

let cached: string | null = null;

// Fetch the current EPC's short business name (cached for the session). Falls
// back to a shortened contact_name, then "there", so a greeting always renders.
export async function fetchEpcName(): Promise<string> {
  if (cached) return cached;
  const b = getBusiness();
  const fallback = shortEpcName(b?.contact_name) || "there";
  if (!b?.id) return fallback;
  try {
    const { data } = await supabase()
      .from("epc_business")
      .select("trade_name, legal_name, contact_name")
      .eq("id", b.id)
      .maybeSingle();
    const name = data?.trade_name || data?.legal_name || data?.contact_name || b.contact_name;
    cached = shortEpcName(name) || fallback;
    return cached;
  } catch {
    return fallback;
  }
}
