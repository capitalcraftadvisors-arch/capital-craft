"use client";

// Business-wide "Overview" analytics — visualization-first, in the Capital Craft
// brand palette (greens + the shared status colours; no purple). Self-contained:
// one lean read of loans + leads + EPC names, then everything is derived and
// charted with Recharts. Read-only.

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, ComposedChart, Line, XAxis, YAxis,
  Tooltip, Cell, PieChart, Pie, LabelList, Treemap, Sankey, Layer, Rectangle,
} from "recharts";
import Card from "@/components/ui/Card";
import { supabase } from "@/lib/supabase";

// ── brand palette ────────────────────────────────────────────────────────────
const C = {
  green: "#178a5c", greenDark: "#0f7a52", blue: "#185fa5", amber: "#d97706",
  red: "#dc2626", teal: "#0f766e", slate: "#64748b", ink: "#0f3d2e", grid: "#eef1f4",
};
const LENDER_COLOR: Record<string, string> = { aerem: "#185fa5", creditfair: "#d97706", solfin: "#0f766e" };
const LENDER_LABEL: Record<string, string> = { aerem: "Aerem", creditfair: "Credit Fair", solfin: "Solfin" };
// One colour per pipeline stage (matches the console's stage legend).
const STAGE = [
  { key: "ready", label: "Ready", color: "#94a3b8" },
  { key: "docs_pending", label: "Docs Pending", color: "#d97706" },
  { key: "docs_sent", label: "Docs Sent", color: "#185fa5" },
  { key: "approved", label: "Approved", color: "#178a5c" },
  { key: "phase1", label: "1st Disbursed", color: "#0f766e" },
];
const APPROVED = new Set(["approved", "rfd", "sent_to_nbfc", "disbursed"]);

type LoanRow = Record<string, any>;
type LeadRow = { status: string | null; dead_at: string | null; created_at: string | null };

const num = (v: unknown) => Number(v) || 0;
const money = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);
const inWin = (s: string | null, win: { start: number; end: number }) => { if (!s) return false; const t = Date.parse(s); return !isNaN(t) && t >= win.start && t <= win.end; };

function stageOf(r: LoanRow): string | null {
  if (r.status === "rejected" || r.aborted_at) return null;
  if (r.first_disbursement_amount != null) return r.second_disbursement_amount != null ? null : "phase1";
  if (APPROVED.has(r.status)) return "approved";
  if (r.status === "docs_sent") return "docs_sent";
  if (r.status === "on_hold") return "docs_pending";
  if (r.status === "draft") return null;
  return "ready";
}

export default function OverviewSection({ win, segment }: { win: { start: number; end: number }; segment?: "residential" | "commercial" }) {
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [epcNames, setEpcNames] = useState<Map<string, string>>(new Map());
  const [rmNames, setRmNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = supabase();
      const [l, ld, e, u] = await Promise.all([
        db.from("epc_applications").select("status, plant_use_type, loan_amount_required, loan_amount, sanctioned_amount, first_disbursement_amount, second_disbursement_amount, first_disbursement_date, second_disbursement_date, created_at, updated_at, submitted_at, docs_sent_at, approved_at, approved_lender, rejected_lender, rejection_reason, epc_business_id, assigned_to_user_id, install_state, install_district, central_subsidy, state_subsidy, borrower_pan, borrower_mobile, aborted_at"),
        db.from("loan_leads").select("status, dead_at, created_at"),
        db.from("epc_business").select("id, trade_name, legal_name, contact_name").neq("business_type", "admin"),
        db.from("epc_business").select("id, contact_name").eq("business_type", "admin"),
      ]);
      if (cancelled) return;
      setLoans((l.data ?? []) as LoanRow[]);
      setLeads((ld.data ?? []) as LeadRow[]);
      const m = new Map<string, string>();
      for (const b of (e.data ?? []) as any[]) m.set(b.id, b.trade_name || b.legal_name || b.contact_name || "—");
      setEpcNames(m);
      const rm = new Map<string, string>();
      for (const b of (u.data ?? []) as any[]) rm.set(b.id, b.contact_name || "—");
      setRmNames(rm);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const d = useMemo(() => {
    // Scope to a loan segment (Residential / C&I) when this section is segmented.
    const uni = segment ? loans.filter((l) => l.plant_use_type === segment) : loans;
    const cohort = uni.filter((r) => inWin(r.created_at, win));
    const submitted = cohort.filter((r) => r.status !== "draft");
    const approved = submitted.filter((r) => r.first_disbursement_amount != null || APPROVED.has(r.status));
    const disbursedCount = submitted.filter((r) => r.first_disbursement_amount != null);

    // KPI: live pipeline (active loans, current) + disbursed this month.
    const active = uni.filter((r) => stageOf(r) != null);
    const pipeline = active.reduce((s, r) => s + (num(r.loan_amount_required) || num(r.loan_amount)), 0);
    const now = new Date(); const ny = now.getFullYear(); const nm = now.getMonth();
    const inMonth = (s: string | null) => { if (!s) return false; const x = new Date(s); return x.getFullYear() === ny && x.getMonth() === nm; };
    const disbursedMonth = uni.reduce((s, r) =>
      s + (inMonth(r.first_disbursement_date) ? num(r.first_disbursement_amount) : 0)
        + (inMonth(r.second_disbursement_date) ? num(r.second_disbursement_amount) : 0), 0);
    const overdue = active.filter((r) => r.updated_at && Date.now() - Date.parse(r.updated_at) > 7 * 86400000).length;
    let target = 65; try { target = Number(localStorage.getItem("opsboard.target")) || 65; } catch { /* default */ }
    const approvalRate = submitted.length ? Math.round((approved.length / submitted.length) * 100) : 0;

    // Pipeline value by stage (live active loans).
    const pipeByStage = STAGE.map((st) => ({
      label: st.label, color: st.color,
      value: active.filter((r) => stageOf(r) === st.key).reduce((s, r) => s + (num(r.loan_amount_required) || num(r.loan_amount)), 0),
    })).filter((x) => x.value > 0);

    // Money: sanctioned vs disbursed vs pending (cohort).
    const sanctioned = cohort.reduce((s, r) => s + num(r.sanctioned_amount), 0);
    const disbursedAmt = cohort.reduce((s, r) => s + num(r.first_disbursement_amount) + num(r.second_disbursement_amount), 0);
    const moneyBars = [
      { label: "Sanctioned", value: sanctioned, color: C.green },
      { label: "Disbursed", value: disbursedAmt, color: C.teal },
      { label: "Pending", value: Math.max(0, sanctioned - disbursedAmt), color: C.amber },
    ].filter((x) => x.value > 0);

    // Lender split — disbursed ₹ by the approving lender.
    const lenderMap = new Map<string, number>();
    for (const r of cohort) if (r.first_disbursement_amount != null && r.approved_lender) lenderMap.set(r.approved_lender, (lenderMap.get(r.approved_lender) || 0) + num(r.first_disbursement_amount) + num(r.second_disbursement_amount));
    const lenderSplit = [...lenderMap.entries()].map(([k, v]) => ({ name: LENDER_LABEL[k] ?? k, value: v, color: LENDER_COLOR[k] ?? C.slate })).sort((a, b) => b.value - a.value);

    // Rejection reasons — Pareto (bar + cumulative %).
    const rejMap = new Map<string, number>();
    for (const r of cohort) if (r.status === "rejected") { const reason = (r.rejection_reason || "Unspecified").trim() || "Unspecified"; rejMap.set(reason, (rejMap.get(reason) || 0) + 1); }
    const rejSorted = [...rejMap.entries()].map(([k, v]) => ({ reason: k, count: v })).sort((a, b) => b.count - a.count).slice(0, 6);
    const rejTotal = rejSorted.reduce((s, r) => s + r.count, 0);
    let run = 0;
    const rejection = rejSorted.map((r) => { run += r.count; return { ...r, cum: rejTotal ? Math.round((run / rejTotal) * 100) : 0 }; });

    // Funnel — Lead → Application → Sanctioned → Disbursed (cohort by created_at).
    const leadsN = leads.filter((x) => !x.dead_at && inWin(x.created_at, win)).length;
    const funnelRaw = [
      ...(segment ? [] : [{ label: "Leads", value: leadsN }]),
      { label: "Applications", value: submitted.length },
      { label: "Sanctioned", value: approved.length },
      { label: "Disbursed", value: disbursedCount.length },
    ];
    const fMax = Math.max(1, ...funnelRaw.map((x) => x.value));
    const funnel = funnelRaw.map((x, i) => ({ ...x, pct: Math.round((x.value / fMax) * 100), conv: i === 0 || funnelRaw[i - 1].value === 0 ? null : Math.round((x.value / funnelRaw[i - 1].value) * 100) }));

    // Top EPCs by disbursed ₹.
    const epcMap = new Map<string, number>();
    for (const r of cohort) if (r.epc_business_id) epcMap.set(r.epc_business_id, (epcMap.get(r.epc_business_id) || 0) + num(r.first_disbursement_amount) + num(r.second_disbursement_amount));
    const topEpcs = [...epcMap.entries()].map(([id, v]) => ({ name: epcNames.get(id) || "—", value: v })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);

    // Top states by application count.
    const stMap = new Map<string, number>();
    for (const r of submitted) { const st = (r.install_state || "").trim(); if (st) stMap.set(st, (stMap.get(st) || 0) + 1); }
    const topStates = [...stMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);

    // Monthly applications trend — last 6 calendar months (submitted by created_at).
    const monTrend: { label: string; value: number }[] = [];
    const base = new Date();
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const y = dt.getFullYear(), mo = dt.getMonth();
      const value = uni.filter((r) => r.status !== "draft" && r.created_at && new Date(r.created_at).getFullYear() === y && new Date(r.created_at).getMonth() === mo).length;
      monTrend.push({ label: dt.toLocaleDateString("en-IN", { month: "short" }), value });
    }

    // Aging snapshot — live active loans by idle band (updated_at).
    const idleDays = (r: LoanRow) => (r.updated_at ? Math.floor((Date.now() - Date.parse(r.updated_at)) / 86400000) : 0);
    const aging = [
      { label: "On track · ≤ 7d", value: active.filter((r) => idleDays(r) <= 7).length, color: "#178a5c" },
      { label: "Watch · 7–14d", value: active.filter((r) => idleDays(r) > 7 && idleDays(r) <= 14).length, color: "#d97706" },
      { label: "Overdue · > 14d", value: active.filter((r) => idleDays(r) > 14).length, color: "#dc2626" },
    ];

    // Avg ticket size — RESI vs C&I (loan_amount_required, submitted cohort).
    const avgOf = (rows: LoanRow[]) => { const v = rows.map((r) => num(r.loan_amount_required) || num(r.loan_amount)).filter((x) => x > 0); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; };
    const avgTicket = [
      { name: "Residential", value: avgOf(submitted.filter((r) => r.plant_use_type === "residential")), color: C.green },
      { name: "C&I", value: avgOf(submitted.filter((r) => r.plant_use_type === "commercial")), color: C.blue },
    ].filter((x) => x.value > 0);

    // Lender scorecard — approved count + disbursed ₹ per approving lender.
    const lsMap = new Map<string, { approved: number; disbursed: number }>();
    for (const r of cohort) if (r.approved_lender && (r.first_disbursement_amount != null || APPROVED.has(r.status))) {
      const cur = lsMap.get(r.approved_lender) || { approved: 0, disbursed: 0 };
      cur.approved += 1; cur.disbursed += num(r.first_disbursement_amount) + num(r.second_disbursement_amount);
      lsMap.set(r.approved_lender, cur);
    }
    const lenderScore = [...lsMap.entries()].map(([k, v]) => ({ name: LENDER_LABEL[k] ?? k, color: LENDER_COLOR[k] ?? C.slate, ...v })).sort((a, b) => b.disbursed - a.disbursed);

    // RM leaderboard — applications + disbursed ₹ per assigned owner.
    const rmMap = new Map<string, { apps: number; disbursed: number }>();
    for (const r of submitted) if (r.assigned_to_user_id) {
      const cur = rmMap.get(r.assigned_to_user_id) || { apps: 0, disbursed: 0 };
      cur.apps += 1; cur.disbursed += num(r.first_disbursement_amount) + num(r.second_disbursement_amount);
      rmMap.set(r.assigned_to_user_id, cur);
    }
    const rmBoard = [...rmMap.entries()].map(([id, v]) => ({ name: rmNames.get(id) || "—", ...v })).sort((a, b) => b.disbursed - a.disbursed).slice(0, 8);

    // Stage-duration bottleneck — avg days between consecutive stage timestamps
    // (only where both ends exist and the gap is non-negative). Pinpoints the
    // slow step across the whole pipeline.
    const DAY = 86400000;
    const avgGap = (rows: LoanRow[], from: string, to: string) => {
      const gaps: number[] = [];
      for (const r of rows) {
        const a = r[from] ? Date.parse(r[from]) : NaN, b = r[to] ? Date.parse(r[to]) : NaN;
        if (!isNaN(a) && !isNaN(b) && b >= a) gaps.push((b - a) / DAY);
      }
      return gaps.length ? Math.round((gaps.reduce((s, x) => s + x, 0) / gaps.length) * 10) / 10 : 0;
    };
    const stageDuration = [
      { name: "Submitted → Docs sent", value: avgGap(cohort, "submitted_at", "docs_sent_at"), color: "#94a3b8" },
      { name: "Docs sent → Approved", value: avgGap(cohort, "docs_sent_at", "approved_at"), color: "#185fa5" },
      { name: "Approved → 1st disb.", value: avgGap(cohort, "approved_at", "first_disbursement_date"), color: "#178a5c" },
      { name: "1st → 2nd disb.", value: avgGap(cohort, "first_disbursement_date", "second_disbursement_date"), color: "#0f766e" },
    ].filter((x) => x.value > 0);

    // Disbursement forecast — loans with 1st tranche paid but 2nd pending; their
    // 45-day deadline (first_disbursement_date + 45d) bucketed by how soon it's due.
    const pending2nd = uni.filter((r) => r.first_disbursement_date && r.first_disbursement_amount != null && r.second_disbursement_amount == null && r.status !== "rejected" && !r.aborted_at);
    const forecastBuckets = [
      { name: "Overdue", color: "#dc2626", lo: -Infinity, hi: 0 },
      { name: "≤ 15 days", color: "#d97706", lo: 0, hi: 15 },
      { name: "16–30 days", color: "#185fa5", lo: 15, hi: 30 },
      { name: "31–45 days", color: "#178a5c", lo: 30, hi: 46 },
    ];
    const forecast = forecastBuckets.map((b) => {
      const rows = pending2nd.filter((r) => { const daysLeft = (Date.parse(r.first_disbursement_date) + 45 * DAY - Date.now()) / DAY; return daysLeft >= b.lo && daysLeft < b.hi; });
      const expected = rows.reduce((s, r) => s + Math.max(0, (num(r.loan_amount_required) || num(r.loan_amount)) - num(r.first_disbursement_amount)), 0);
      return { name: b.name, color: b.color, count: rows.length, value: expected };
    }).filter((b) => b.count > 0);

    // TAT distribution — days submitted→1st disbursed, bucketed (histogram).
    const tatBuckets = [
      { name: "0–15d", lo: 0, hi: 15, value: 0, color: "#178a5c" },
      { name: "15–30d", lo: 15, hi: 30, value: 0, color: "#0f766e" },
      { name: "30–45d", lo: 30, hi: 45, value: 0, color: "#d97706" },
      { name: "45d+", lo: 45, hi: Infinity, value: 0, color: "#dc2626" },
    ];
    for (const r of cohort) {
      const start = r.submitted_at ? Date.parse(r.submitted_at) : (r.created_at ? Date.parse(r.created_at) : NaN);
      const end = r.first_disbursement_date ? Date.parse(r.first_disbursement_date) : NaN;
      if (!isNaN(start) && !isNaN(end) && end >= start) { const dd = (end - start) / DAY; const b = tatBuckets.find((x) => dd >= x.lo && dd < x.hi); if (b) b.value++; }
    }
    const tatHist = tatBuckets.some((b) => b.value > 0) ? tatBuckets : [];

    // Subsidy — projects claiming central vs state subsidy (₹ totals).
    const cen = submitted.filter((r) => num(r.central_subsidy) > 0);
    const stt = submitted.filter((r) => num(r.state_subsidy) > 0);
    const subsidy = (cen.length || stt.length) ? [
      { name: `Central · ${cen.length}`, value: cen.reduce((s, r) => s + num(r.central_subsidy), 0), color: C.green },
      { name: `State · ${stt.length}`, value: stt.reduce((s, r) => s + num(r.state_subsidy), 0), color: C.blue },
    ].filter((x) => x.value > 0) : [];

    // Cohort grid — last 6 months × how far each month's apps got (row-normalised heat).
    const cohortStages = ["Submitted", "Docs sent", "Approved", "Disbursed"];
    const cmonths: { y: number; m: number; label: string }[] = [];
    for (let i = 5; i >= 0; i--) { const dt = new Date(base.getFullYear(), base.getMonth() - i, 1); cmonths.push({ y: dt.getFullYear(), m: dt.getMonth(), label: dt.toLocaleDateString("en-IN", { month: "short" }) }); }
    const cohortGrid = cmonths.map((cm) => {
      const rows = submitted.filter((r) => r.created_at && new Date(r.created_at).getFullYear() === cm.y && new Date(r.created_at).getMonth() === cm.m);
      const reached = [
        rows.length,
        rows.filter((r) => r.docs_sent_at || r.status === "docs_sent" || APPROVED.has(r.status) || r.first_disbursement_amount != null).length,
        rows.filter((r) => APPROVED.has(r.status) || r.first_disbursement_amount != null).length,
        rows.filter((r) => r.first_disbursement_amount != null).length,
      ];
      return { label: cm.label, total: rows.length, reached };
    });

    // EPC partner treemap — sized by disbursed ₹ (top 12).
    const epcTree = [...epcMap.entries()].map(([id, v]) => ({ name: epcNames.get(id) || "—", size: v })).filter((x) => x.size > 0).sort((a, b) => b.size - a.size).slice(0, 12);

    // Sankey — Application → Lender → Outcome.
    const lkeys = ["aerem", "creditfair", "solfin"];
    const outcomeOf = (r: LoanRow) => (r.first_disbursement_amount != null || APPROVED.has(r.status) ? "approved" : r.status === "rejected" ? "rejected" : null);
    const flow: Record<string, { approved: number; rejected: number }> = {};
    for (const r of cohort) {
      const lk = r.approved_lender || r.rejected_lender; if (!lk || !lkeys.includes(lk)) continue;
      const oc = outcomeOf(r); if (!oc) continue;
      (flow[lk] ||= { approved: 0, rejected: 0 })[oc as "approved" | "rejected"]++;
    }
    const activeLk = lkeys.filter((k) => flow[k] && (flow[k].approved + flow[k].rejected) > 0);
    let sankey: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] } | null = null;
    if (activeLk.length) {
      const nodes = [{ name: "Applications" }, ...activeLk.map((k) => ({ name: LENDER_LABEL[k] })), { name: "Approved" }, { name: "Rejected" }];
      const apIdx = 0, apprIdx = 1 + activeLk.length, rejIdx = apprIdx + 1;
      const links: { source: number; target: number; value: number }[] = [];
      activeLk.forEach((k, i) => {
        const li = 1 + i; const f = flow[k];
        if (f.approved + f.rejected > 0) links.push({ source: apIdx, target: li, value: f.approved + f.rejected });
        if (f.approved > 0) links.push({ source: li, target: apprIdx, value: f.approved });
        if (f.rejected > 0) links.push({ source: li, target: rejIdx, value: f.rejected });
      });
      sankey = { nodes, links };
    }

    // Duplicate applications — sharing a PAN or mobile (data-quality flag).
    const keyCount = new Map<string, number>();
    for (const r of submitted) { const k = (r.borrower_pan || "").toUpperCase() || (r.borrower_mobile || ""); if (k) keyCount.set(k, (keyCount.get(k) || 0) + 1); }
    const dupGroups = [...keyCount.values()].filter((c) => c > 1).length;
    const dupApps = [...keyCount.values()].filter((c) => c > 1).reduce((s, c) => s + c, 0);

    return {
      pipeline, disbursedMonth, target, overdue, approvalRate, activeCount: active.length,
      pipeByStage, moneyBars, lenderSplit, rejection, funnel, topEpcs, topStates,
      monTrend, aging, avgTicket, lenderScore, rmBoard, stageDuration, forecast,
      tatHist, subsidy, cohortStages, cohortGrid, epcTree, sankey, dupGroups, dupApps,
      submitted: submitted.length,
    };
  }, [loans, leads, epcNames, rmNames, win, segment]);

  if (loading) return <p className="text-[13px] text-text-muted">Loading…</p>;

  const ringPct = Math.min(100, d.target > 0 ? Math.round((d.disbursedMonth / (d.target * 1e5)) * 100) : 0);

  return (
    <div className="space-y-4">
      {/* KPI tiles */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Tile label="Pipeline value" value={money(d.pipeline)} sub={`${d.activeCount} active`} accent={C.green} />
        <RingTile label="Disbursed · this month" value={money(d.disbursedMonth)} sub={`Target ${money(d.target * 1e5)}`} pct={ringPct} />
        <Tile label="Approval rate" value={`${d.approvalRate}%`} sub={`${d.submitted} in period`} accent={C.greenDark} />
        <Tile label="Active applications" value={String(d.activeCount)} accent={C.blue} />
        <Tile label="Overdue" value={String(d.overdue)} sub="idle > 7 days" accent={d.overdue > 0 ? C.red : C.slate} />
      </div>

      {/* Data-quality flag — applications sharing a PAN/mobile. */}
      {d.dupApps > 0 && (
        <div className="rounded-xl border border-[#f5d98a] bg-[#fff7e6] px-4 py-2.5 text-[13px] text-[#8a5a00] flex items-center gap-2">
          <span aria-hidden>⚠</span>
          <span><b>{d.dupApps}</b> application{d.dupApps === 1 ? "" : "s"} share a PAN or mobile with another ({d.dupGroups} group{d.dupGroups === 1 ? "" : "s"}) — possible duplicates worth checking.</span>
        </div>
      )}

      {/* Row 1 — pipeline money + funnel */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Pipeline value by stage">
          {d.pipeByStage.length === 0 ? <Empty /> : (
            <HBars data={d.pipeByStage.map((x) => ({ name: x.label, value: x.value, color: x.color }))} fmt={money} />
          )}
        </Panel>
        <Panel title="Funnel — Lead → Disbursed">
          {d.funnel.every((f) => f.value === 0) ? <Empty /> : <Funnel steps={d.funnel} />}
        </Panel>
      </div>

      {/* Row 2 — lender split + rejection pareto */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Disbursed by lender">
          {d.lenderSplit.length === 0 ? <Empty /> : <Donut data={d.lenderSplit} fmt={money} />}
        </Panel>
        <Panel title="Why loans get rejected">
          {d.rejection.length === 0 ? <Empty /> : <Pareto data={d.rejection} />}
        </Panel>
      </div>

      {/* Row 3 — money bars + top states */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Sanctioned · Disbursed · Pending">
          {d.moneyBars.length === 0 ? <Empty /> : <HBars data={d.moneyBars.map((x) => ({ name: x.label, value: x.value, color: x.color }))} fmt={money} />}
        </Panel>
        <Panel title="Applications by state">
          {d.topStates.length === 0 ? <Empty /> : <HBars data={d.topStates.map((x) => ({ name: x.name, value: x.value, color: C.blue }))} fmt={(v) => String(v)} />}
        </Panel>
      </div>

      {/* Row 4 — monthly trend + avg ticket */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Applications · last 6 months">
          {d.monTrend.every((m) => m.value === 0) ? <Empty /> : <VBars data={d.monTrend} />}
        </Panel>
        <Panel title="Avg ticket size">
          {d.avgTicket.length === 0 ? <Empty /> : <HBars data={d.avgTicket.map((x) => ({ name: x.name, value: x.value, color: x.color }))} fmt={money} />}
        </Panel>
      </div>

      {/* Row 5 — aging + lender scorecard */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Aging — active loans by idle time">
          {d.aging.every((a) => a.value === 0) ? <Empty /> : <HBars data={d.aging.map((a) => ({ name: a.label, value: a.value, color: a.color }))} fmt={(v) => String(v)} />}
        </Panel>
        <Panel title="Lender scorecard">
          {d.lenderScore.length === 0 ? <Empty /> : <ScoreCard rows={d.lenderScore} fmt={money} />}
        </Panel>
      </div>

      {/* Row 6 — top EPCs + RM leaderboard */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top EPC partners — disbursed ₹">
          {d.topEpcs.length === 0 ? <Empty /> : <Leaderboard rows={d.topEpcs} fmt={money} />}
        </Panel>
        <Panel title="Team — disbursed ₹ by owner">
          {d.rmBoard.length === 0 ? <Empty /> : <Leaderboard rows={d.rmBoard.map((r) => ({ name: r.name, value: r.disbursed }))} fmt={money} />}
        </Panel>
      </div>

      {/* Row 7 — bottleneck + forecast */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Stage duration — avg days at each step">
          {d.stageDuration.length === 0 ? <Empty /> : <HBars data={d.stageDuration} fmt={(v) => `${v} d`} />}
        </Panel>
        <Panel title="Disbursement forecast — 2nd tranche due">
          {d.forecast.length === 0 ? <Empty /> : <ForecastTable rows={d.forecast} fmt={money} />}
        </Panel>
      </div>

      {/* Row 8 — TAT histogram + subsidy */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Turnaround — submitted to 1st disbursal">
          {d.tatHist.length === 0 ? <Empty /> : <HBars data={d.tatHist.map((b) => ({ name: b.name, value: b.value, color: b.color }))} fmt={(v) => `${v}`} />}
        </Panel>
        <Panel title="Subsidy claimed — central vs state">
          {d.subsidy.length === 0 ? <Empty /> : <HBars data={d.subsidy} fmt={money} />}
        </Panel>
      </div>

      {/* Row 9 — cohort heatmap */}
      <Panel title="Cohort — how far each month's applications got">
        {d.cohortGrid.every((r) => r.total === 0) ? <Empty /> : <Heatmap stages={d.cohortStages} grid={d.cohortGrid} />}
      </Panel>

      {/* Row 10 — EPC treemap + lender-flow Sankey */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="EPC partners — share of disbursed ₹">
          {d.epcTree.length === 0 ? <Empty /> : <TreemapChart data={d.epcTree} fmt={money} />}
        </Panel>
        <Panel title="Lender flow — application → lender → outcome">
          {!d.sankey ? <Empty /> : <SankeyChart data={d.sankey} />}
        </Panel>
      </div>
    </div>
  );
}

// Month × stage retention heatmap (green intensity = share of the month reaching that stage).
function Heatmap({ stages, grid }: { stages: string[]; grid: { label: string; total: number; reached: number[] }[] }) {
  const cell = (v: number, total: number) => {
    const ratio = total ? v / total : 0;
    const bg = ratio === 0 ? "#f4f7f6" : `rgba(23,138,92,${0.12 + ratio * 0.78})`;
    const fg = ratio > 0.55 ? "#fff" : "#0f3d2e";
    return { bg, fg };
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]" style={{ minWidth: 380 }}>
        <thead>
          <tr>
            <th className="text-left font-medium text-text-muted py-1.5 pr-2">Month</th>
            {stages.map((s) => <th key={s} className="text-center font-medium text-text-muted py-1.5 px-1">{s}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => (
            <tr key={row.label}>
              <td className="py-1 pr-2 font-semibold text-text whitespace-nowrap">{row.label}</td>
              {row.reached.map((v, i) => { const c = cell(v, row.total); return (
                <td key={i} className="py-1 px-1">
                  <div className="rounded-md text-center py-1.5 font-semibold" style={{ backgroundColor: c.bg, color: c.fg }}>{v}</div>
                </td>
              ); })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// EPC partner treemap — rectangle size = disbursed ₹.
const TREE_COLORS = ["#178a5c", "#0f766e", "#185fa5", "#0e7490", "#0f7a52", "#3b5a76", "#5a8a76", "#94a3b8"];
function TreemapChart({ data, fmt }: { data: { name: string; size: number }[]; fmt: (v: number) => string }) {
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <Treemap data={data} dataKey="size" nameKey="name" stroke="#fff" content={<TreeCell fmt={fmt} />} isAnimationActive={false} />
      </ResponsiveContainer>
    </div>
  );
}
function TreeCell(props: any) {
  const { x, y, width, height, index, name, size, fmt } = props;
  const color = TREE_COLORS[index % TREE_COLORS.length];
  const show = width > 54 && height > 26;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={color} stroke="#fff" />
      {show && (
        <>
          <text x={x + 6} y={y + 16} fill="#fff" style={{ fontSize: 11, fontWeight: 700 }}>{name}</text>
          <text x={x + 6} y={y + 30} fill="#eafff5" style={{ fontSize: 10 }}>{fmt(size)}</text>
        </>
      )}
    </g>
  );
}

// Lender-flow Sankey.
function SankeyChart({ data }: { data: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] } }) {
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <Sankey data={data} nodePadding={26} margin={{ top: 8, right: 90, bottom: 8, left: 8 }}
          link={{ stroke: "#178a5c", strokeOpacity: 0.25 }} node={<SankeyNode />}>
          <Tooltip />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
function SankeyNode(props: any) {
  const { x, y, width, height, payload } = props;
  const right = x < 200;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill="#178a5c" fillOpacity={0.9} radius={2} />
      <text x={right ? x + width + 6 : x - 6} y={y + height / 2} textAnchor={right ? "start" : "end"} dominantBaseline="middle" style={{ fontSize: 11, fontWeight: 600, fill: "#0f3d2e" }}>
        {payload.name}
      </text>
    </Layer>
  );
}

// Upcoming 2nd-tranche deadlines by window (loans + expected outflow).
function ForecastTable({ rows, fmt }: { rows: { name: string; color: string; count: number; value: number }[]; fmt: (v: number) => string }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-line">
          <th className="text-left font-medium py-1.5">Due window</th>
          <th className="text-right font-medium py-1.5">Loans</th>
          <th className="text-right font-medium py-1.5">Expected ₹</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-b border-[#f0f4f2] last:border-0">
            <td className="py-2 font-semibold text-text">
              <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />{r.name}</span>
            </td>
            <td className="py-2 text-right text-text">{r.count}</td>
            <td className="py-2 text-right font-semibold text-text">{fmt(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Vertical time-series bars (monthly trend).
function VBars({ data }: { data: { label: string; value: number }[] }) {
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.slate }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: C.slate }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: "#f1f5f4" }} />
          <Bar dataKey="value" fill={C.green} radius={[6, 6, 0, 0]} barSize={34}>
            <LabelList dataKey="value" position="top" style={{ fontSize: 11, fontWeight: 700, fill: C.ink }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Lender scorecard — a compact table (approved count + disbursed ₹).
function ScoreCard({ rows, fmt }: { rows: { name: string; color: string; approved: number; disbursed: number }[]; fmt: (v: number) => string }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-line">
          <th className="text-left font-medium py-1.5">Lender</th>
          <th className="text-right font-medium py-1.5">Approved</th>
          <th className="text-right font-medium py-1.5">Disbursed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-b border-[#f0f4f2] last:border-0">
            <td className="py-2 font-semibold text-text">
              <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />{r.name}</span>
            </td>
            <td className="py-2 text-right text-text">{r.approved}</td>
            <td className="py-2 text-right font-semibold text-text">{fmt(r.disbursed)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── presentational pieces (brand palette) ────────────────────────────────────
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-semibold text-text mb-3">{title}</p>
      {children}
    </Card>
  );
}
function Empty() {
  return <div className="h-[180px] grid place-items-center text-[12px] text-text-muted border border-dashed border-line rounded-lg">No data in this period.</div>;
}
function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="inline-block w-1.5 h-4 rounded-full shrink-0" style={{ backgroundColor: accent }} />
        <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className="text-[24px] font-display font-bold text-text mt-1.5 leading-none">{value}</div>
      {sub && <div className="text-[11px] text-text-muted mt-1 truncate">{sub}</div>}
    </Card>
  );
}
function RingTile({ label, value, sub, pct }: { label: string; value: string; sub?: string; pct: number }) {
  const r = 18, circ = 2 * Math.PI * r, off = circ * (1 - pct / 100);
  const color = pct >= 100 ? C.green : pct >= 60 ? C.greenDark : pct >= 30 ? C.amber : C.red;
  return (
    <Card className="p-4 flex items-center gap-3">
      <svg width="48" height="48" viewBox="0 0 48 48" className="shrink-0 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke={C.grid} strokeWidth="5" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} />
        <text x="24" y="24" transform="rotate(90 24 24)" textAnchor="middle" dominantBaseline="central" style={{ fontSize: 12, fontWeight: 700, fill: C.ink }}>{pct}%</text>
      </svg>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-text-muted uppercase tracking-wide truncate">{label}</div>
        <div className="text-[18px] font-display font-bold text-text leading-none mt-1">{value}</div>
        {sub && <div className="text-[11px] text-text-muted mt-1 truncate">{sub}</div>}
      </div>
    </Card>
  );
}

// Horizontal coloured bars (money or count).
function HBars({ data, fmt }: { data: { name: string; value: number; color: string }[]; fmt: (v: number) => string }) {
  return (
    <div style={{ width: "100%", height: Math.max(160, data.length * 40) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 4, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: C.ink }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v: number) => fmt(v)} cursor={{ fill: "#f1f5f4" }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={20}>
            {data.map((e, i) => <Cell key={i} fill={e.color} />)}
            <LabelList dataKey="value" position="right" formatter={(v: number) => fmt(v)} style={{ fontSize: 11, fontWeight: 700, fill: C.ink }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Donut with a right-side legend.
function Donut({ data, fmt }: { data: { name: string; value: number; color: string }[]; fmt: (v: number) => string }) {
  const total = data.reduce((s, e) => s + e.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div style={{ width: 170, height: 180 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
              {data.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Pie>
            <Tooltip formatter={(v: number) => fmt(v)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {data.map((e) => (
          <div key={e.name} className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-[13px] text-text min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
              <span className="truncate">{e.name}</span>
            </span>
            <span className="text-[13px] font-semibold text-text shrink-0">{fmt(e.value)}<span className="text-text-muted font-normal"> · {total ? Math.round((e.value / total) * 100) : 0}%</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Rejection Pareto: bars (count) + cumulative % line.
function Pareto({ data }: { data: { reason: string; count: number; cum: number }[] }) {
  return (
    <div style={{ width: "100%", height: 210 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <XAxis dataKey="reason" tick={{ fontSize: 10, fill: C.slate }} interval={0} angle={-12} textAnchor="end" height={48} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={{ fontSize: 11, fill: C.slate }} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: C.slate }} axisLine={false} tickLine={false} unit="%" />
          <Tooltip />
          <Bar yAxisId="l" dataKey="count" fill={C.red} radius={[6, 6, 0, 0]} barSize={26} />
          <Line yAxisId="r" dataKey="cum" stroke={C.ink} strokeWidth={2} dot={{ r: 3, fill: C.ink }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Funnel — stacked bars with value + step conversion %.
function Funnel({ steps }: { steps: { label: string; value: number; pct: number; conv: number | null }[] }) {
  return (
    <div className="space-y-2.5 py-1">
      {steps.map((s) => (
        <div key={s.label}>
          <div className="flex items-center justify-between text-[12px] mb-1">
            <span className="font-medium text-text">{s.label}</span>
            <span className="text-text-muted">
              <b className="text-text">{s.value}</b>{s.conv != null && s.conv <= 100 && <span className="ml-2 text-[11px]">{s.conv}% ↓</span>}
            </span>
          </div>
          <div className="h-6 rounded-md bg-[#eef1f4] overflow-hidden">
            <div className="h-full rounded-md" style={{ width: `${Math.max(4, s.pct)}%`, backgroundColor: C.green }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Leaderboard with an in-cell value bar.
function Leaderboard({ rows, fmt }: { rows: { name: string; value: number }[]; fmt: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-5 text-[12px] font-semibold text-text-muted text-right shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-[12.5px] mb-0.5">
              <span className="truncate text-text font-medium">{r.name}</span>
              <span className="font-semibold text-text shrink-0 ml-2">{fmt(r.value)}</span>
            </div>
            <div className="h-2 rounded-full bg-[#eef1f4] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, backgroundColor: C.green }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
