// gozerobils.com enquiries (gozerobils_leads, 0123 / 0132) — shared by CC's
// gozerobils page (/admin/gozerobils, where they are worked) and Sustera Ventures'
// Partner Portal Leads → Meta tab (read only, 0141): the row, its columns, the call
// outcomes and the small display helpers.

import { supabase } from "./supabase";
import { getBusiness } from "./auth";
import { getCached, setCached } from "./list-cache";

export type GzbLead = {
  id: string; created_at: string;
  name: string | null; mobile: string;
  pincode: string | null; city: string | null; state: string | null;
  monthly_bill: string | null; looking_for: string | null; timeline: string | null;
  utm_source: string | null; utm_campaign: string | null;
  status: string; notes: string | null;
  follow_up_at: string | null; last_call_at: string | null; last_outcome: string | null; call_count: number;
};

export const GZB_LEAD_COLS = "id, created_at, name, mobile, pincode, city, state, monthly_bill, looking_for, timeline, utm_source, utm_campaign, status, notes, " +
  "follow_up_at, last_call_at, last_outcome, call_count";

export const OUTCOMES = ["connected", "interested", "call_back", "not_interested", "no_answer", "busy", "switched_off", "wrong_number"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome, string> = {
  connected: "Connected", interested: "Interested", call_back: "Call back", not_interested: "Not interested",
  no_answer: "No answer", busy: "Busy", switched_off: "Switched off", wrong_number: "Wrong number",
};

// The form's choice keys as words: "premium_solar_system_with_expert_installation" → "Premium solar system with expert installation".
export const words = (v: string | null) => (v ? v.replace(/_+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()) : v);
export const tel = (m: string) => `tel:+91${m}`;

/** Sustera's Meta tab: every enquiry, newest first (the latest 500) — one read, kept a few minutes. */
export async function fetchMetaLeads(): Promise<GzbLead[]> {
  const key = `gzbMeta.${getBusiness()?.id ?? ""}`;
  const hit = getCached<GzbLead[]>(key, 5 * 60_000);
  if (hit) return hit;
  const { data, error } = await supabase().from("gozerobils_leads").select(GZB_LEAD_COLS).order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  const rows = (data ?? []) as unknown as GzbLead[];
  setCached(key, rows);
  return rows;
}
