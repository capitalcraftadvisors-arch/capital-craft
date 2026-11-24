"use client";

// Partner dashboard · the Dashboard section (KPI band, portfolio, today's activity, RMs).

import { useMemo, useState } from "react";
import { NAVY_ACCENT } from "@/components/partner/PartnerShell";
import { Donut } from "@/components/partner/DashboardV2";
import { inrPlain } from "@/lib/money";
import { RMS, STAGE4_LABEL, STAGE4_PILL, borrower, fmtDateTimeOrBlank, lastChangeTs, stage4, statusChangedAt, type AppRow } from "./rows";

// ── Home ──────────────────────────────────────────────────────────────────────
type Period = "today" | "week" | "month" | "quarter" | "year" | "all";
const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" }, { key: "year", label: "This year" }, { key: "all", label: "All time" },
];
// Current window start + the immediately-preceding window (for the trend deltas).
function periodRange(p: Period): { from: number; prevFrom: number; prevTo: number; comparable: boolean } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const midnight = new Date(y, m, d).getTime();
  const DAY = 86400000;
  switch (p) {
    case "today":   return { from: midnight, prevFrom: midnight - DAY, prevTo: midnight, comparable: true };
    case "week":    { const ws = midnight - ((now.getDay() + 6) % 7) * DAY; return { from: ws, prevFrom: ws - 7 * DAY, prevTo: ws, comparable: true }; }
    case "month":   { const ms = new Date(y, m, 1).getTime(); return { from: ms, prevFrom: new Date(y, m - 1, 1).getTime(), prevTo: ms, comparable: true }; }
    case "quarter": { const qs = new Date(y, Math.floor(m / 3) * 3, 1).getTime(); return { from: qs, prevFrom: new Date(y, Math.floor(m / 3) * 3 - 3, 1).getTime(), prevTo: qs, comparable: true }; }
    case "year":    { const ys = new Date(y, 0, 1).getTime(); return { from: ys, prevFrom: new Date(y - 1, 0, 1).getTime(), prevTo: ys, comparable: true }; }
    default:        return { from: 0, prevFrom: 0, prevTo: 0, comparable: false };
  }
}

// (Donut — the shared ring chart — lives in components/partner/DashboardV2.)

function compactRupees(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2).replace(/\.?0+$/, "")}L`;
  return `₹${inrPlain(v)}`;
}

function homeMetrics(list: AppRow[]) {
  return {
    total: list.length,
    approved: list.filter((r) => stage4(r) === "approved").length,
    sanctioned: list.reduce((s, r) => s + (r.sanctioned_amount || 0), 0),
    disbursed: list.reduce((s, r) => s + (r.first_disbursement_amount || 0) + (r.second_disbursement_amount || 0), 0),
    tranchePending: list.filter((r) => stage4(r) === "approved" && r.first_disbursement_amount != null && r.second_disbursement_amount == null).length,
  };
}

export default function HomeSection({ loans, loading, attnCount, canLoan, canInsurance, onApplyLoan, onApplyInsurance, applyingInsurance, onOpenCase, onEmi, canQuote, onQuotation, onAttention }: {
  loans: AppRow[]; loading: boolean; attnCount: number;
  canLoan: boolean; canInsurance: boolean;
  onApplyLoan: () => void; onApplyInsurance: () => void; applyingInsurance: boolean;
  onOpenCase: (r: AppRow) => void; onEmi: () => void; canQuote: boolean; onQuotation: () => void; onAttention: () => void;
}) {
  const [period, setPeriod] = useState<Period>("all");
  const { from, prevFrom, prevTo, comparable } = periodRange(period);
  const scoped = useMemo(() => loans.filter((r) => new Date(r.created_at).getTime() >= from), [loans, from]);
  const prevScoped = useMemo(() => comparable ? loans.filter((r) => { const t = new Date(r.created_at).getTime(); return t >= prevFrom && t < prevTo; }) : [], [loans, comparable, prevFrom, prevTo]);
  const cur = useMemo(() => homeMetrics(scoped), [scoped]);
  const prev = useMemo(() => homeMetrics(prevScoped), [prevScoped]);

  const breakdown = useMemo(() => {
    let review = 0, approved = 0, rejected = 0;
    for (const r of scoped) { const s = stage4(r); if (s === "approved") approved++; else if (s === "rejected") rejected++; else review++; }
    return { review, approved, rejected };
  }, [scoped]);

  // "Today's activity" is always the last 24h — independent of the period filter.
  const todays = useMemo(() => {
    const since = Date.now() - 86400000;
    return [...loans].filter((r) => lastChangeTs(r) >= since).sort((a, b) => lastChangeTs(b) - lastChangeTs(a)).slice(0, 6);
  }, [loans]);

  const kpis: { label: string; value: string; tone: string; delta?: number; money?: boolean }[] = [
    { label: "Applications", value: String(cur.total), tone: "text-cc-ink", delta: cur.total - prev.total },
    { label: "Approved", value: String(cur.approved), tone: "text-cc-green", delta: cur.approved - prev.approved },
    { label: "Sanctioned", value: compactRupees(cur.sanctioned), tone: "text-cc-ink", delta: cur.sanctioned - prev.sanctioned, money: true },
    { label: "Disbursed", value: compactRupees(cur.disbursed), tone: "text-cc-ink", delta: cur.disbursed - prev.disbursed, money: true },
    { label: "2nd tranche pending", value: String(cur.tranchePending), tone: "text-warn-ink" },
  ];
  const segs = [
    { label: "In review", value: breakdown.review, color: "#f0b429" },
    { label: "Approved", value: breakdown.approved, color: "#178a5c" },
    { label: "Rejected", value: breakdown.rejected, color: "#dc2626" },
  ];
  const segTotal = Math.max(1, breakdown.review + breakdown.approved + breakdown.rejected);

  return (
    <div className="flex flex-col gap-5">
      {/* Action bar — start a new application (left) + period filter (right) */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {canLoan && (
            <button onClick={onApplyLoan}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-[13.5px] font-semibold shadow-sm hover:brightness-110 active:scale-[0.98] transition"
              style={{ background: NAVY_ACCENT }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              Apply for loan
            </button>
          )}
          {canInsurance && (
            <button onClick={onApplyInsurance} disabled={applyingInsurance}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-navy text-navy text-[13.5px] font-semibold hover:bg-navy/[0.06] active:scale-[0.98] transition disabled:opacity-60">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></svg>
              {applyingInsurance ? "Starting…" : "Apply for insurance"}
            </button>
          )}
        </div>
        <div className="relative shrink-0">
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}
            className="appearance-none bg-white border border-line rounded-xl pl-3.5 pr-9 py-2 text-[13px] font-semibold text-cc-ink cursor-pointer hover:border-navy focus:outline-none focus:border-navy">
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a8a76" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </div>
      </div>

      {/* KPI band — each card shows the value + its change vs the previous period */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-2xl border border-line px-4 py-3.5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150">
            <div className="text-[11.5px] text-text-muted">{k.label}</div>
            <div className={`text-[22px] font-bold mt-0.5 ${k.tone}`}>{loading ? "…" : k.value}</div>
            {comparable && k.delta !== undefined && (
              <div title="vs previous period" className={["mt-1 inline-flex items-center gap-1 text-[11px] font-semibold", k.delta > 0 ? "text-cc-green" : k.delta < 0 ? "text-red-600" : "text-text-muted"].join(" ")}>
                <span aria-hidden>{k.delta > 0 ? "▲" : k.delta < 0 ? "▼" : "–"}</span>
                {k.money ? compactRupees(Math.abs(k.delta)) : Math.abs(k.delta)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Left: portfolio donut + today's activity */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          <div className="bg-white rounded-2xl border border-line p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] font-semibold text-cc-ink">Portfolio breakdown</div>
              {attnCount > 0 && (
                <button onClick={onAttention} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-[#fde8e8] text-red-600 hover:bg-[#fbd5d5] transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600" />{attnCount} need attention
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              )}
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-8 mt-4">
              <Donut segments={segs} />
              <div className="flex-1 w-full flex flex-col gap-3">
                {segs.map((s) => (
                  <div key={s.label} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="text-[13px] text-text-mid flex-1">{s.label}</span>
                    <span className="text-[15px] font-bold text-cc-ink tabular-nums">{s.value}</span>
                    <span className="text-[11.5px] text-text-muted w-9 text-right tabular-nums">{Math.round((s.value / segTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-line p-5">
            <div className="text-[13px] font-semibold text-cc-ink mb-3">Today&rsquo;s activity</div>
            {loading ? <div className="text-[13px] text-text-muted">Loading…</div>
              : todays.length === 0 ? <div className="text-[13px] text-text-muted">No status changes in the last 24 hours.</div>
              : <div className="flex flex-col gap-2">
                  {todays.map((r) => {
                    const stg = stage4(r);
                    return (
                      <button key={r.id} onClick={() => onOpenCase(r)} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5 hover:bg-navy-mist text-left">
                        <div className="min-w-0"><div className="text-[13.5px] font-semibold text-text truncate">{borrower(r)}</div><div className="text-[11px] text-text-muted">{fmtDateTimeOrBlank(statusChangedAt(r) ?? r.created_at)}</div></div>
                        <span className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full ${STAGE4_PILL[stg]}`}>{STAGE4_LABEL[stg]}</span>
                      </button>
                    );
                  })}
                </div>}
          </div>
        </div>

        {/* Right: EMI tile · disbursement progress · relationship managers */}
        <div className="flex flex-col gap-5">
          <button onClick={onEmi} className="bg-white rounded-2xl border border-line p-5 text-left hover:border-navy transition-colors">
            <div className="text-[12px] text-text-muted">Quote a customer&rsquo;s EMI</div>
            <div className="text-[15px] font-semibold text-navy mt-1 flex items-center gap-1.5">Open EMI calculator
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </div>
            <div className="text-[11.5px] text-text-muted mt-1">EMI after the PM Surya Ghar subsidy, in seconds.</div>
          </button>

          {canQuote && (
            <button onClick={onQuotation} className="bg-white rounded-2xl border border-line p-5 text-left hover:border-navy transition-colors">
              <div className="text-[12px] text-text-muted">Make a customer quotation</div>
              <div className="text-[15px] font-semibold text-navy mt-1 flex items-center gap-1.5">Open quotation builder
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </div>
            </button>
          )}

          <div className="bg-white rounded-2xl border border-line p-5">
            <div className="text-[12px] text-text-muted mb-3">Your relationship managers</div>
            <div className="flex flex-col gap-3">
              {RMS.map((rm) => (
                <div key={rm.phone} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-[13px] shrink-0" style={{ background: NAVY_ACCENT }}>{rm.name.slice(0, 1)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-text truncate">{rm.name}</div>
                    <div className="text-[11px] text-text-muted">+{rm.phone}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
