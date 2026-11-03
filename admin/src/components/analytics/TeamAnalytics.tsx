"use client";

// Team analytics — the CC team's figures: Residential and Commercial loan
// files, and EPC partners, for the chosen period. Figures only.
//
// One lean read of loans + their lenders + EPC profiles when the page opens
// (kept 5 minutes in this tab, lib/list-cache), scoped by the same rules as the
// person's own loan list (RLS). Stages are the Task Manager's own
// (lib/ops-board loanColumn / epcColumn), so the two always agree.

import { type ReactNode } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie, CartesianGrid,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { getBusiness } from "@/lib/auth";
import { getCached, setCached } from "@/lib/list-cache";
import { loanColumn, epcColumn, columnsFor } from "@/lib/ops-board";
import { lenderColor } from "@/lib/lenders";
import { lenderLabelIn, type Lender } from "@/lib/loan-lenders";
import { rupeesShort as money } from "@/lib/money";
import type { Win, Windows } from "@/lib/periods";

// ── data ─────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;
type LoanLender = { application_id: string; lender_key: string; lender_label: string | null; docs_sent_at: string | null; approved_at: string | null; rejected_at: string | null };
type EpcLender = { business_id: string; docs_given: boolean | null; approved: boolean | null; rejected: boolean | null; approved_at: string | null };
export type TeamData = { loans: Row[]; lenders: LoanLender[]; epcs: Row[]; epcLenders: EpcLender[] };
export type TeamTab = "residential" | "commercial" | "epc";

const LOAN_SELECT = "id, status, plant_use_type, loan_amount, loan_amount_required, sanctioned_amount, first_disbursement_amount, second_disbursement_amount, first_disbursement_date, second_disbursement_date, created_at, updated_at, submitted_at, docs_sent_at, hold_at, approved_at, rejected_at, aborted_at, rejection_reason, epc_business_id, install_state";

/** Everything the page shows, read once (5-minute tab cache). Throws if a read fails. */
export async function loadTeamData(): Promise<TeamData> {
  const key = `teamanalytics.${getBusiness()?.id ?? "anon"}`;
  const hit = getCached<TeamData>(key, 5 * 60000);
  if (hit) return hit;
  const db = supabase();
  const [l, ll, e, el] = await Promise.all([
    db.from("epc_applications").select(LOAN_SELECT),
    db.from("loan_application_lenders").select("application_id, lender_key, lender_label, docs_sent_at, approved_at, rejected_at"),
    db.from("epc_business").select("id, trade_name, legal_name, contact_name, status, current_step, created_at, submitted_at, service_type, last_login_at").neq("business_type", "admin"),
    db.from("epc_lender_status").select("business_id, docs_given, approved, rejected, approved_at"),
  ]);
  const err = l.error || ll.error || e.error || el.error;
  if (err) throw err;
  const data = { loans: l.data ?? [], lenders: ll.data ?? [], epcs: e.data ?? [], epcLenders: el.data ?? [] } as TeamData;
  setCached(key, data);
  return data;
}

// ── helpers ──────────────────────────────────────────────────────────────────
const DAY = 86400000;
const num = (v: unknown) => Number(v) || 0;
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);
const inWin = (s: string | null | undefined, w: Win) => { const t = ms(s); return Number.isFinite(t) && t >= w.start && t <= w.end; };
const ageDays = (s: string | null | undefined) => { const t = ms(s); return Number.isFinite(t) ? (Date.now() - t) / DAY : NaN; };
const amountOf = (r: Row) => num(r.loan_amount_required) || num(r.loan_amount);
const APPROVED = new Set(["approved", "rfd", "sent_to_nbfc", "disbursed"]);
const isApproved = (r: Row) => APPROVED.has(r.status) || r.first_disbursement_amount != null;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
// % change vs the previous period (null when there's nothing to compare with).
const change = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
const nameOf = (b: Row | undefined) => (b ? b.trade_name || b.legal_name || b.contact_name || "—" : "—");
const count = (n: number) => n.toLocaleString("en-IN");

// The last 6 calendar months (oldest first).
function lastMonths(): { label: string; win: Win }[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, k) => {
    const s = new Date(now.getFullYear(), now.getMonth() - 5 + k, 1);
    const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
    return { label: s.toLocaleDateString("en-IN", { month: "short" }), win: { start: s.getTime(), end: e.getTime() - 1 } };
  });
}

const C = { green: "#178a5c", teal: "#0f766e", blue: "#185fa5", amber: "#d97706", red: "#dc2626", slate: "#94a3b8", ink: "#0f3d2e" };

// ── loan figures (one segment) ───────────────────────────────────────────────
function loanFigures(d: TeamData, segment: "residential" | "commercial", w: Windows, lenders: Lender[]) {
  const loans = d.loans.filter((r) => r.plant_use_type === segment);
  const byApp = new Map<string, LoanLender[]>();
  for (const x of d.lenders) { const a = byApp.get(x.application_id); if (a) a.push(x); else byApp.set(x.application_id, [x]); }
  const mine = (r: Row) => byApp.get(r.id) ?? [];
  const firstSent = (r: Row): string | null => {
    const t = [r.docs_sent_at, ...mine(r).map((x) => x.docs_sent_at)].map(ms).filter(Number.isFinite);
    return t.length ? new Date(Math.min(...t)).toISOString() : null;
  };
  const epcById = new Map(d.epcs.map((b) => [b.id, b]));

  const filed = (win: Win) => loans.filter((r) => r.status !== "draft" && inWin(r.submitted_at || r.created_at, win));
  const sent = (win: Win) => loans.filter((r) => inWin(firstSent(r), win));
  const approved = (win: Win) => loans.filter((r) => isApproved(r) && inWin(r.approved_at, win));
  const rejected = (win: Win) => loans.filter((r) => r.status === "rejected" && inWin(r.rejected_at, win));
  const tranches = (win: Win) => {
    let amount = 0, n = 0;
    for (const r of loans) {
      if (inWin(r.first_disbursement_date, win) && r.first_disbursement_amount != null) { amount += num(r.first_disbursement_amount); n++; }
      if (inWin(r.second_disbursement_date, win) && r.second_disbursement_amount != null) { amount += num(r.second_disbursement_amount); n++; }
    }
    return { amount, n };
  };
  const cur = { filed: filed(w.cur), sent: sent(w.cur), approved: approved(w.cur), paid: tranches(w.cur) };
  const prev = { filed: filed(w.prev), sent: sent(w.prev), approved: approved(w.prev), paid: tranches(w.prev) };

  // Where each file is now (the Task Manager's stage).
  const stageOf = (r: Row) => loanColumn(r, mine(r).some((x) => x.docs_sent_at && !x.approved_at && !x.rejected_at)).column;
  const staged = loans.map((r) => ({ r, col: stageOf(r) }));
  const live = staged.filter(({ r, col }) => col === "ready_login" || col === "send_lender" || col === "docs_pending" || col === "phase1" || (col === "approved_rejected" && r.status !== "rejected"));
  const liveKey = ({ r, col }: { r: Row; col: string | null }) => (col === "approved_rejected" && r.status !== "rejected" ? "approved" : col);
  const PIPE = [
    { key: "ready_login", label: "Ready for login", color: "#7c8da1" },
    { key: "send_lender", label: "With lender", color: C.blue },
    { key: "docs_pending", label: "Docs pending", color: C.amber },
    { key: "approved", label: "Approved — awaiting 1st", color: C.green },
    { key: "phase1", label: "1st disbursed — 2nd pending", color: C.teal },
  ];
  const pipeline = PIPE.map((s) => {
    const rows = live.filter((x) => liveKey(x) === s.key).map((x) => x.r);
    return { ...s, count: rows.length, value: rows.reduce((t, r) => t + amountOf(r), 0) };
  });

  const outcome = [
    { name: "In progress", value: staged.filter(({ col }) => col === "ready_login" || col === "send_lender" || col === "docs_pending").length, color: C.blue },
    { name: "Approved", value: staged.filter(({ r, col }) => col === "approved_rejected" && r.status !== "rejected").length, color: C.green },
    { name: "Disbursed", value: staged.filter(({ col }) => col === "phase1" || col === "phase2").length, color: C.teal },
    { name: "Rejected", value: staged.filter(({ r }) => r.status === "rejected" && !r.aborted_at).length, color: C.red },
    { name: "Aborted", value: staged.filter(({ col }) => col === "abort").length, color: C.slate },
  ].filter((x) => x.value > 0);

  const months = lastMonths().map((m) => ({
    label: m.label, filed: filed(m.win).length, approved: approved(m.win).length, disbursed: tranches(m.win).amount,
  }));

  // Lenders — files sent, approved and rejected in the period, per lender.
  const ls = new Map<string, { sent: number; approved: number; rejected: number; label: string }>();
  for (const r of loans) for (const x of mine(r)) {
    const cur0 = ls.get(x.lender_key) ?? { sent: 0, approved: 0, rejected: 0, label: x.lender_label || lenderLabelIn(lenders, x.lender_key) };
    if (inWin(x.docs_sent_at, w.cur)) cur0.sent++;
    if (inWin(x.approved_at, w.cur)) cur0.approved++;
    if (inWin(x.rejected_at, w.cur)) cur0.rejected++;
    ls.set(x.lender_key, cur0);
  }
  const lenderRows = [...ls.entries()].map(([key, v]) => ({ key, ...v, color: lenderColor(lenders, key), rate: pct(v.approved, v.approved + v.rejected) }))
    .filter((x) => x.sent + x.approved + x.rejected > 0).sort((a, b) => b.sent - a.sent || b.approved - a.approved);
  const approvalsByLender = lenderRows.filter((x) => x.approved > 0).map((x) => ({ name: x.label, value: x.approved, color: x.color }));

  // Why files were rejected in the period.
  const reasons = new Map<string, number>();
  for (const r of rejected(w.cur)) { const k = String(r.rejection_reason || "").trim() || "Not recorded"; reasons.set(k, (reasons.get(k) ?? 0) + 1); }
  const rejection = [...reasons.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);

  // Average days for each step finished in the period.
  const gap = (rows: Row[], from: (r: Row) => string | null, to: (r: Row) => string | null) =>
    avg(rows.map((r) => (ms(to(r)) - ms(from(r))) / DAY).filter((x) => Number.isFinite(x) && x >= 0));
  const speed = [
    { name: "Filed → with lender", days: gap(cur.sent, (r) => r.submitted_at || r.created_at, firstSent) },
    { name: "With lender → approved", days: gap(cur.approved, firstSent, (r) => r.approved_at) },
    { name: "Approved → 1st disbursed", days: gap(loans.filter((r) => inWin(r.first_disbursement_date, w.cur)), (r) => r.approved_at, (r) => r.first_disbursement_date) },
    { name: "1st → 2nd disbursed", days: gap(loans.filter((r) => inWin(r.second_disbursement_date, w.cur)), (r) => r.first_disbursement_date, (r) => r.second_disbursement_date) },
  ];

  // Needs a push today (counts, now).
  const liveRows = live.map((x) => x.r);
  const dueIn = (r: Row) => 45 - ageDays(r.first_disbursement_date); // 2nd tranche: 45 days after the 1st
  const phase1 = staged.filter(({ col }) => col === "phase1").map(({ r }) => r);
  const attention = [
    { label: "Docs pending over 7 days", value: staged.filter(({ col, r }) => col === "docs_pending" && ageDays(r.hold_at || r.updated_at) > 7).length, tone: C.amber },
    { label: "With lender over 10 days", value: staged.filter(({ col, r }) => col === "send_lender" && ageDays(firstSent(r)) > 10).length, tone: C.blue },
    { label: "Approved, not disbursed over 15 days", value: live.filter((x) => liveKey(x) === "approved" && ageDays(x.r.approved_at) > 15).length, tone: C.green },
    { label: "2nd tranche due in 15 days", value: phase1.filter((r) => dueIn(r) >= 0 && dueIn(r) <= 15).length, tone: C.teal },
    { label: "2nd tranche overdue", value: phase1.filter((r) => dueIn(r) < 0).length, tone: C.red },
    { label: "No update over 7 days", value: liveRows.filter((r) => ageDays(r.updated_at) > 7).length, tone: "#64748b" },
  ];

  // EPC partners behind this period's files.
  const epcAgg = new Map<string, { files: number; approved: number; disbursed: number }>();
  const bump = (id: string | null | undefined, k: "files" | "approved" | "disbursed", v: number) => {
    if (!id) return; const a = epcAgg.get(id) ?? { files: 0, approved: 0, disbursed: 0 }; a[k] += v; epcAgg.set(id, a);
  };
  for (const r of cur.filed) bump(r.epc_business_id, "files", 1);
  for (const r of cur.approved) bump(r.epc_business_id, "approved", 1);
  for (const r of loans) {
    if (inWin(r.first_disbursement_date, w.cur)) bump(r.epc_business_id, "disbursed", num(r.first_disbursement_amount));
    if (inWin(r.second_disbursement_date, w.cur)) bump(r.epc_business_id, "disbursed", num(r.second_disbursement_amount));
  }
  const topEpcs = [...epcAgg.entries()].map(([id, v]) => ({ name: nameOf(epcById.get(id)), ...v }))
    .sort((a, b) => b.files - a.files || b.disbursed - a.disbursed).slice(0, 8);

  const states = new Map<string, number>();
  for (const r of cur.filed) { const s = String(r.install_state || "").trim(); if (s) states.set(s, (states.get(s) ?? 0) + 1); }
  const byState = [...states.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);

  return {
    kpis: {
      filed: { v: cur.filed.length, ch: change(cur.filed.length, prev.filed.length), ask: cur.filed.reduce((s, r) => s + amountOf(r), 0) },
      sent: { v: cur.sent.length, ch: change(cur.sent.length, prev.sent.length) },
      approved: { v: cur.approved.length, ch: change(cur.approved.length, prev.approved.length), sanctioned: cur.approved.reduce((s, r) => s + (num(r.sanctioned_amount) || amountOf(r)), 0) },
      paid: { v: cur.paid.amount, n: cur.paid.n, ch: change(cur.paid.amount, prev.paid.amount) },
    },
    pipeline, liveCount: live.length, liveValue: liveRows.reduce((s, r) => s + amountOf(r), 0),
    outcome, total: loans.length, months, lenderRows, approvalsByLender, rejection, speed, attention, topEpcs, byState,
  };
}

// ── EPC partner figures ──────────────────────────────────────────────────────
function epcFigures(d: TeamData, w: Windows) {
  const lenderBy = new Map<string, { docs: boolean; approved: boolean; rejected: boolean; approvedAt: number }>();
  for (const x of d.epcLenders) {
    const c = lenderBy.get(x.business_id) ?? { docs: false, approved: false, rejected: false, approvedAt: NaN };
    c.docs ||= !!x.docs_given; c.approved ||= !!x.approved; c.rejected ||= !!x.rejected;
    const t = ms(x.approved_at); if (Number.isFinite(t) && !(c.approvedAt <= t)) c.approvedAt = t;
    lenderBy.set(x.business_id, c);
  }
  const lend = (id: string) => lenderBy.get(id) ?? { docs: false, approved: false, rejected: false, approvedAt: NaN };
  const epcs = d.epcs.map((b) => ({ b, col: epcColumn(b, lend(b.id)).column }));
  const approved = epcs.filter((x) => x.col === "approved").map((x) => x.b);

  const signups = (win: Win) => d.epcs.filter((b) => inWin(b.created_at, win)).length;
  const submitted = (win: Win) => d.epcs.filter((b) => inWin(b.submitted_at, win)).length;
  const approvedIn = (win: Win) => d.epcs.filter((b) => { const t = lend(b.id).approvedAt; return Number.isFinite(t) && t >= win.start && t <= win.end; }).length;
  const filedLoans = (win: Win) => d.loans.filter((r) => r.status !== "draft" && inWin(r.submitted_at || r.created_at, win));
  const sending = (win: Win) => new Set(filedLoans(win).map((r) => r.epc_business_id).filter(Boolean)).size;

  const pipeline = columnsFor("epc").map((c, i) => ({
    key: c.key, label: c.label, count: epcs.filter((x) => x.col === c.key).length,
    color: ["#a3b1c2", "#7c8da1", C.amber, "#0e7490", C.blue, C.green, C.red][i] ?? C.slate,
  }));

  // Approved partners — how recently they sent a file, and logged in.
  const lastFile = new Map<string, number>();
  for (const r of d.loans) {
    const t = ms(r.created_at); if (!r.epc_business_id || !Number.isFinite(t)) continue;
    if (!(lastFile.get(r.epc_business_id)! >= t)) lastFile.set(r.epc_business_id, t);
  }
  const fileAge = (id: string) => { const t = lastFile.get(id); return t == null ? Infinity : (Date.now() - t) / DAY; };
  const activity = [
    { name: "Sent a file in 30 days", value: approved.filter((b) => fileAge(b.id) <= 30).length, color: C.green },
    { name: "Quiet 31–90 days", value: approved.filter((b) => fileAge(b.id) > 30 && fileAge(b.id) <= 90).length, color: C.amber },
    { name: "Dormant over 90 days", value: approved.filter((b) => fileAge(b.id) > 90 && fileAge(b.id) < Infinity).length, color: C.red },
    { name: "No file yet", value: approved.filter((b) => fileAge(b.id) === Infinity).length, color: C.slate },
  ].filter((x) => x.value > 0);
  const loginAge = (b: Row) => ageDays(b.last_login_at);
  const logins = [
    { label: "Logged in this week", count: approved.filter((b) => loginAge(b) <= 7).length, color: C.green },
    { label: "8–30 days ago", count: approved.filter((b) => loginAge(b) > 7 && loginAge(b) <= 30).length, color: C.teal },
    { label: "Over 30 days ago", count: approved.filter((b) => loginAge(b) > 30).length, color: C.amber },
    { label: "Never logged in", count: approved.filter((b) => !Number.isFinite(loginAge(b))).length, color: C.slate },
  ];
  const SERVICE: Record<string, string> = { loans: "Loans", insurance: "Insurance", both: "Loans + insurance" };
  const svc = new Map<string, number>();
  for (const b of approved) { const k = SERVICE[b.service_type] ?? "Not set"; svc.set(k, (svc.get(k) ?? 0) + 1); }
  const SVC_COLOR: Record<string, string> = { Loans: C.green, Insurance: "#0e7490", "Loans + insurance": C.blue, "Not set": C.slate };
  const services = [...svc.entries()].map(([name, value]) => ({ name, value, color: SVC_COLOR[name] ?? C.slate }));

  // Top partners in the period — files filed, approvals, disbursed ₹ and approval rate.
  const agg = new Map<string, { files: number; approved: number; rejected: number; disbursed: number }>();
  const get = (id: string) => { let a = agg.get(id); if (!a) agg.set(id, (a = { files: 0, approved: 0, rejected: 0, disbursed: 0 })); return a; };
  for (const r of d.loans) {
    const id = r.epc_business_id; if (!id) continue;
    if (r.status !== "draft" && inWin(r.submitted_at || r.created_at, w.cur)) get(id).files++;
    if (isApproved(r) && inWin(r.approved_at, w.cur)) get(id).approved++;
    if (r.status === "rejected" && inWin(r.rejected_at, w.cur)) get(id).rejected++;
    if (inWin(r.first_disbursement_date, w.cur)) get(id).disbursed += num(r.first_disbursement_amount);
    if (inWin(r.second_disbursement_date, w.cur)) get(id).disbursed += num(r.second_disbursement_amount);
  }
  const byId = new Map(d.epcs.map((b) => [b.id, b]));
  const top = [...agg.entries()].filter(([, v]) => v.files + v.approved + v.disbursed > 0)
    .map(([id, v]) => ({ name: nameOf(byId.get(id)), ...v, rate: v.approved + v.rejected ? pct(v.approved, v.approved + v.rejected) : null }))
    .sort((a, b) => b.files - a.files || b.disbursed - a.disbursed).slice(0, 10);

  const months = lastMonths().map((m) => ({ label: m.label, signups: signups(m.win), approved: approvedIn(m.win) }));

  return {
    kpis: {
      signups: { v: signups(w.cur), ch: change(signups(w.cur), signups(w.prev)) },
      submitted: { v: submitted(w.cur), ch: change(submitted(w.cur), submitted(w.prev)) },
      approved: { v: approvedIn(w.cur), ch: change(approvedIn(w.cur), approvedIn(w.prev)) },
      sending: { v: sending(w.cur), ch: change(sending(w.cur), sending(w.prev)) },
      total: approved.length, all: d.epcs.length,
    },
    pipeline, activity, logins, services, top, months,
  };
}

// ── views ────────────────────────────────────────────────────────────────────
export default function TeamAnalytics({ data, tab, w, lenders }: { data: TeamData; tab: TeamTab; w: Windows; lenders: Lender[] }) {
  return tab === "epc" ? <EpcView data={data} w={w} /> : <LoanView data={data} segment={tab} w={w} lenders={lenders} />;
}

function LoanView({ data, segment, w, lenders }: { data: TeamData; segment: "residential" | "commercial"; w: Windows; lenders: Lender[] }) {
  const f = loanFigures(data, segment, w, lenders);
  const k = f.kpis;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-5">
        <Hero label="Disbursed" value={money(k.paid.v)} sub={`${k.paid.n} tranche${k.paid.n === 1 ? "" : "s"} · ${w.label.toLowerCase()}`} ch={k.paid.ch} />
        <Kpi label="New files" value={count(k.filed.v)} sub={`${money(k.filed.ask)} asked`} ch={k.filed.ch} tone={C.blue} />
        <Kpi label="Sent to lender" value={count(k.sent.v)} ch={k.sent.ch} tone="#0e7490" />
        <Kpi label="Approved" value={count(k.approved.v)} sub={`${money(k.approved.sanctioned)} sanctioned`} ch={k.approved.ch} tone={C.green} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel title="Live pipeline" note={`${count(f.liveCount)} files · ${money(f.liveValue)}`} className="lg:col-span-3">
          <StageBars rows={f.pipeline.map((p) => ({ label: p.label, count: p.count, sub: money(p.value), color: p.color }))} />
        </Panel>
        <Panel title="All files" note={count(f.total)} className="lg:col-span-2">
          <Donut data={f.outcome} total={f.total} centre="files" />
        </Panel>
      </div>

      <Panel title="Needs a push" note="now">
        <Attention items={f.attention} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Files and approvals" note="last 6 months">
          <MonthBars data={f.months} series={[{ key: "filed", label: "Files in", color: C.blue }, { key: "approved", label: "Approved", color: C.green }]} />
        </Panel>
        <Panel title="Disbursed" note="last 6 months">
          <MonthBars data={f.months} series={[{ key: "disbursed", label: "Disbursed", color: C.teal }]} money />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel title="Lenders" note={w.label} className="lg:col-span-3">
          <LenderTable rows={f.lenderRows} />
        </Panel>
        <Panel title="Approvals by lender" note={w.label} className="lg:col-span-2">
          <Donut data={f.approvalsByLender} total={f.approvalsByLender.reduce((s, x) => s + x.value, 0)} centre="approved" />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Why files were rejected" note={w.label}>
          <StageBars rows={f.rejection.map((r) => ({ label: r.name, count: r.value, color: C.red }))} />
        </Panel>
        <Panel title="Average days per step" note={w.label}>
          <Speed rows={f.speed} />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel title="EPC partners" note={w.label} className="lg:col-span-3">
          <PartnerTable rows={f.topEpcs.map((e) => ({ name: e.name, files: e.files, approved: e.approved, disbursed: e.disbursed, rate: null }))} />
        </Panel>
        <Panel title="Files by state" note={w.label} className="lg:col-span-2">
          <StageBars rows={f.byState.map((s) => ({ label: s.name, count: s.value, color: C.green }))} />
        </Panel>
      </div>
    </div>
  );
}

function EpcView({ data, w }: { data: TeamData; w: Windows }) {
  const f = epcFigures(data, w);
  const k = f.kpis;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-6">
        <Hero label="Approved partners" value={count(k.total)} sub={`of ${count(k.all)} partners`} ch={null} />
        <Kpi label="New sign-ups" value={count(k.signups.v)} ch={k.signups.ch} tone={C.blue} />
        <Kpi label="Sent for review" value={count(k.submitted.v)} ch={k.submitted.ch} tone="#0e7490" />
        <Kpi label="Approved" value={count(k.approved.v)} sub="by a lender" ch={k.approved.ch} tone={C.green} />
        <Kpi label="Partners sending files" value={count(k.sending.v)} ch={k.sending.ch} tone={C.teal} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel title="Onboarding" note={`${count(k.all)} partners · now`} className="lg:col-span-3">
          <StageBars rows={f.pipeline.map((p) => ({ label: p.label, count: p.count, color: p.color }))} />
        </Panel>
        <Panel title="Approved partners — last file" note="now" className="lg:col-span-2">
          <Donut data={f.activity} total={k.total} centre="partners" />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel title="Top partners" note={w.label} className="lg:col-span-3">
          <PartnerTable rows={f.top} />
        </Panel>
        <Panel title="Services" note="approved partners" className="lg:col-span-2">
          <Donut data={f.services} total={k.total} centre="partners" />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Sign-ups and approvals" note="last 6 months">
          <MonthBars data={f.months} series={[{ key: "signups", label: "Sign-ups", color: C.blue }, { key: "approved", label: "Approved", color: C.green }]} />
        </Panel>
        <Panel title="Logins" note="approved partners">
          <StageBars rows={f.logins.map((l) => ({ label: l.label, count: l.count, color: l.color }))} />
        </Panel>
      </div>
    </div>
  );
}

// ── building blocks ──────────────────────────────────────────────────────────
const CARD = "rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-16px_rgba(16,24,40,0.18)]";

function Panel({ title, note, className = "", children }: { title: string; note?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`${CARD} p-5 ${className}`}>
      <header className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-[14px] font-semibold text-[#0f3d2e] tracking-[-0.01em]">{title}</h3>
        {note && <span className="text-[12px] text-text-muted tabular-nums">{note}</span>}
      </header>
      {children}
    </section>
  );
}

function Change({ ch, light }: { ch: number | null; light?: boolean }) {
  if (ch == null) return null;
  const up = ch > 0, flat = ch === 0;
  const color = light ? "rgba(255,255,255,0.92)" : flat ? "#64748b" : up ? C.green : C.red;
  const bg = light ? "rgba(255,255,255,0.14)" : flat ? "#f1f5f9" : up ? "#e7f5ee" : "#fdecec";
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums" style={{ color, background: bg }}>
      {flat ? "•" : up ? "▲" : "▼"} {Math.abs(ch)}%
    </span>
  );
}

function Kpi({ label, value, sub, ch, tone }: { label: string; value: string; sub?: string; ch: number | null; tone: string }) {
  return (
    <div className={`${CARD} relative overflow-hidden p-4`}>
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: tone }} />
      <div className="text-[12.5px] font-medium text-text-mid">{label}</div>
      <div className="mt-1.5 font-display text-[28px] leading-none font-bold text-[#0f2a20] tabular-nums tracking-[-0.02em]">{value}</div>
      <div className="mt-2.5 flex items-center gap-2 flex-wrap min-h-[22px]">
        <Change ch={ch} />
        {sub && <span className="text-[12px] text-text-muted tabular-nums">{sub}</span>}
      </div>
    </div>
  );
}

// The headline figure — two columns wide on the deep team green.
function Hero({ label, value, sub, ch }: { label: string; value: string; sub?: string; ch: number | null }) {
  return (
    <div className="col-span-2 rounded-2xl p-5 text-white relative overflow-hidden shadow-[0_18px_40px_-18px_rgba(10,69,52,0.65)]"
      style={{ background: "linear-gradient(135deg, #0c3b2e 0%, #145c45 55%, #1f7a5a 100%)" }}>
      <span className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/[0.06]" />
      <span className="absolute right-10 -bottom-16 h-32 w-32 rounded-full bg-white/[0.05]" />
      <div className="relative">
        <div className="text-[12.5px] font-medium text-white/75">{label}</div>
        <div className="mt-2 font-display text-[38px] leading-none font-bold tabular-nums tracking-[-0.02em]">{value}</div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Change ch={ch} light />
          {sub && <span className="text-[12.5px] text-white/70 tabular-nums">{sub}</span>}
        </div>
      </div>
    </div>
  );
}

function Empty({ text = "Nothing in this period" }: { text?: string }) {
  return <div className="h-[140px] grid place-items-center text-[13px] text-text-muted">{text}</div>;
}

// Horizontal bars: label, track, count (and a second figure).
function StageBars({ rows }: { rows: { label: string; count: number; sub?: string; color: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.some((r) => r.count > 0)) return <Empty />;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
          <span className="text-[13px] text-text-mid truncate" title={r.label}>{r.label}</span>
          <span className="h-2.5 rounded-full bg-[#eef3f0] overflow-hidden">
            <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${(r.count / max) * 100}%`, background: r.color }} />
          </span>
          <span className="text-right tabular-nums min-w-[3.5rem]">
            <span className="text-[14px] font-semibold text-[#0f2a20]">{count(r.count)}</span>
            {r.sub && <span className="block text-[11.5px] text-text-muted">{r.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Donut({ data, total, centre }: { data: { name: string; value: number; color: string }[]; total: number; centre: string }) {
  if (!data.length) return <Empty />;
  const sum = data.reduce((s, x) => s + x.value, 0);
  return (
    <div className="flex items-center gap-5 flex-wrap sm:flex-nowrap">
      <div className="relative h-[170px] w-[170px] shrink-0 mx-auto">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={56} outerRadius={80} paddingAngle={data.length > 1 ? 2 : 0} stroke="none" startAngle={90} endAngle={-270}>
              {data.map((x) => <Cell key={x.name} fill={x.color} />)}
            </Pie>
            <Tooltip content={<Tip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none text-center">
          <div>
            <div className="font-display text-[24px] font-bold text-[#0f2a20] tabular-nums leading-none">{count(total)}</div>
            <div className="text-[11.5px] text-text-muted mt-1">{centre}</div>
          </div>
        </div>
      </div>
      <ul className="flex-1 min-w-[10rem] space-y-2">
        {data.map((x) => (
          <li key={x.name} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: x.color }} />
            <span className="text-text-mid truncate">{x.name}</span>
            <span className="ml-auto tabular-nums font-semibold text-[#0f2a20]">{count(x.value)}</span>
            <span className="tabular-nums text-text-muted w-10 text-right">{pct(x.value, sum)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MonthBars({ data, series, money: isMoney }: { data: Row[]; series: { key: string; label: string; color: string }[]; money?: boolean }) {
  if (!data.some((m) => series.some((s) => num(m[s.key]) > 0))) return <Empty text="Nothing in the last 6 months" />;
  const fmt = (v: number) => (isMoney ? money(v) : count(v));
  return (
    <div>
      {series.length > 1 && (
        <div className="flex gap-4 mb-2 text-[12px] text-text-mid">
          {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={4} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#eef2f0" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
            <YAxis tickLine={false} axisLine={false} width={isMoney ? 62 : 32} allowDecimals={false} tick={{ fontSize: 11.5, fill: "#94a3b8" }} tickFormatter={fmt} />
            <Tooltip cursor={{ fill: "rgba(15,61,46,0.05)" }} content={<Tip fmt={fmt} />} />
            {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[6, 6, 0, 0]} maxBarSize={28} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Tip({ active, payload, label, fmt = count }: { active?: boolean; payload?: any[]; label?: string; fmt?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white px-3 py-2 shadow-lg text-[12.5px]">
      {label && <div className="font-semibold text-[#0f2a20] mb-1">{label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: p.payload?.color || p.color || p.fill }} />
          <span className="text-text-mid">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums">{fmt(num(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

function Attention({ items }: { items: { label: string; value: number; tone: string }[] }) {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      {items.map((x) => (
        <div key={x.label} className="rounded-xl px-4 py-3.5 border" style={{ borderColor: `${x.tone}26`, background: x.value ? `${x.tone}0d` : "#f8faf9" }}>
          <div className="font-display text-[26px] font-bold leading-none tabular-nums" style={{ color: x.value ? x.tone : "#94a3b8" }}>{count(x.value)}</div>
          <div className="mt-2 text-[12.5px] leading-snug text-text-mid">{x.label}</div>
        </div>
      ))}
    </div>
  );
}

function Speed({ rows }: { rows: { name: string; days: number | null }[] }) {
  if (!rows.some((r) => r.days != null)) return <Empty />;
  const max = Math.max(1, ...rows.map((r) => r.days ?? 0));
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
          <span className="text-[13px] text-text-mid truncate" title={r.name}>{r.name}</span>
          <span className="h-2.5 rounded-full bg-[#eef3f0] overflow-hidden">
            {r.days != null && <span className="block h-full rounded-full" style={{ width: `${(r.days / max) * 100}%`, background: C.teal }} />}
          </span>
          <span className="text-right tabular-nums min-w-[3.5rem] text-[14px] font-semibold text-[#0f2a20]">{r.days == null ? "—" : `${r.days} d`}</span>
        </div>
      ))}
    </div>
  );
}

function LenderTable({ rows }: { rows: { key: string; label: string; color: string; sent: number; approved: number; rejected: number; rate: number }[] }) {
  if (!rows.length) return <Empty />;
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[11.5px] uppercase tracking-[0.06em] text-text-muted">
          <th className="text-left font-semibold pb-2">Lender</th>
          <th className="text-right font-semibold pb-2">Sent</th>
          <th className="text-right font-semibold pb-2">Approved</th>
          <th className="text-right font-semibold pb-2">Rejected</th>
          <th className="text-right font-semibold pb-2 w-[34%]">Approval rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-black/[0.05]">
            <td className="py-2.5"><span className="inline-flex items-center gap-2 font-medium text-[#0f2a20]"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: r.color }} />{r.label}</span></td>
            <td className="py-2.5 text-right tabular-nums">{count(r.sent)}</td>
            <td className="py-2.5 text-right tabular-nums text-[#0f7a52] font-semibold">{count(r.approved)}</td>
            <td className="py-2.5 text-right tabular-nums text-[#b91c1c]">{count(r.rejected)}</td>
            <td className="py-2.5">
              <div className="flex items-center gap-2 justify-end">
                <span className="h-2 w-24 rounded-full bg-[#eef3f0] overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${r.rate}%`, background: C.green }} /></span>
                <span className="tabular-nums font-semibold w-10 text-right">{r.approved + r.rejected ? `${r.rate}%` : "—"}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PartnerTable({ rows }: { rows: { name: string; files: number; approved: number; disbursed: number; rate: number | null }[] }) {
  if (!rows.length) return <Empty />;
  const max = Math.max(1, ...rows.map((r) => r.files));
  const showRate = rows.some((r) => r.rate != null);
  return (
    <table className="w-full text-[13px] table-fixed">
      <thead>
        <tr className="text-[11.5px] uppercase tracking-[0.06em] text-text-muted">
          <th className="text-left font-semibold pb-2 w-[42%]">Partner</th>
          <th className="text-left font-semibold pb-2">Files</th>
          <th className="text-right font-semibold pb-2 w-[14%]">Approved</th>
          <th className="text-right font-semibold pb-2 w-[18%]">Disbursed</th>
          {showRate && <th className="text-right font-semibold pb-2 w-[12%]">Rate</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.name + i} className="border-t border-black/[0.05]">
            <td className="py-2.5 pr-2">
              <span className="flex items-center gap-2 min-w-0">
                <span className="h-5 w-5 shrink-0 rounded-full grid place-items-center text-[10.5px] font-bold text-white" style={{ background: i < 3 ? "#145c45" : "#94a3b8" }}>{i + 1}</span>
                <span className="truncate font-medium text-[#0f2a20]" title={r.name}>{r.name}</span>
              </span>
            </td>
            <td className="py-2.5">
              <span className="flex items-center gap-2">
                <span className="h-2 flex-1 max-w-[7rem] rounded-full bg-[#eef3f0] overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${(r.files / max) * 100}%`, background: C.blue }} /></span>
                <span className="tabular-nums font-semibold">{count(r.files)}</span>
              </span>
            </td>
            <td className="py-2.5 text-right tabular-nums text-[#0f7a52] font-semibold">{count(r.approved)}</td>
            <td className="py-2.5 text-right tabular-nums">{r.disbursed ? money(r.disbursed) : "—"}</td>
            {showRate && <td className="py-2.5 text-right tabular-nums">{r.rate == null ? "—" : `${r.rate}%`}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
