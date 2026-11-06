// Saved quotations in the partner portal (epc_quotes, 0118) — the list, one
// quotation, save / delete, and the PDF download. RLS scopes every read to the
// caller's own company. The list is one narrow read (no payload), kept for a
// few minutes in the tab (list-cache) and dropped on every save / delete.

import { supabase } from "./supabase";
import { getBusiness, getToken } from "./auth";
import { getCached, invalidate, setCached } from "./list-cache";
import { quoteTotals, type QuoteDoc } from "./quote-calc";
import type { Segment } from "./quotation-brands";
import { saveUrl } from "@/components/quotation/form-kit";

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";
export const QUOTE_STATUSES: QuoteStatus[] = ["draft", "sent", "accepted", "declined"];
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined" };
export const QUOTE_STATUS_PILL: Record<QuoteStatus, string> = {
  draft: "bg-[#eef1f5] text-[#475569]", sent: "bg-[#e8effc] text-[#1e3a8a]",
  accepted: "bg-[#e6f6ee] text-[#178a5c]", declined: "bg-red-50 text-red-700",
};

export type QuoteRow = {
  id: string; quote_no: string; status: QuoteStatus; segment: Segment;
  customer_name: string; customer_mobile: string | null; kw: number | null;
  quote_date: string; valid_till: string | null; total: number; net: number | null; created_at: string;
  created_by: { name: string } | null;   // the staff member (0119); null = the owner
};
const LIST_COLS = "id, quote_no, status, segment, customer_name, customer_mobile, kw, quote_date, valid_till, total, net, created_at, " +
  "created_by:epc_members!epc_quotes_created_by_member_fk(name)";
// Per person (a staff login sees its own set — RLS), so the cache key carries the member too.
const listKey = () => `quotes.${getBusiness()?.id ?? ""}.${getBusiness()?.member?.id ?? ""}`;
const LIST_TTL = 5 * 60_000;
// The embedded creator comes back as an object or a one-item list.
type Raw = Omit<QuoteRow, "created_by"> & { created_by: { name: string } | { name: string }[] | null };
const row = (r: Raw): QuoteRow => ({ ...r, created_by: Array.isArray(r.created_by) ? r.created_by[0] ?? null : r.created_by });

/** The company's quotations, newest first (the latest 200). */
export async function fetchQuotes(): Promise<QuoteRow[]> {
  const hit = getCached<QuoteRow[]>(listKey(), LIST_TTL);
  if (hit) return hit;
  const { data, error } = await supabase().from("epc_quotes").select(LIST_COLS).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as Raw[]).map(row);
  setCached(listKey(), rows);
  return rows;
}

export async function fetchQuote(id: string): Promise<{ row: QuoteRow; doc: QuoteDoc }> {
  const { data, error } = await supabase().from("epc_quotes").select(`${LIST_COLS}, payload`).eq("id", id).maybeSingle();
  if (error || !data) throw error ?? new Error("This quotation was not found.");
  const { payload, ...rest } = data as unknown as Raw & { payload: QuoteDoc };
  return { row: row(rest), doc: payload };
}

/** Saves a quotation (a new one gets its number from the series) → the saved row. */
export async function saveQuote(id: string | null, doc: QuoteDoc, status: QuoteStatus, epcState: string): Promise<QuoteRow> {
  const t = quoteTotals(doc, epcState);
  const cols = {
    status, segment: doc.segment, customer_name: doc.customer.name.trim(), customer_mobile: doc.customer.mobile || null,
    kw: doc.kw || null, quote_date: doc.date, valid_till: doc.valid_till || null,
    total: t.total, net: doc.segment === "residential" && t.eligible ? t.net : null,
    payload: doc, updated_at: new Date().toISOString(),
  };
  const q = id
    ? supabase().from("epc_quotes").update(cols).eq("id", id).select(LIST_COLS).single()
    : supabase().from("epc_quotes").insert(cols).select(LIST_COLS).single();
  const { data, error } = await q;
  if (error) throw error;
  invalidate(listKey());
  return row(data as unknown as Raw);
}

export async function setQuoteStatus(id: string, status: QuoteStatus) {
  const { error } = await supabase().from("epc_quotes").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  invalidate(listKey());
}

export async function deleteQuote(id: string) {
  const { error } = await supabase().from("epc_quotes").delete().eq("id", id);
  if (error) throw error;
  invalidate(listKey());
}

/** Builds the PDF on the server and saves it. */
export async function downloadQuotePdf(id: string) {
  const res = await fetch(`/api/epc/quotes/${id}/pdf`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || "Couldn't make the PDF."); }
  const name = ((res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/) || [])[1] || "quotation.pdf";
  const url = URL.createObjectURL(await res.blob());
  saveUrl(url, name);
  URL.revokeObjectURL(url);
}
