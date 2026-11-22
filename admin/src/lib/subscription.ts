// Paid features an EPC has (epc_subscriptions, 0128 / 0129) — WhatsApp and
// Invoices, each until an optional end date. CC switches them on per EPC from the
// EPC profile; until then (or after the end date) the buttons show a lock
// (SUBSCRIPTION_MSG). The server checks again on every invoice / WhatsApp action
// (epc_has_feature). One small read, kept for a while in the tab.

import { supabase } from "./supabase";
import { getBusiness } from "./auth";
import { getCached, setCached } from "./list-cache";

export { SUBSCRIPTION_MSG } from "./custom-template";

export type Feature = "whatsapp" | "invoices";
export type Subscription = { whatsapp: boolean; invoices: boolean; valid_until: string | null };
const NONE: Subscription = { whatsapp: false, invoices: false, valid_until: null };
const TTL = 15 * 60_000;

/** On, and not past its end date (India time). */
export function hasFeature(s: Subscription | null | undefined, f: Feature): boolean {
  if (!s || !s[f]) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); // YYYY-MM-DD
  return !s.valid_until || s.valid_until >= today;
}

/** The signed-in EPC's subscription. */
export async function fetchSubscription(): Promise<Subscription> {
  const key = `subscription.${getBusiness()?.id ?? ""}`;
  const hit = getCached<Subscription>(key, TTL);
  if (hit) return hit;
  const { data } = await supabase().from("epc_subscriptions").select("whatsapp, invoices, valid_until").maybeSingle();
  const s = (data as Subscription | null) ?? NONE;
  setCached(key, s);
  return s;
}

/** Does the signed-in EPC have WhatsApp today? */
export const fetchWhatsAppOn = async () => hasFeature(await fetchSubscription(), "whatsapp");
