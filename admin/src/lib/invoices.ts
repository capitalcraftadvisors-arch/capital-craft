// An EPC's GST invoices (epc_invoices, 0129) — Partner Portal v2, a paid feature
// (Invoices subscription). Owner / Admin / Sales issue, Owner / Admin cancel,
// Viewers read and download; Site staff never see them (RLS). The database holds
// the rules: only with the subscription, only once the project is at Installation
// done or later, numbered <prefix><FY>/<001> per financial year, and an issued
// invoice is never changed or deleted — only cancelled (with a reason) and
// re-issued as a new invoice that replaces it. Old invoices stay readable and
// downloadable after the subscription ends.
//
// The list is one narrow read kept for a few minutes in the tab (list-cache); a
// project's invoices come from that copy when there is one, else one read of
// their own. Every issue / cancel updates the copies in place — no reload.

import { supabase } from "./supabase";
import { getBusiness, authHeaders } from "./auth";
import { getCached, setCached } from "./list-cache";
import { invoiceFigures } from "./invoice-calc";
import { SUBSCRIPTION_MSG } from "./subscription";
import { saveDownload } from "./storage";

export type InvoiceStatus = "issued" | "cancelled";
export const INVOICE_STATUSES: InvoiceStatus[] = ["issued", "cancelled"];
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = { issued: "Issued", cancelled: "Cancelled" };
export const INVOICE_STATUS_PILL: Record<InvoiceStatus, string> = {
  issued: "bg-[#e6f6ee] text-[#178a5c]", cancelled: "bg-red-50 text-red-700",
};

export type InvoiceRow = {
  id: string; project_id: string; invoice_no: string; fy: string; invoice_date: string;
  customer_name: string; total: number; status: InvoiceStatus;
  cancel_reason: string | null; cancelled_at: string | null; replaces_id: string | null; created_at: string;
  kw: number | null; // the project's size
};
/** What a new invoice (or a re-issue) is made from. amount = GST-inclusive. */
export type InvoiceInput = {
  project_id: string; invoice_date: string; kw: number | null;
  customer_name: string; customer_address: string; customer_gstin: string; customer_state: string;
  amount: number; epcState: string; replaces_id?: string | null;
};
/** The bill-to details of a saved invoice (a re-issue starts from them). */
export type BillTo = Pick<InvoiceInput, "customer_name" | "customer_address" | "customer_gstin" | "customer_state" | "amount">;

const COLS = "id, project_id, invoice_no, fy, invoice_date, customer_name, total, status, cancel_reason, cancelled_at, replaces_id, created_at, project:epc_projects(kw)";
// Per person (a Sales login sees the invoices of its own projects — RLS), so the key carries the member too.
const who = () => `${getBusiness()?.id ?? ""}.${getBusiness()?.member?.id ?? ""}`;
const listKey = () => `invoices.${who()}`;
const projectKey = (id: string) => `invoices.${who()}.p.${id}`;
const LIST_TTL = 5 * 60_000;
type Raw = Omit<InvoiceRow, "kw"> & { project: { kw: number | null } | { kw: number | null }[] | null };
const row = ({ project, ...r }: Raw): InvoiceRow => {
  const p = Array.isArray(project) ? project[0] ?? null : project;
  return { ...r, total: Number(r.total), kw: p?.kw ?? null };
};

// The database's refusals (0129) in plain words.
function friendly(e: { message?: string; code?: string } | null): Error {
  const m = e?.message || "";
  if (/invoices_locked/.test(m)) return new Error(SUBSCRIPTION_MSG);
  if (/install_first/.test(m)) return new Error("Invoice after Installation done.");
  if (/invoice_final/.test(m)) return new Error("An issued invoice can't be changed. Cancel it and re-issue.");
  if (/replace_cancelled_only/.test(m)) return new Error("Only a cancelled invoice of this project can be re-issued.");
  if (e?.code === "23505") return new Error("This invoice number is already taken. Please try again.");
  if (/row-level|42501/.test(m) || e?.code === "PGRST116") return new Error("You don't have access to do this.");
  return new Error(m || "Something went wrong.");
}

// Keep the tab's copies current after an issue / cancel (no re-read).
function patch(fn: (rows: InvoiceRow[]) => InvoiceRow[], projectId: string) {
  for (const key of [listKey(), projectKey(projectId)]) {
    const hit = getCached<InvoiceRow[]>(key, LIST_TTL);
    if (hit) setCached(key, fn(hit));
  }
}
const upsertRow = (r: InvoiceRow) => (rows: InvoiceRow[]) =>
  rows.some((x) => x.id === r.id) ? rows.map((x) => (x.id === r.id ? r : x)) : [r, ...rows];

/** The company's invoices (Sales: those of their projects), newest first (the latest 500). */
export async function fetchInvoices(): Promise<InvoiceRow[]> {
  const hit = getCached<InvoiceRow[]>(listKey(), LIST_TTL);
  if (hit) return hit;
  const { data, error } = await supabase().from("epc_invoices").select(COLS)
    .order("invoice_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  if (error) throw friendly(error);
  const rows = ((data ?? []) as unknown as Raw[]).map(row);
  setCached(listKey(), rows);
  return rows;
}

/** One project's invoices — from the tab's list copy when there is one. */
export async function fetchProjectInvoices(projectId: string): Promise<InvoiceRow[]> {
  const all = getCached<InvoiceRow[]>(listKey(), LIST_TTL);
  if (all) return all.filter((r) => r.project_id === projectId);
  const hit = getCached<InvoiceRow[]>(projectKey(projectId), LIST_TTL);
  if (hit) return hit;
  const { data, error } = await supabase().from("epc_invoices").select(COLS).eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw friendly(error);
  const rows = ((data ?? []) as unknown as Raw[]).map(row);
  setCached(projectKey(projectId), rows);
  return rows;
}

/** A saved invoice's bill-to details (read when it is re-issued). */
export async function fetchBillTo(id: string): Promise<BillTo> {
  const { data, error } = await supabase().from("epc_invoices")
    .select("customer_name, customer_address, customer_gstin, customer_state, total").eq("id", id).maybeSingle();
  if (error) throw friendly(error);
  if (!data) throw new Error("This invoice was not found.");
  const d = data as Record<string, string | number | null>;
  return {
    customer_name: String(d.customer_name ?? ""), customer_address: String(d.customer_address ?? ""),
    customer_gstin: String(d.customer_gstin ?? ""), customer_state: String(d.customer_state ?? ""), amount: Number(d.total) || 0,
  };
}

/** A loan project's site address (its loan's), read when an invoice form opens; null when there is none. */
export async function fetchSiteAddress(applicationId: string): Promise<{ address: string; state: string } | null> {
  const { data } = await supabase().from("epc_applications")
    .select("install_address, install_city, install_state, install_pincode").eq("id", applicationId).maybeSingle();
  const d = data as Record<string, string | null> | null;
  if (!d) return null;
  const street = (d.install_address ?? "").trim();
  const rest = [d.install_city, [d.install_state, d.install_pincode].filter(Boolean).join(" ")]
    .filter((v): v is string => !!v && !street.toLowerCase().includes(v.toLowerCase()));
  return { address: [street, ...rest].filter(Boolean).join(", "), state: (d.install_state ?? "").trim() };
}

/** Issues an invoice (a re-issue: replaces_id = the cancelled one) → the saved row with its number. */
export async function issueInvoice(v: InvoiceInput): Promise<InvoiceRow> {
  if (!v.customer_name.trim()) throw new Error("Enter the customer's name.");
  if (!(v.amount > 0)) throw new Error("Enter the amount.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.invoice_date)) throw new Error("Enter the invoice date.");
  const gstin = v.customer_gstin.trim().toUpperCase();
  if (gstin && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) throw new Error("Enter a valid 15-character GSTIN.");
  const f = invoiceFigures(v.amount, v.customer_state, v.epcState, v.kw);
  const { data, error } = await supabase().from("epc_invoices").insert({
    business_id: getBusiness()?.id, project_id: v.project_id, invoice_date: v.invoice_date,
    customer_name: v.customer_name.trim(), customer_address: v.customer_address.trim() || null,
    customer_gstin: gstin || null, customer_state: v.customer_state || null, place_of_supply: v.customer_state || null,
    lines: f.lines, taxable: f.taxable, cgst: f.cgst, sgst: f.sgst, igst: f.igst, total: f.total,
    replaces_id: v.replaces_id ?? null,
  }).select(COLS).single();
  if (error) throw friendly(error);
  const saved = row(data as unknown as Raw);
  patch(upsertRow(saved), saved.project_id);
  return saved;
}

/** Cancels an issued invoice (Owner / Admin) — it stays, marked cancelled with the reason. */
export async function cancelInvoice(r: InvoiceRow, reason: string): Promise<InvoiceRow> {
  if (!reason.trim()) throw new Error("Enter the reason.");
  const { data, error } = await supabase().from("epc_invoices")
    .update({ status: "cancelled", cancel_reason: reason.trim() }).eq("id", r.id).select(COLS).single();
  if (error) throw friendly(error);
  const saved = row(data as unknown as Raw);
  patch(upsertRow(saved), saved.project_id);
  return saved;
}

/** A cancelled invoice that no other invoice replaces yet. */
export const canReissue = (r: InvoiceRow, all: InvoiceRow[]) => r.status === "cancelled" && !all.some((x) => x.replaces_id === r.id);

/** Builds the PDF on the server and saves it. */
export async function downloadInvoicePdf(id: string) {
  const res = await fetch(`/api/epc/invoices/${id}/pdf`, { headers: authHeaders() });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || "Couldn't make the PDF."); }
  await saveDownload(res, "invoice.pdf");
}
