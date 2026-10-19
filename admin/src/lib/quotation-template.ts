// The signed-in EPC's quotation template (storage_path + next serial no.) — one
// lookup shared by the dashboard (shows the builder only when there is one) and
// the builder page (picks the form), so opening the builder from the dashboard
// costs no extra request. Cached per business, like fetchEpcName.

import { supabase } from "./supabase";
import { getBusiness } from "./auth";

export type QuoteTemplate = { storage_path: string; serial_next: number | null };

let cached: { id: string; tpl: QuoteTemplate | null } | null = null;

/** null = no template. `fresh` re-reads (the dashboard, on each load). Throws if the read fails. */
export async function fetchQuoteTemplate(fresh = false): Promise<QuoteTemplate | null> {
  const id = getBusiness()?.id ?? "";
  if (!fresh && cached?.id === id) return cached.tpl;
  const { data, error } = await supabase().from("epc_quotation_templates")
    .select("storage_path, serial_next").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  cached = { id, tpl: data };
  return data;
}
