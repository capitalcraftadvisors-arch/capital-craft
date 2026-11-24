// An EPC's own leads and follow-ups (epc_leads, 0127) â€” Partner Portal v2, phase 1.
// RLS scopes every read to the caller's company (Sales: the leads they own).
// The list is one narrow read kept for a few minutes in the tab (list-cache) and
// dropped on every save / delete. The follow-ups due feed the Leads badge from
// this browser's copy (localStorage), refreshed with any list read and at most
// once a day otherwise â€” no read of its own on other pages.

import { supabase } from "./supabase";
import { getBusiness } from "./auth";
import { getCached, invalidate, setCached } from "./list-cache";
import { localIsoDate } from "./dates";
import { dashboardChanged } from "./dashboard-v2";

export type LeadStatus = "new" | "contacted" | "quoted" | "won" | "lost";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "quoted", "won", "lost"];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", quoted: "Quotation sent", won: "Won", lost: "Lost",
};
export const LEAD_STATUS_PILL: Record<LeadStatus, string> = {
  new: "bg-navy-tint text-navy", contacted: "bg-[#fdf3e2] text-warn-ink", quoted: "bg-[#efedff] text-[#5b3fc4]",
  won: "bg-cc-tint text-cc-green", lost: "bg-grey-chip text-[#475569]",
};

export type LeadRow = {
  id: string; name: string; mobile: string | null; city: string | null;
  kw: number | null; project_cost: number | null; status: LeadStatus;
  follow_up_at: string | null; notes: string | null;
  owner_member_id: string | null; owner: { name: string } | null; // null = the owner
  application_id: string | null; // the loan applied for from this lead
  created_at: string;
};
export type LeadInput = Pick<LeadRow, "name" | "mobile" | "city" | "kw" | "project_cost" | "status" | "follow_up_at" | "notes" | "owner_member_id">;

const COLS = "id, name, mobile, city, kw, project_cost, status, follow_up_at, notes, owner_member_id, application_id, created_at, " +
  "owner:epc_members!epc_leads_owner_member_id_fkey(name)";
const who = () => `${getBusiness()?.id ?? ""}.${getBusiness()?.member?.id ?? ""}`;
const LIST_TTL = 5 * 60_000;
type Raw = Omit<LeadRow, "owner"> & { owner: { name: string } | { name: string }[] | null };
const row = (r: Raw): LeadRow => ({ ...r, owner: Array.isArray(r.owner) ? r.owner[0] ?? null : r.owner });

/** Open (not won / lost) with a follow-up today or earlier. */
export const isDue = (r: Pick<LeadRow, "status" | "follow_up_at">, today = localIsoDate(new Date())) =>
  !!r.follow_up_at && r.follow_up_at <= today && r.status !== "won" && r.status !== "lost";

// â”€â”€ Follow-ups due (the badge) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DUE_KEY = () => `cc_leads_due:${who()}`;
const DUE_EVENT = "cc-leads-due";
function keepDue(rows: LeadRow[]) {
  const dates = rows.filter((r) => r.follow_up_at && r.status !== "won" && r.status !== "lost").map((r) => r.follow_up_at as string);
  try { localStorage.setItem(DUE_KEY(), JSON.stringify({ day: localIsoDate(new Date()), dates })); } catch { /* best effort */ }
  window.dispatchEvent(new Event(DUE_EVENT));
}
/** Follow-ups due now from this browser's copy; null when there is none from today. */
function dueFromCopy(): number | null {
  try {
    const c = JSON.parse(localStorage.getItem(DUE_KEY()) || "null") as { day: string; dates: string[] } | null;
    const today = localIsoDate(new Date());
    return c && c.day === today ? c.dates.filter((d) => d <= today).length : null;
  } catch { return null; }
}
/** The badge count: the copy, else one list read (at most once a day). Calls back on every change. */
export function watchDue(cb: (n: number) => void): () => void {
  const update = () => { const n = dueFromCopy(); if (n !== null) cb(n); };
  window.addEventListener(DUE_EVENT, update);
  if (dueFromCopy() === null) fetchLeads().catch(() => keepDue([])); else update(); // a failed read isn't retried until tomorrow
  return () => window.removeEventListener(DUE_EVENT, update);
}

// â”€â”€ Reads / writes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** The company's leads (Sales: their own), newest first (the latest 500). */
export async function fetchLeads(): Promise<LeadRow[]> {
  const key = `leads.${who()}`;
  const hit = getCached<LeadRow[]>(key, LIST_TTL);
  if (hit) return hit;
  const { data, error } = await supabase().from("epc_leads").select(COLS).order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as Raw[]).map(row);
  setCached(key, rows);
  keepDue(rows);
  return rows;
}

export async function saveLead(id: string | null, v: LeadInput): Promise<LeadRow> {
  const cols = { ...v, name: v.name.trim(), mobile: v.mobile || null, city: v.city?.trim() || null, notes: v.notes?.trim() || null };
  const q = id
    ? supabase().from("epc_leads").update(cols).eq("id", id).select(COLS).single()
    : supabase().from("epc_leads").insert({ ...cols, business_id: getBusiness()?.id }).select(COLS).single();
  const { data, error } = await q;
  if (error) throw error;
  invalidate(`leads.${who()}`); dashboardChanged();
  return row(data as unknown as Raw);
}

export async function deleteLead(id: string) {
  const { error } = await supabase().from("epc_leads").delete().eq("id", id);
  if (error) throw error;
  invalidate(`leads.${who()}`); dashboardChanged();
}

/** The loan chat started an application from this lead (/dashboard/apply/chat?lead=<id>). */
export async function linkLeadLoan(id: string, applicationId: string) {
  await supabase().from("epc_leads").update({ application_id: applicationId }).eq("id", id);
  invalidate(`leads.${who()}`); dashboardChanged();
}

/** The list changed on this page (a save / delete) â€” refresh the badge from it. */
export const leadsChanged = (rows: LeadRow[]) => keepDue(rows);

/** Has another EPC already filed a loan for this mobile? (yes / no only â€” 0127) */
export async function filedElsewhere(mobile: string): Promise<boolean> {
  const { data } = await supabase().rpc("epc_customer_taken", { p_mobile: mobile, p_pan: null });
  return !!(data as { mobile?: boolean } | null)?.mobile;
}
