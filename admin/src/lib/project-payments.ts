// A project's payments (epc_project_payments, 0129) and its next payment due
// (epc_project_finance, 0128) — Partner Portal v2. Money only: Owner / Admin /
// Sales add and delete, Viewers read, Site staff never see it (RLS decides).
// A project's payments are one narrow read when the project is opened, kept for
// a few minutes in the tab and dropped on every change. remindPayment sends the
// customer a balance reminder from the EPC's own WhatsApp (paid — lib/subscription).

import { supabase } from "./supabase";
import { getBusiness } from "./auth";
import { getCached, invalidate, setCached } from "./list-cache";
import { fetchSubscription, hasFeature, SUBSCRIPTION_MSG } from "./subscription";
import { fetchEpcName } from "./epc-name";
import { fmtRupees } from "./money";
import { ORG_V2_COLS, type OrgProfile } from "./org-profile";
import { openWhatsApp } from "./wa-link";
import { projectsChanged, type ProjectRow } from "./projects";

export type PaySource = "customer" | "lender";
export const PAY_SOURCES: PaySource[] = ["customer", "lender"];
export const PAY_SOURCE_LABEL: Record<PaySource, string> = { customer: "From customer", lender: "From lender" };
export type PayMode = "cash" | "upi" | "bank" | "cheque" | "card" | "other";
export const PAY_MODES: PayMode[] = ["cash", "upi", "bank", "cheque", "card", "other"];
export const PAY_MODE_LABEL: Record<PayMode, string> = { cash: "Cash", upi: "UPI", bank: "Bank", cheque: "Cheque", card: "Card", other: "Other" };

export type Payment = {
  id: string; paid_on: string; amount: number; source: PaySource; mode: PayMode | null;
  reference: string | null; notes: string | null; created_at: string;
};
export type PaymentInput = Pick<Payment, "paid_on" | "amount" | "source" | "mode" | "reference" | "notes">;

const COLS = "id, paid_on, amount, source, mode, reference, notes, created_at";
const TTL = 5 * 60_000;
const listKey = (projectId: string) => `payments.${getBusiness()?.id ?? ""}.${getBusiness()?.member?.id ?? ""}.${projectId}`;
/** Sort order of a payments list: latest payment date first. */
export const newestFirst = (a: Payment, b: Payment) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at);

// The database's refusals (0128 / 0129) in plain words.
function friendly(e: { message?: string; code?: string } | null, fallback = "Something went wrong."): Error {
  const m = e?.message || "";
  if (/amount_check/.test(m)) return new Error("Enter an amount more than ₹0.");
  if (/mode_check|source_check/.test(m)) return new Error("Pick how the payment was made.");
  if (/row-level|permission denied|42501/.test(m) || e?.code === "42501") return new Error("You don't have access to change this project's payments.");
  if (/foreign key|23503/.test(m) || e?.code === "23503") return new Error("This project no longer exists.");
  if (/invalid input syntax for type date|date\/time field/.test(m)) return new Error("Pick a valid date.");
  return new Error(fallback);
}

/** Money received (customer + lender). */
export const received = (pays: Pick<Payment, "amount">[]) => Math.round(pays.reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100;
/** What is still to come: the project cost less what was received (never below 0); null when there is no cost. */
export function balanceDue(cost: number | null | undefined, pays: Pick<Payment, "amount">[]): number | null {
  if (cost == null || !Number.isFinite(Number(cost))) return null;
  return Math.max(0, Math.round((Number(cost) - received(pays)) * 100) / 100);
}

/** A project's payments, newest first. */
export async function fetchPayments(projectId: string): Promise<Payment[]> {
  const hit = getCached<Payment[]>(listKey(projectId), TTL);
  if (hit) return hit;
  const { data, error } = await supabase().from("epc_project_payments").select(COLS).eq("project_id", projectId)
    .order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  if (error) throw friendly(error, "Couldn't load the payments.");
  const rows = ((data ?? []) as Payment[]).map((p) => ({ ...p, amount: Number(p.amount) }));
  setCached(listKey(projectId), rows);
  return rows;
}

function changed(projectId: string) {
  invalidate(listKey(projectId));
  projectsChanged();
}

export async function addPayment(projectId: string, v: PaymentInput): Promise<Payment> {
  const amount = Math.round(Number(v.amount) * 100) / 100;
  if (!v.paid_on) throw new Error("Pick the payment date.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount more than ₹0.");
  const { data, error } = await supabase().from("epc_project_payments").insert({
    business_id: getBusiness()?.id, project_id: projectId, paid_on: v.paid_on, amount, source: v.source, mode: v.mode || null,
    reference: v.reference?.trim() || null, notes: v.notes?.trim() || null,
  }).select(COLS).single();
  if (error) throw friendly(error);
  changed(projectId);
  const p = data as Payment;
  return { ...p, amount: Number(p.amount) };
}

export async function deletePayment(id: string) {
  const { data, error } = await supabase().from("epc_project_payments").delete().eq("id", id).select("project_id");
  if (error) throw friendly(error);
  const gone = (data ?? []) as { project_id: string }[];
  if (!gone.length) throw new Error("You don't have access to change this project's payments.");
  changed(gone[0].project_id);
}

/** Sets (or clears) when the next customer payment is due; the project cost is left as it is. */
export async function setDueDate(project: ProjectRow, iso: string | null): Promise<ProjectRow> {
  const { error } = await supabase().from("epc_project_finance").upsert(
    { project_id: project.id, business_id: getBusiness()?.id, payment_due_on: iso || null, updated_at: new Date().toISOString() },
    { onConflict: "project_id" });
  if (error) throw friendly(error);
  projectsChanged();
  return { ...project, payment_due_on: iso || null };
}

// ── Reminder on WhatsApp ───────────────────────────────────────────────────────
// The company's UPI ID (epc_org_profile.upi_id, 0129) — one read, kept a while in the tab.
type OrgV2 = Pick<OrgProfile, "invoice_prefix" | "upi_id" | "whatsapp_number">;
const orgKey = () => `orgv2.${getBusiness()?.id ?? ""}`;
const ORG_TTL = 15 * 60_000;
async function fetchUpiId(): Promise<string | null> {
  const id = getBusiness()?.id;
  if (!id) return null;
  const hit = getCached<OrgV2>(orgKey(), ORG_TTL);
  if (hit) return hit.upi_id?.trim() || null;
  const { data, error } = await supabase().from("epc_org_profile").select(ORG_V2_COLS).eq("business_id", id).maybeSingle();
  if (error) return null; // the reminder still goes, without the UPI ID
  const v = (data ?? {}) as OrgV2;
  setCached(orgKey(), v);
  return v.upi_id?.trim() || null;
}
/** After the UPI ID is saved in Settings, so the next reminder carries the new one. */
export const upiChanged = () => invalidate(orgKey());

/** Opens the EPC's own WhatsApp to the customer with a ready balance reminder (Hinglish, editable before sending). */
export async function remindPayment(p: { customer: string; mobile: string | null; balance: number }): Promise<void> {
  // Open the tab now (while the click counts); it goes to WhatsApp once the message is ready.
  const win = window.open("", "_blank");
  if (win) win.opener = null;
  try {
    const [sub, upi, org] = await Promise.all([fetchSubscription(), fetchUpiId(), fetchEpcName()]);
    if (!hasFeature(sub, "whatsapp")) throw new Error(SUBSCRIPTION_MSG);
    const lines = [`Namaste ${p.customer.trim()} ji,`, "",
      `Aapke solar project ka ${fmtRupees(p.balance)} ka payment abhi baaki hai. Kripya jald se jald payment kar dein.`];
    if (upi) lines.push("", `UPI ID: ${upi}`);
    lines.push("", "Dhanyavaad,", org);
    const text = lines.join("\n");
    openWhatsApp(win, p.mobile, text);
  } catch (e) {
    win?.close();
    throw e;
  }
}
