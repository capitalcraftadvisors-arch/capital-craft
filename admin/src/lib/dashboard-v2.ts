// The Partner Portal v2 dashboard's figures (epc_dashboard, 0130) — the demo EPC
// only (portalV2). One read per period, kept for 5 minutes in the tab
// (list-cache). The database scopes every number to the signed-in person's role
// (Sales: their own leads / projects / loans; Site staff never see money).
// Periods are India dates: This month / Last month / This quarter / This FY
// (April–March) / All.

import { supabase } from "./supabase";
import { getBusiness } from "./auth";
import { getCached, invalidate, setCached } from "./list-cache";
import { periodBounds } from "./period";
import type { PaymentMode } from "./projects";

export type DashPeriod = "month" | "last_month" | "quarter" | "fy" | "all";
export const DASH_PERIODS: { key: DashPeriod; label: string }[] = [
  { key: "month", label: "This month" }, { key: "last_month", label: "Last month" },
  { key: "quarter", label: "This quarter" }, { key: "fy", label: "This FY" }, { key: "all", label: "All" },
];

export type CountValue = { count: number; value: number };
export type AttentionKind = "loan" | "payment" | "followup" | "insurance" | "not_insured" | "stuck";
/** One "Needs your attention" row; amount = the balance of an overdue payment. */
export type AttentionItem = { kind: AttentionKind; id: string; title: string; detail: string; amount: number | null };
export type FollowUpRow = { id: string; name: string; mobile: string | null; follow_up_at: string; owner: string };
/** member_id null = the company's own leads (name = its contact). */
export type LeadOwnerRow = { member_id: string | null; name: string; leads: number; won: number; due: number };
export type PaymentDueRow = { id: string; customer: string; mobile: string | null; cost: number; received: number; balance: number; due_on: string | null };
export type InsuranceDueRow = { id: string; name: string; policy_to_date: string; days_left: number };

export type Dashboard = {
  summary: { project_value: number; projects: number; kw: number; received: number; pending: number };
  split: Record<PaymentMode, CountValue>;
  /** Leads count at every stage they have reached; loans from those filed in the period. */
  pipeline: { leads: number; contacted: number; quoted: number; won: number;
              loans_filed: number; approved: number; first_tranche: number; second_pending: number };
  attention: AttentionItem[];
  followups_today: FollowUpRow[];
  lead_owners: LeadOwnerRow[];   // Owner / Admin only, else []
  payments_due: PaymentDueRow[];
  /** Counts at the portal's 4 loan stages; sanctioned / disbursed are ₹ sums. */
  loans: { under_review: number; updated: number; approved: number; rejected: number; sanctioned: number; disbursed: number };
  insurance_due: InsuranceDueRow[];
};

const TTL = 5 * 60_000;

/** "YYYY-MM-DD" in India time. */
const istDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ms));

/** The period's first and last day (India dates, both included); null = no bound. */
export function periodDates(p: DashPeriod): { from: string | null; to: string | null } {
  if (p === "all") return { from: null, to: null };
  if (p === "fy") {
    const [y, m] = istDate(Date.now()).split("-").map(Number);
    const start = m >= 4 ? y : y - 1;
    return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
  }
  const { start, end } = periodBounds(p === "last_month" ? "prev_month" : p);
  return { from: istDate(start), to: istDate(end - 1) };
}

const keyOf = (p: DashPeriod) => {
  const { from } = periodDates(p);
  return `dashboard.${getBusiness()?.id ?? ""}.${getBusiness()?.member?.id ?? ""}.${p}.${from ?? ""}`;
};

/** The signed-in person's dashboard for the period. */
export async function fetchDashboard(p: DashPeriod): Promise<Dashboard> {
  const key = keyOf(p);
  const hit = getCached<Dashboard>(key, TTL);
  if (hit) return hit;
  const { from, to } = periodDates(p);
  const { data, error } = await supabase().rpc("epc_dashboard", { p_from: from, p_to: to });
  if (error || !data) throw new Error("Couldn't load your dashboard.");
  setCached(key, data);
  return data as Dashboard;
}

/** Drop every cached period (a lead / project / payment changed elsewhere). */
export const dashboardChanged = () => DASH_PERIODS.forEach((x) => invalidate(keyOf(x.key)));
