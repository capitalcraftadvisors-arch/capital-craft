"use client";

// Analytics — the Insurance, EPC and Geography section views and the cross-business comparison table.

import { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList } from "recharts";
import Card from "@/components/ui/Card";
import EpcHealthPanel from "@/components/analytics/EpcHealthPanel";
import { lenderOutcome } from "@/lib/loan-status";
import type { Win, Windows } from "@/lib/periods";
import {
  MIN_CHART, GEO_MIN_INSIGHT, GEO_UNKNOWN, t, inWin, fmtInt, fmtPct1, fmtDays,
  toDeltas, buildSummary, buildWhatChanged, insHealth, epcHealth, normPlace, groupPlaces, topBars, geoInsights,
  type Loan, type LoanSection, type InsSection, type EpcSection, type GeoBar, type GeoMetric,
} from "./metrics";
import { GEO, SLATE, SummaryBar, KpiCard, EmptyState, ChartCard, TrendChart, FunnelBars, DonutChart, SimpleBar, HealthCard, WhatChangedCard } from "./cards";

// ── section views (identical order/layout across sections) ────────────────────
export function InsSectionView({ s, w }: { s: InsSection; w: Windows }) {
  const deltas = toDeltas(s.kpis);
  return (
    <div className="space-y-6">
      <SummaryBar text={buildSummary("Insurance", deltas, w)} />
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {s.kpis.map((k) => <KpiCard key={k.label} k={k} />)}
        {/* Omitted metric — clean empty state (approved). */}
        <Card className="p-4">
          <p className="text-[12px] text-text-muted">Avg TAT (create → issue)</p>
          <p className="text-[15px] font-semibold text-text mt-2">Not tracked yet</p>
          <p className="text-[11px] text-text-muted mt-1">Will populate once issuance tracking begins.</p>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><WhatChangedCard wc={buildWhatChanged(deltas)} /></div>
        <HealthCard h={insHealth(s)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Applications trend (current vs previous)"><TrendChart data={s.trend} /></ChartCard>
        <ChartCard title="Funnel — Applied → Issued"><FunnelBars stages={[{ label: "Applied", value: s.funnel.applied }, { label: "Issued", value: s.funnel.issued }]} /></ChartCard>
        <ChartCard title="Issued vs Rejected vs Pending"><DonutChart data={[{ name: "Issued", value: s.donut.issued, color: "#178a5c" }, { name: "Rejected", value: s.donut.rejected, color: "#b42318" }, { name: "Pending", value: s.donut.pending, color: SLATE }]} /></ChartCard>
      </div>
    </div>
  );
}

export function EpcSectionView({ s, w }: { s: EpcSection; w: Windows }) {
  const deltas = toDeltas(s.kpis);
  return (
    <div className="space-y-6">
      <EpcHealthPanel />
      <SummaryBar text={buildSummary("EPC", deltas, w)} />
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">{s.kpis.map((k) => <KpiCard key={k.label} k={k} />)}</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><WhatChangedCard wc={buildWhatChanged(deltas)} /></div>
        <HealthCard h={epcHealth(s)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Fill-time distribution"><SimpleBar data={s.fillHist.map((b) => ({ name: b.label, value: b.count }))} /></ChartCard>
        <ChartCard title="Filled in one go">{s.oneGo.length ? <DonutChart data={[{ name: "One go", value: s.oneGo[0].value, color: "#178a5c" }, { name: "Multi-session", value: s.oneGo[1].value, color: SLATE }]} /> : <EmptyState />}</ChartCard>
      </div>
    </div>
  );
}

// ── geography views ──────────────────────────────────────────────────────────
function HBars({ data, accent }: { data: GeoBar[]; accent: string }) {
  if (data.reduce((s, d) => s + d.value, 0) < MIN_CHART) return <EmptyState />;
  const height = Math.max(130, data.length * 34);
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 6, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={96} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} formatter={(v: number) => [v, "Count"]} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={d.label === "Others" || d.label === "Unknown" ? "#cbd5e1" : accent} fillOpacity={d.label === "Others" || d.label === "Unknown" ? 1 : 1 - i * 0.08} />
            ))}
            <LabelList dataKey="valueLabel" position="right" style={{ fontSize: 10, fill: "#6b7280", fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const GEO_METRICS: { key: GeoMetric; label: string; noun: string }[] = [
  { key: "apps", label: "Applications", noun: "applications" },
  { key: "sanctioned", label: "Sanctioned", noun: "sanctioned" },
  { key: "disbursed", label: "Disbursed", noun: "disbursed" },
];

// Reused inside Residential / C&I sections and the combined Geography tab.
function GeoBlock({ loans, w, accent = GEO }: { loans: Loan[]; w: Windows; accent?: string }) {
  const [metric, setMetric] = useState<GeoMetric>("apps");
  const { cur, prev, noun, appsCurLen } = useMemo(() => {
    const isSan = (r: Loan) => lenderOutcome(r.status) === "approved";
    const isDisb = (r: Loan) => r.status === "approved" && r.first_disbursement_amount != null && !!r.first_disbursement_date;
    const pass = (r: Loan) => metric === "apps" ? true : metric === "sanctioned" ? isSan(r) : isDisb(r);
    const coh = (win: Win, f: (r: Loan) => boolean) => loans.filter((r) => inWin(t(r.created_at), win) && f(r));
    return {
      cur: coh(w.cur, pass), prev: coh(w.prev, pass),
      noun: GEO_METRICS.find((x) => x.key === metric)!.noun,
      appsCurLen: loans.filter((r) => inWin(t(r.created_at), w.cur)).length,
    };
  }, [loans, w, metric]);

  const insights = appsCurLen >= GEO_MIN_INSIGHT ? geoInsights(cur, prev, noun) : [];

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <p className="text-[13px] font-semibold text-text inline-flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} /> Geography
        </p>
        <div className="inline-flex rounded-input border border-line bg-white p-0.5">
          {GEO_METRICS.map((m) => {
            const on = metric === m.key;
            return (
              <button key={m.key} type="button" onClick={() => setMetric(m.key)}
                className="px-2.5 py-1 rounded-[7px] text-[12px] font-semibold transition-colors"
                style={on ? { backgroundColor: accent + "1a", color: accent } : { color: "var(--muted)" }}>
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        <div><p className="text-[12px] font-semibold text-text-mid mb-2">Top cities</p><HBars data={topBars(groupPlaces(cur, "install_city"))} accent={accent} /></div>
        <div><p className="text-[12px] font-semibold text-text-mid mb-2">Top districts</p><HBars data={topBars(groupPlaces(cur, "install_district"))} accent={accent} /></div>
        <div><p className="text-[12px] font-semibold text-text-mid mb-2">Top states</p><HBars data={topBars(groupPlaces(cur, "install_state"))} accent={accent} /></div>
      </div>
      {insights.length > 0 && (
        <div className="mt-4 border-t border-line pt-3 space-y-1.5">
          {insights.map((x, i) => (
            <p key={i} className="text-[12.5px] text-text-mid leading-snug flex gap-1.5"><span style={{ color: accent }}>•</span><span>{x}</span></p>
          ))}
        </div>
      )}
    </Card>
  );
}

function GeoStateTable({ loans, w }: { loans: Loan[]; w: Windows }) {
  const [sortDesc, setSortDesc] = useState(true);
  const rows = useMemo(() => {
    const isSan = (r: Loan) => lenderOutcome(r.status) === "approved";
    const isDisb = (r: Loan) => r.status === "approved" && r.first_disbursement_amount != null && !!r.first_disbursement_date;
    const cur = loans.filter((r) => inWin(t(r.created_at), w.cur));
    const m = new Map<string, { label: string; apps: number; san: number; disb: number }>();
    for (const r of cur) {
      const np = normPlace(r.install_state);
      const key = np ? np.key : GEO_UNKNOWN;
      const e = m.get(key) ?? { label: np ? np.label : "Unknown", apps: 0, san: 0, disb: 0 };
      e.apps++; if (isSan(r)) e.san++; if (isDisb(r)) e.disb++;
      m.set(key, e);
    }
    const arr = [...m.values()].map((e) => ({ ...e, rate: e.apps ? (e.san / e.apps) * 100 : null }));
    arr.sort((a, b) => (sortDesc ? b.apps - a.apps : a.apps - b.apps));
    return arr;
  }, [loans, w, sortDesc]);

  return (
    <Card className="p-5">
      <p className="text-[13px] font-semibold text-text mb-3">State summary (current period)</p>
      {rows.length === 0 ? <EmptyState /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-text-muted border-b border-line">
              <tr>
                <th className="text-left py-2 pr-3 font-medium">State</th>
                <th className="text-center py-2 px-3 font-medium">
                  <button type="button" onClick={() => setSortDesc((v) => !v)} className="inline-flex items-center gap-1 uppercase tracking-wide">
                    Applications <span className="opacity-60">{sortDesc ? "↓" : "↑"}</span>
                  </button>
                </th>
                <th className="text-center py-2 px-3 font-medium">Sanctioned</th>
                <th className="text-center py-2 px-3 font-medium">Disbursed</th>
                <th className="text-center py-2 pl-3 font-medium">Approval rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-[#eef1f4] last:border-0">
                  <td className="py-2.5 pr-3 font-semibold text-text">{r.label}</td>
                  <td className="py-2.5 px-3 text-center">{fmtInt(r.apps)}</td>
                  <td className="py-2.5 px-3 text-center">{fmtInt(r.san)}</td>
                  <td className="py-2.5 px-3 text-center">{fmtInt(r.disb)}</td>
                  <td className="py-2.5 pl-3 text-center">{r.rate == null ? "—" : fmtPct1(r.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

type GeoScope = "res" | "com" | "both";
export function GeographySectionView({ resLoans, comLoans, allLoans, w }: { resLoans: Loan[]; comLoans: Loan[]; allLoans: Loan[]; w: Windows }) {
  const [scope, setScope] = useState<GeoScope>("both");
  const loans = scope === "res" ? resLoans : scope === "com" ? comLoans : allLoans;
  const scopeTabs: { key: GeoScope; label: string }[] = [
    { key: "res", label: "Residential" }, { key: "com", label: "C&I" }, { key: "both", label: "Both" },
  ];
  const curLen = loans.filter((r) => inWin(t(r.created_at), w.cur)).length;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[13px] font-semibold text-text">Loan geography</span>
        <div className="inline-flex rounded-input border border-line bg-white p-0.5">
          {scopeTabs.map((s) => {
            const on = scope === s.key;
            return (
              <button key={s.key} type="button" onClick={() => setScope(s.key)}
                className="px-3 py-1.5 rounded-[7px] text-[12.5px] font-semibold transition-colors"
                style={on ? { backgroundColor: GEO + "1a", color: GEO } : { color: "var(--muted)" }}>
                {s.label}
              </button>
            );
          })}
        </div>
        <span className="text-[12px] text-text-muted ml-auto">{curLen} application{curLen === 1 ? "" : "s"} in {w.label.toLowerCase()}</span>
      </div>
      <GeoBlock loans={loans} w={w} />
      <GeoStateTable loans={loans} w={w} />
    </div>
  );
}

// ── cross-business comparison table ──────────────────────────────────────────
export function CrossTable({ res, com, ins, epc }: { res: LoanSection; com: LoanSection; ins: InsSection; epc: EpcSection }) {
  const rows = [
    { name: "Residential", apps: res.totalCur, rate: res.approvalRateCur, done: res.disbursedCur, tat: res.avgTatCur, rateLabel: "Approval" },
    { name: "C&I", apps: com.totalCur, rate: com.approvalRateCur, done: com.disbursedCur, tat: com.avgTatCur, rateLabel: "Approval" },
    { name: "Insurance", apps: ins.totalCur, rate: ins.issuanceRateCur, done: ins.issuedCur, tat: null, rateLabel: "Issuance" },
    { name: "EPC", apps: epc.onboardedCur, rate: epc.approvalRateCur, done: null, tat: epc.reviewCur, rateLabel: "Approval" },
  ];
  const best = rows.reduce((a, b) => (b.apps > a.apps ? b : a), rows[0]);
  return (
    <Card className="p-5">
      <p className="text-[13px] font-semibold text-text mb-3">Cross-business comparison (current period)</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-[11px] uppercase tracking-wide text-text-muted border-b border-line">
            <tr>
              <th className="text-left py-2 pr-3 font-medium">Business</th>
              <th className="text-center py-2 px-3 font-medium">Applications</th>
              <th className="text-center py-2 px-3 font-medium">Approval / Issuance</th>
              <th className="text-center py-2 px-3 font-medium">Disbursed / Issued</th>
              <th className="text-center py-2 pl-3 font-medium">Avg TAT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-[#eef1f4] last:border-0">
                <td className="py-2.5 pr-3 font-semibold text-text">{r.name}</td>
                <td className="py-2.5 px-3 text-center">{fmtInt(r.apps)}</td>
                <td className="py-2.5 px-3 text-center">{r.rate == null ? "—" : fmtPct1(r.rate)}</td>
                <td className="py-2.5 px-3 text-center">{r.done == null ? "—" : fmtInt(r.done)}</td>
                <td className="py-2.5 pl-3 text-center">{r.tat == null ? "—" : fmtDays(r.tat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-text-muted mt-3">
        {rows.every((r) => r.apps === 0)
          ? "No applications in the current period across any business line yet."
          : `${best.name} leads on volume this period with ${best.apps} application${best.apps === 1 ? "" : "s"}.`}
      </p>
    </Card>
  );
}
