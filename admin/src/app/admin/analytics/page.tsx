"use client";

// ============================================================================
// Management analytics dashboard — /admin/analytics
//
// Four sections (Residential | C&I | Insurance | EPC), a period switcher, and
// deterministic rule-based "intelligence" (NO LLM/AI calls anywhere — every
// insight is composed from computed numbers).
//
// Period model (approved): the current window runs from the period start to
// NOW (period-to-date); the previous window is the equivalent-length window
// immediately before, using the SAME elapsed duration, so comparisons are
// fair (e.g. month-to-date vs last-month-to-the-same-elapsed-point).
//
// Bucketing (approved):
//   - Applications / Sanctioned / Rejected → cohort by created_at.
//   - Disbursed count + Avg TAT           → activity by first_disbursement_date.
//
// Omitted — no data (deliberately NOT approximated):
//   - Insurance Avg TAT (created → policy issue): no policy-issue/upload
//     timestamp exists. Shows a clean empty state. FUTURE MIGRATION that would
//     enable it (do NOT write now): add insurance_applications.policy_uploaded_at
//     timestamptz, set when the admin uploads the policy document; then
//     TAT = policy_uploaded_at − created_at.
//   - Loans with NULL plant_use_type are in neither Res nor C&I — surfaced as a
//     small reconciling note so totals add up.
//   - regions / branches / teams / products / channels (no such data).
//
// Read-only: two extra SELECTs (loans, insurance) added alongside the existing
// EPC analytics queries. All existing EPC math is preserved.
// ============================================================================

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, Cell, PieChart, Pie, CartesianGrid, LabelList,
} from "recharts";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar, { ACCENTS } from "@/components/AdminSidebar";
import Card from "@/components/ui/Card";
import { supabase } from "@/lib/supabase";
import { lenderOutcome } from "@/lib/loan-status";

const PURPLE = ACCENTS.analytics.color; // #6d28d9

// Thresholds (deterministic intelligence).
const FLAG_PCT = 10;   // flag a change only when |Δ| ≥ 10%
const FLAG_TAT = 2;    // …or ≥ 2 days for TAT metrics
const STABLE_PCT = 5;  // arrow reads "stable" below this
const MIN_PREV = 5;    // suppress deltas/insight when previous window < 5 points
const MIN_CHART = 3;   // charts show the empty state below this many points

// Geography (sections A–D). Display-layer normalization only; teal accent.
const GEO = "#0d9488";        // Geography accent (distinct from the analytics purple)
const GEO_MIN_INSIGHT = 10;   // suppress geo insights when the period cohort < 10
const GEO_MIN_PLACE = 5;      // a place needs ≥5 rows before it's named in an insight

// ── data shapes ─────────────────────────────────────────────────────────────
type Loan = {
  id: string;
  created_at: string;
  status: string;
  plant_use_type: "residential" | "commercial" | null;
  first_disbursement_amount: number | null;
  first_disbursement_date: string | null;
  install_city: string | null;
  install_district: string | null;
  install_state: string | null;
  install_pincode: string | null;
};
type Insurance = { id: string; created_at: string; status: string; policy_path: string | null };
type Biz = {
  id: string; source: string | null; status: string; created_at: string;
  submitted_at: string | null; reviewed_at: string | null;
  step_timestamps: Record<string, string> | null;
};
type LenderRow = { business_id: string; lender: string; docs_given_at: string | null; approved_at: string | null };

// ── period windows ───────────────────────────────────────────────────────────
type Preset = "today" | "week" | "month" | "quarter" | "year" | "custom";
type Win = { start: number; end: number };
type Windows = { cur: Win; prev: Win; label: string; recent: boolean };

const PRESET_LABEL: Record<Preset, string> = {
  today: "Today", week: "This Week", month: "This Month",
  quarter: "This Quarter", year: "This Year", custom: "Custom range",
};

function computeWindows(preset: Preset, now: Date, cs?: string, ce?: string): Windows {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let curStart: Date;
  let curEnd = new Date(now);
  let prevStart: Date;

  if (preset === "custom") {
    curStart = cs ? new Date(cs + "T00:00:00") : startOfDay(now);
    curEnd = ce ? new Date(ce + "T23:59:59.999") : new Date(now);
    const len = curEnd.getTime() - curStart.getTime();
    prevStart = new Date(curStart.getTime() - len);
    const prevEnd = new Date(curStart.getTime());
    const recent = curEnd.getTime() >= startOfDay(now).getTime();
    return {
      cur: { start: curStart.getTime(), end: curEnd.getTime() },
      prev: { start: prevStart.getTime(), end: prevEnd.getTime() },
      label: "Custom range", recent,
    };
  }

  if (preset === "today") curStart = startOfDay(now);
  else if (preset === "week") {
    const d = startOfDay(now);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    curStart = new Date(d); curStart.setDate(d.getDate() - dow);
  } else if (preset === "month") curStart = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (preset === "quarter") curStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  else curStart = new Date(now.getFullYear(), 0, 1); // year

  // Previous period start = same period one unit back.
  if (preset === "today") { prevStart = new Date(curStart); prevStart.setDate(curStart.getDate() - 1); }
  else if (preset === "week") { prevStart = new Date(curStart); prevStart.setDate(curStart.getDate() - 7); }
  else if (preset === "month") prevStart = new Date(curStart.getFullYear(), curStart.getMonth() - 1, 1);
  else if (preset === "quarter") prevStart = new Date(curStart.getFullYear(), curStart.getMonth() - 3, 1);
  else prevStart = new Date(curStart.getFullYear() - 1, 0, 1);

  const elapsed = curEnd.getTime() - curStart.getTime();
  const prevEnd = prevStart.getTime() + elapsed; // same elapsed duration → fair comparison
  return {
    cur: { start: curStart.getTime(), end: curEnd.getTime() },
    prev: { start: prevStart.getTime(), end: prevEnd },
    label: PRESET_LABEL[preset], recent: true, // presets are always period-to-date
  };
}

// ── numeric helpers ──────────────────────────────────────────────────────────
const t = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);
const inWin = (ms: number, w: Win) => Number.isFinite(ms) && ms >= w.start && ms < w.end;
const days = (a: number, b: number) => (a - b) / 86_400_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function pct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
const fmtInt = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-IN"));
const fmtPct1 = (n: number | null) => (n == null ? "—" : `${n.toFixed(0)}%`);
const fmtDays = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)} d`);

type Metric = { cur: number | null; prev: number | null; nCur: number; nPrev: number };
type Dir = "up" | "down"; // "up" = higher is better; "down" = lower is better
type Kpi = { label: string; m: Metric; fmt: (n: number | null) => string; dir: Dir; caption?: string };

// ── section computation: LOANS (Residential / C&I) ───────────────────────────
type LoanSection = {
  kpis: Kpi[];
  funnel: { applied: number; sanctioned: number; disbursed: number };
  donut: { sanctioned: number; rejected: number; pending: number };
  trend: { label: string; cur: number; prev: number }[];
  tatTrend: { label: string; tat: number | null }[];
  disbBar: { name: string; value: number }[];
  pendingOverdue: number;       // review-bucket loans created > 7 days ago
  convDrop: { stage: string; drop: number } | null;
  totalCur: number; totalPrev: number;
  sanctionedCur: number; approvalRateCur: number | null;
  avgTatCur: number | null; disbursedCur: number;
};

function computeLoanSection(all: Loan[], w: Windows): LoanSection {
  const isSan = (r: Loan) => lenderOutcome(r.status) === "approved";
  const isRej = (r: Loan) => lenderOutcome(r.status) === "rejected";
  const isDisb = (r: Loan) =>
    r.status === "approved" && r.first_disbursement_amount != null && !!r.first_disbursement_date;

  const cohort = (win: Win) => all.filter((r) => inWin(t(r.created_at), win));
  const disbInWin = (win: Win) => all.filter((r) => isDisb(r) && inWin(t(r.first_disbursement_date), win));

  const curC = cohort(w.cur), prevC = cohort(w.prev);
  const curD = disbInWin(w.cur), prevD = disbInWin(w.prev);

  const san = (a: Loan[]) => a.filter(isSan).length;
  const rej = (a: Loan[]) => a.filter(isRej).length;
  const rate = (a: Loan[]) => (a.length ? (san(a) / a.length) * 100 : null);
  const tat = (a: Loan[]) => mean(a.map((r) => days(t(r.first_disbursement_date), t(r.created_at))));

  const M = (cur: number | null, prev: number | null, nCur: number, nPrev: number): Metric => ({ cur, prev, nCur, nPrev });

  const kpis: Kpi[] = [
    { label: "Total Applications", m: M(curC.length, prevC.length, curC.length, prevC.length), fmt: fmtInt, dir: "up" },
    { label: "Total Sanctioned",   m: M(san(curC), san(prevC), curC.length, prevC.length), fmt: fmtInt, dir: "up" },
    { label: "Total Rejected",     m: M(rej(curC), rej(prevC), curC.length, prevC.length), fmt: fmtInt, dir: "down" },
    { label: "Total Disbursed",    m: M(curD.length, prevD.length, curD.length, prevD.length), fmt: fmtInt, dir: "up" },
    {
      label: "Approval Rate", m: M(rate(curC), rate(prevC), curC.length, prevC.length), fmt: fmtPct1, dir: "up",
      caption: w.recent ? "Pending applications may still convert." : undefined,
    },
    { label: "Avg TAT (create → disburse)", m: M(tat(curD), tat(prevD), curD.length, prevD.length), fmt: fmtDays, dir: "down" },
  ];

  // Trend line — 8 equal bins across each window, aligned by bin index.
  const N = 8;
  const binCounts = (items: number[], win: Win) => {
    const span = win.end - win.start || 1;
    const out = new Array(N).fill(0);
    for (const ms of items) {
      if (ms < win.start || ms >= win.end) continue;
      out[Math.min(N - 1, Math.floor(((ms - win.start) / span) * N))]++;
    }
    return out;
  };
  const curCreated = all.map((r) => t(r.created_at));
  const cCur = binCounts(curCreated, w.cur), cPrev = binCounts(curCreated, w.prev);
  const trend = Array.from({ length: N }, (_, i) => ({ label: `${i + 1}`, cur: cCur[i], prev: cPrev[i] }));

  // TAT trend — avg TAT of loans disbursed in each current-window bin.
  const tatTrend = Array.from({ length: N }, (_, i) => {
    const span = w.cur.end - w.cur.start || 1;
    const s = w.cur.start + (i * span) / N, e = w.cur.start + ((i + 1) * span) / N;
    const xs = curD.filter((r) => { const ms = t(r.first_disbursement_date); return ms >= s && ms < e; })
      .map((r) => days(t(r.first_disbursement_date), t(r.created_at)));
    return { label: `${i + 1}`, tat: mean(xs) };
  });

  // Bottleneck: biggest drop in stage conversion vs previous period.
  const cr = (n: number, d: number) => (d ? n / d : null);
  const convDrop = (() => {
    if (prevC.length < MIN_PREV) return null;
    const stages: { stage: string; cur: number | null; prev: number | null }[] = [
      { stage: "Applied → Sanctioned", cur: cr(san(curC), curC.length), prev: cr(san(prevC), prevC.length) },
      { stage: "Sanctioned → Disbursed", cur: cr(curD.length, san(curC)), prev: cr(prevD.length, san(prevC)) },
    ];
    let worst: { stage: string; drop: number } | null = null;
    for (const s of stages) {
      if (s.cur == null || s.prev == null) continue;
      const drop = (s.prev - s.cur) * 100;
      if (drop >= FLAG_PCT && (!worst || drop > worst.drop)) worst = { stage: s.stage, drop };
    }
    return worst;
  })();

  const now = Date.now();
  const pendingOverdue = all.filter(
    (r) => lenderOutcome(r.status) === "review" && days(now, t(r.created_at)) > 7,
  ).length;

  return {
    kpis,
    funnel: { applied: curC.length, sanctioned: san(curC), disbursed: curD.length },
    donut: { sanctioned: san(curC), rejected: rej(curC), pending: curC.length - san(curC) - rej(curC) },
    trend, tatTrend,
    disbBar: [{ name: "Previous", value: prevD.length }, { name: "Current", value: curD.length }],
    pendingOverdue, convDrop,
    totalCur: curC.length, totalPrev: prevC.length,
    sanctionedCur: san(curC), approvalRateCur: rate(curC),
    avgTatCur: tat(curD), disbursedCur: curD.length,
  };
}

// ── geography (loans): normalization + grouping + deterministic insights ──────
// Display-layer only — NOTHING is written back to the DB.
type GeoMetric = "apps" | "sanctioned" | "disbursed";
type GeoFieldKey = "install_city" | "install_district" | "install_state";
type GeoBar = { label: string; value: number; share: number; valueLabel: string };
const GEO_UNKNOWN = " unknown";

// Trim + collapse whitespace + case-fold for grouping; Title Case for display.
// Null/blank → null (grouped as "Unknown" by callers, excluded from insights).
function normPlace(raw: string | null | undefined): { key: string; label: string } | null {
  if (raw == null) return null;
  const cleaned = String(raw).trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  return { key: lower, label: lower.replace(/\b\w/g, (c) => c.toUpperCase()) };
}

function groupPlaces(arr: Loan[], f: GeoFieldKey): Map<string, { label: string; count: number }> {
  const m = new Map<string, { label: string; count: number }>();
  for (const r of arr) {
    const np = normPlace(r[f]);
    const key = np ? np.key : GEO_UNKNOWN;
    const label = np ? np.label : "Unknown";
    const e = m.get(key);
    if (e) e.count++; else m.set(key, { label, count: 1 });
  }
  return m;
}

// Top-N (incl. Unknown) + an "Others" roll-up; each bar carries its % share.
function topBars(m: Map<string, { label: string; count: number }>, n = 5): GeoBar[] {
  const entries = [...m.values()];
  const total = entries.reduce((s, x) => s + x.count, 0) || 1;
  const sorted = [...entries].sort((a, b) => b.count - a.count);
  const mk = (label: string, count: number): GeoBar =>
    ({ label, value: count, share: (count / total) * 100, valueLabel: `${count} · ${Math.round((count / total) * 100)}%` });
  const out = sorted.slice(0, n).map((x) => mk(x.label, x.count));
  const restSum = sorted.slice(n).reduce((s, x) => s + x.count, 0);
  if (restSum > 0) out.push(mk("Others", restSum));
  return out;
}

function leaderPlace(m: Map<string, { label: string; count: number }>): { key: string; label: string; count: number } | null {
  let best: { key: string; label: string; count: number } | null = null;
  for (const [key, v] of m) {
    if (key === GEO_UNKNOWN) continue; // never name "Unknown" in an insight
    if (!best || v.count > best.count) best = { key, label: v.label, count: v.count };
  }
  return best;
}
function shareIn(m: Map<string, { label: string; count: number }>, key: string): number | null {
  const total = [...m.values()].reduce((s, x) => s + x.count, 0);
  if (!total) return null;
  const e = m.get(key);
  return e ? (e.count / total) * 100 : 0;
}

// Insights composed purely from computed shares/deltas. A place is named only
// if it clears GEO_MIN_PLACE; the "Unknown" bucket is skipped throughout.
function geoInsights(cur: Loan[], prev: Loan[], noun: string): string[] {
  const out: string[] = [];
  const cityCur = groupPlaces(cur, "install_city");
  const cityPrev = groupPlaces(prev, "install_city");
  const leader = leaderPlace(cityCur);
  if (leader && leader.count >= GEO_MIN_PLACE) {
    const curShare = shareIn(cityCur, leader.key) ?? 0;
    const prevShare = prev.length >= MIN_PREV ? shareIn(cityPrev, leader.key) : null;
    let line = `${leader.label} leads with ${Math.round(curShare)}% of ${noun}`;
    if (prevShare != null && Math.abs(curShare - prevShare) >= STABLE_PCT) {
      line += ` (${curShare >= prevShare ? "up" : "down"} from ${Math.round(prevShare)}% last period)`;
    }
    out.push(line + ".");
    if (curShare > 50) out.push(`Volume is concentrated in one market — ${leader.label} alone accounts for ${Math.round(curShare)}%.`);
  }
  if (prev.length >= MIN_PREV) {
    const dCur = groupPlaces(cur, "install_district");
    const dPrev = groupPlaces(prev, "install_district");
    let n = 0;
    for (const [key] of dCur) { if (key === GEO_UNKNOWN) continue; if (!dPrev.has(key)) n++; }
    if (n >= 2) out.push(`${n} new districts appeared this period.`);
  }
  return out;
}

// At most ONE geography line for a loan section's What-Changed — only on a
// meaningful shift (a period delta, a concentration flag, or new districts).
function geoWhatChangedLine(loans: Loan[], w: Windows): string | null {
  const cur = loans.filter((r) => inWin(t(r.created_at), w.cur));
  if (cur.length < GEO_MIN_INSIGHT) return null;
  const prev = loans.filter((r) => inWin(t(r.created_at), w.prev));
  const lines = geoInsights(cur, prev, "applications");
  return lines.find((l) => l.includes("last period") || l.includes("concentrated") || l.includes("new districts")) ?? null;
}

// ── section computation: INSURANCE ───────────────────────────────────────────
type InsSection = {
  kpis: Kpi[];
  funnel: { applied: number; issued: number };
  donut: { issued: number; rejected: number; pending: number };
  trend: { label: string; cur: number; prev: number }[];
  totalCur: number; totalPrev: number; issuedCur: number; issuanceRateCur: number | null;
  underIssuanceCur: number;
};
function computeInsSection(all: Insurance[], w: Windows): InsSection {
  const isIssued = (r: Insurance) => r.policy_path != null;
  // Broader "under issuance": any non-draft, non-rejected app without a policy doc.
  const isUnder = (r: Insurance) => !r.policy_path && r.status !== "draft" && r.status !== "rejected";
  const isRej = (r: Insurance) => r.status === "rejected";

  const cohort = (win: Win) => all.filter((r) => inWin(t(r.created_at), win));
  const curC = cohort(w.cur), prevC = cohort(w.prev);
  const cnt = (a: Insurance[], f: (r: Insurance) => boolean) => a.filter(f).length;
  const rate = (a: Insurance[]) => (a.length ? (cnt(a, isIssued) / a.length) * 100 : null);
  const M = (cur: number | null, prev: number | null, nCur: number, nPrev: number): Metric => ({ cur, prev, nCur, nPrev });

  const kpis: Kpi[] = [
    { label: "Total Applications", m: M(curC.length, prevC.length, curC.length, prevC.length), fmt: fmtInt, dir: "up" },
    { label: "Policy Under Issuance", m: M(cnt(curC, isUnder), cnt(prevC, isUnder), curC.length, prevC.length), fmt: fmtInt, dir: "down" },
    { label: "Policy Issued", m: M(cnt(curC, isIssued), cnt(prevC, isIssued), curC.length, prevC.length), fmt: fmtInt, dir: "up" },
    // Avg TAT is OMITTED — no policy-issue timestamp. Rendered as an empty state below.
  ];

  const N = 8;
  const binCounts = (win: Win) => {
    const span = win.end - win.start || 1;
    const out = new Array(N).fill(0);
    for (const r of all) {
      const ms = t(r.created_at);
      if (ms < win.start || ms >= win.end) continue;
      out[Math.min(N - 1, Math.floor(((ms - win.start) / span) * N))]++;
    }
    return out;
  };
  const cCur = binCounts(w.cur), cPrev = binCounts(w.prev);
  const trend = Array.from({ length: N }, (_, i) => ({ label: `${i + 1}`, cur: cCur[i], prev: cPrev[i] }));

  return {
    kpis,
    funnel: { applied: curC.length, issued: cnt(curC, isIssued) },
    donut: { issued: cnt(curC, isIssued), rejected: cnt(curC, isRej), pending: cnt(curC, isUnder) },
    trend,
    totalCur: curC.length, totalPrev: prevC.length,
    issuedCur: cnt(curC, isIssued), issuanceRateCur: rate(curC), underIssuanceCur: cnt(curC, isUnder),
  };
}

// ── section computation: EPC (existing math, period-filtered by submitted_at) ─
type EpcSection = {
  kpis: Kpi[];
  fillHist: { label: string; count: number }[];
  oneGo: { name: string; value: number }[];
  onboardedCur: number; onboardedPrev: number;
  approvalRateCur: number | null; reviewCur: number | null;
};
const ONE_GO_MAX_GAP_MIN = 30;
function computeEpcSection(biz: Biz[], lenders: LenderRow[], w: Windows): EpcSection {
  // Cohort by submitted_at in the window (EPC metrics key off submission).
  const inCohort = (r: Biz, win: Win) => inWin(t(r.submitted_at), win);
  const cur = biz.filter((r) => inCohort(r, w.cur));
  const prev = biz.filter((r) => inCohort(r, w.prev));

  // Avg fill time (self-onboarded EPCs): created_at → submitted_at.
  const fill = (a: Biz[]) => mean(a.filter((r) => (r.source ?? "epc") === "epc" && r.submitted_at)
    .map((r) => days(t(r.submitted_at), t(r.created_at))) );
  // % one-go: no gap > 30 min between step timestamps + submitted_at.
  const oneGoPct = (a: Biz[]) => {
    const flags: boolean[] = [];
    for (const r of a) {
      const ts = r.step_timestamps ?? {}; const times: number[] = []; let missing = false;
      for (let i = 1; i <= 6; i++) { const v = ts[`step_${i}_completed_at`]; if (!v) { missing = true; break; } times.push(new Date(v).getTime()); }
      if (missing || !r.submitted_at) continue;
      times.push(t(r.submitted_at));
      let maxGap = 0; for (let i = 1; i < times.length; i++) maxGap = Math.max(maxGap, (times[i] - times[i - 1]) / 60000);
      flags.push(maxGap < ONE_GO_MAX_GAP_MIN);
    }
    return flags.length ? (flags.filter(Boolean).length / flags.length) * 100 : null;
  };
  // Avg review time: submitted_at → reviewed_at.
  const review = (a: Biz[]) => mean(a.filter((r) => r.submitted_at && r.reviewed_at)
    .map((r) => days(t(r.reviewed_at), t(r.submitted_at))) );
  // Approval rate: approved / cohort.
  const approvalRate = (a: Biz[]) => (a.length ? (a.filter((r) => r.status === "approved").length / a.length) * 100 : null);
  // Avg docs→lender + lender approval, over lender rows whose EPC submitted in-window.
  const subById = new Map(biz.map((r) => [r.id, r.submitted_at]));
  const inWindowLenders = (win: Win) => lenders.filter((l) => { const s = subById.get(l.business_id); return s ? inWin(t(s), win) : false; });
  const docsTat = (win: Win) => mean(inWindowLenders(win).filter((l) => l.docs_given_at)
    .map((l) => days(t(l.docs_given_at), t(subById.get(l.business_id) as string))) );
  const apprTat = (win: Win) => mean(inWindowLenders(win).filter((l) => l.docs_given_at && l.approved_at)
    .map((l) => days(t(l.approved_at), t(l.docs_given_at))) );

  const nDocsCur = inWindowLenders(w.cur).filter((l) => l.docs_given_at).length;
  const nDocsPrev = inWindowLenders(w.prev).filter((l) => l.docs_given_at).length;
  const nApprCur = inWindowLenders(w.cur).filter((l) => l.docs_given_at && l.approved_at).length;
  const nApprPrev = inWindowLenders(w.prev).filter((l) => l.docs_given_at && l.approved_at).length;
  const M = (cur: number | null, prev: number | null, nCur: number, nPrev: number): Metric => ({ cur, prev, nCur, nPrev });

  const kpis: Kpi[] = [
    { label: "EPCs Onboarded", m: M(cur.length, prev.length, cur.length, prev.length), fmt: fmtInt, dir: "up" },
    { label: "Avg Fill Time", m: M(fill(cur), fill(prev), cur.length, prev.length), fmt: fmtDays, dir: "down" },
    { label: "% Filled in One Go", m: M(oneGoPct(cur), oneGoPct(prev), cur.length, prev.length), fmt: fmtPct1, dir: "up" },
    { label: "Avg Review Time", m: M(review(cur), review(prev), cur.length, prev.length), fmt: fmtDays, dir: "down" },
    { label: "Avg Docs → Lender", m: M(docsTat(w.cur), docsTat(w.prev), nDocsCur, nDocsPrev), fmt: fmtDays, dir: "down" },
    { label: "Avg Lender Approval", m: M(apprTat(w.cur), apprTat(w.prev), nApprCur, nApprPrev), fmt: fmtDays, dir: "down" },
  ];

  // Keep the existing fill-time histogram + one-go donut, over the current cohort.
  const FILL_BUCKETS = [
    { label: "<15m", cap: 15 * 60 }, { label: "15–60m", cap: 3600 }, { label: "1–4h", cap: 4 * 3600 },
    { label: "4–24h", cap: 86400 }, { label: "1–7d", cap: 7 * 86400 }, { label: ">7d", cap: Infinity },
  ];
  const fillSecs = cur.filter((r) => (r.source ?? "epc") === "epc" && r.submitted_at)
    .map((r) => (t(r.submitted_at) - t(r.created_at)) / 1000).filter((s) => s >= 0);
  const fillHist = FILL_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const s of fillSecs) { const idx = FILL_BUCKETS.findIndex((b) => s < b.cap); if (idx >= 0) fillHist[idx].count++; }

  const og = oneGoPct(cur);
  const oneGo = og == null ? [] : [
    { name: "One go", value: Math.round(og) },
    { name: "Multi-session", value: 100 - Math.round(og) },
  ];

  return { kpis, fillHist, oneGo, onboardedCur: cur.length, onboardedPrev: prev.length, approvalRateCur: approvalRate(cur), reviewCur: review(cur) };
}

// ── deterministic intelligence (shared) ──────────────────────────────────────
type Delta = { label: string; changePct: number | null; dir: Dir; m: Metric; fmt: (n: number | null) => string };
function toDeltas(kpis: Kpi[]): Delta[] {
  return kpis.map((k) => ({ label: k.label, changePct: pct(k.m.cur, k.m.prev), dir: k.dir, m: k.m, fmt: k.fmt }));
}
const improving = (d: Delta) => d.changePct != null && (d.dir === "up" ? d.changePct > 0 : d.changePct < 0);
const flagged = (d: Delta) => {
  if (d.changePct == null || d.m.nPrev < MIN_PREV) return false;
  const tatLike = d.fmt === fmtDays;
  if (tatLike && d.m.cur != null && d.m.prev != null) return Math.abs(d.m.cur - d.m.prev) >= FLAG_TAT || Math.abs(d.changePct) >= FLAG_PCT;
  return Math.abs(d.changePct) >= FLAG_PCT;
};

type WhatChanged = { positives: string[]; concerns: string[]; attention: string[] };
function buildWhatChanged(deltas: Delta[], pendingOverdue?: number): WhatChanged {
  const positives: string[] = [], concerns: string[] = [], attention: string[] = [];
  for (const d of deltas) {
    if (!flagged(d)) continue;
    const mag = Math.abs(d.changePct as number).toFixed(0);
    const line = `${d.label} ${improving(d) ? "improved" : "declined"} ${mag}% (${d.fmt(d.m.prev)} → ${d.fmt(d.m.cur)})`;
    (improving(d) ? positives : concerns).push(line);
  }
  if (pendingOverdue && pendingOverdue > 0) attention.push(`${pendingOverdue} application${pendingOverdue === 1 ? "" : "s"} pending beyond 7 days`);
  return { positives, concerns, attention };
}

function buildSummary(title: string, deltas: Delta[], w: Windows): string {
  const enough = deltas.some((d) => d.m.nPrev >= MIN_PREV);
  if (!enough) return `Not enough history in the previous ${w.label.toLowerCase()} to compare — numbers will populate as applications flow.`;
  const parts: string[] = [];
  const apps = deltas.find((d) => d.label.startsWith("Total Applications") || d.label === "EPCs Onboarded");
  if (apps && apps.changePct != null) parts.push(`${title} applications ${apps.changePct >= 0 ? "up" : "down"} ${Math.abs(apps.changePct).toFixed(0)}% vs the previous ${w.label.toLowerCase()}`);
  const rate = deltas.find((d) => d.label.includes("Rate") || d.label.includes("One Go"));
  if (rate && rate.m.cur != null) parts.push(rate.changePct != null && Math.abs(rate.changePct) < STABLE_PCT ? `${rate.label.toLowerCase()} steady at ${rate.fmt(rate.m.cur)}` : `${rate.label.toLowerCase()} at ${rate.fmt(rate.m.cur)}`);
  const tat = deltas.find((d) => d.fmt === fmtDays && d.m.cur != null && d.m.prev != null && Math.abs((d.m.cur as number) - (d.m.prev as number)) >= FLAG_TAT);
  if (tat) parts.push(`${tat.label.toLowerCase()} ${(tat.m.cur as number) > (tat.m.prev as number) ? "increased" : "decreased"} ${Math.abs((tat.m.cur as number) - (tat.m.prev as number)).toFixed(1)} days`);
  return parts.length ? parts.join("; ") + "." : `${title} metrics are broadly stable vs the previous ${w.label.toLowerCase()}.`;
}

type Alert = { sev: "high" | "medium" | "positive" | "monitor"; text: string };
function buildAlerts(deltas: Delta[], extra: Alert[] = []): Alert[] {
  const out: Alert[] = [];
  for (const d of deltas) {
    if (!flagged(d)) continue;
    const mag = Math.abs(d.changePct as number).toFixed(0);
    if (improving(d)) out.push({ sev: "positive", text: `${d.label} improved ${mag}% (${d.fmt(d.m.cur)}).` });
    else out.push({ sev: Math.abs(d.changePct as number) >= 25 ? "high" : "medium", text: `${d.label} declined ${mag}% (${d.fmt(d.m.prev)} → ${d.fmt(d.m.cur)}).` });
  }
  return [...extra, ...out].slice(0, 5);
}

// ── good/bad arrow ────────────────────────────────────────────────────────────
function arrowFor(d: Delta): { glyph: string; cls: string; text: string } {
  if (d.changePct == null || d.m.nPrev < MIN_PREV) return { glyph: "→", cls: "text-text-muted", text: "no prior data" };
  if (Math.abs(d.changePct) < STABLE_PCT) return { glyph: "→", cls: "text-text-muted", text: `${Math.abs(d.changePct).toFixed(0)}% · stable` };
  return improving(d)
    ? { glyph: "↑", cls: "text-[#178a5c]", text: `${Math.abs(d.changePct).toFixed(0)}% · improving` }
    : { glyph: "↓", cls: "text-[#b42318]", text: `${Math.abs(d.changePct).toFixed(0)}% · declining` };
}

// ── health score (transparent weighted formula, documented) ───────────────────
type Health = { score: number; subs: { label: string; score: number }[] } | null;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
// Loans: 35% approval rate · 25% speed (TAT, 20d→0) · 20% momentum (apps Δ) ·
//        20% flow (disbursed/sanctioned). Insurance: 55% issuance rate · 25%
//        momentum · 20% backlog-clear. Each sub-score is 0–100; final = weighted mean.
function loanHealth(s: LoanSection): Health {
  if (s.totalCur < MIN_CHART) return null;
  const approval = s.approvalRateCur ?? 0;
  const speed = clamp(100 - (s.avgTatCur ?? 20) * 5);
  const momentum = clamp(50 + (pct(s.totalCur, s.totalPrev) ?? 0));
  const flow = s.sanctionedCur ? clamp((s.disbursedCur / s.sanctionedCur) * 100) : 50;
  const subs = [
    { label: "Approval rate", score: Math.round(approval) },
    { label: "Speed (TAT)", score: Math.round(speed) },
    { label: "Momentum", score: Math.round(momentum) },
    { label: "Flow to disbursal", score: Math.round(flow) },
  ];
  return { score: Math.round(approval * 0.35 + speed * 0.25 + momentum * 0.2 + flow * 0.2), subs };
}
function insHealth(s: InsSection): Health {
  if (s.totalCur < MIN_CHART) return null;
  const issuance = s.issuanceRateCur ?? 0;
  const momentum = clamp(50 + (pct(s.totalCur, s.totalPrev) ?? 0));
  const backlog = s.totalCur ? clamp(100 - (s.underIssuanceCur / s.totalCur) * 100) : 100;
  const subs = [
    { label: "Issuance rate", score: Math.round(issuance) },
    { label: "Momentum", score: Math.round(momentum) },
    { label: "Backlog clear", score: Math.round(backlog) },
  ];
  return { score: Math.round(issuance * 0.55 + momentum * 0.25 + backlog * 0.2), subs };
}
function epcHealth(s: EpcSection): Health {
  if (s.onboardedCur < MIN_CHART) return null;
  const approval = s.approvalRateCur ?? 0;
  const speed = clamp(100 - (s.reviewCur ?? 10) * 10);
  const momentum = clamp(50 + (pct(s.onboardedCur, s.onboardedPrev) ?? 0));
  const subs = [
    { label: "Approval rate", score: Math.round(approval) },
    { label: "Review speed", score: Math.round(speed) },
    { label: "Momentum", score: Math.round(momentum) },
  ];
  return { score: Math.round(approval * 0.4 + speed * 0.35 + momentum * 0.25), subs };
}

// ============================================================================
// PAGE
// ============================================================================
export default function AnalyticsPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type SectionKey = "res" | "com" | "ins" | "epc" | "geo";
const SECTION_TABS: { key: SectionKey; label: string }[] = [
  { key: "res", label: "Residential" }, { key: "com", label: "C&I" },
  { key: "ins", label: "Insurance" }, { key: "epc", label: "EPC" },
  { key: "geo", label: "Geography" },
];

function Inner() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [ins, setIns] = useState<Insurance[]>([]);
  const [biz, setBiz] = useState<Biz[]>([]);
  const [lenders, setLenders] = useState<LenderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [section, setSection] = useState<SectionKey>("res");
  const [preset, setPreset] = useState<Preset>("month");
  const [cs, setCs] = useState("");
  const [ce, setCe] = useState("");

  useEffect(() => {
    void (async () => {
      const [{ data: l }, { data: i }, { data: b }, { data: ls }] = await Promise.all([
        supabase().from("epc_applications")
          .select("id, created_at, status, plant_use_type, first_disbursement_amount, first_disbursement_date, install_city, install_district, install_state, install_pincode"),
        supabase().from("insurance_applications").select("id, created_at, status, policy_path"),
        supabase().from("epc_business")
          .select("id, source, status, created_at, submitted_at, reviewed_at, step_timestamps")
          .neq("business_type", "admin"),
        supabase().from("epc_lender_status").select("business_id, lender, docs_given_at, approved_at"),
      ]);
      setLoans((l ?? []) as Loan[]);
      setIns((i ?? []) as Insurance[]);
      setBiz((b ?? []) as Biz[]);
      setLenders((ls ?? []) as LenderRow[]);
      setLoading(false);
    })();
  }, []);

  // Recompute everything for the selected period. new Date() runs client-side.
  const w = useMemo(() => computeWindows(preset, new Date(), cs, ce), [preset, cs, ce]);

  const resLoans = useMemo(() => loans.filter((r) => r.plant_use_type === "residential"), [loans]);
  const comLoans = useMemo(() => loans.filter((r) => r.plant_use_type === "commercial"), [loans]);
  const uncategorized = useMemo(() => loans.filter((r) => r.plant_use_type == null).length, [loans]);

  const res = useMemo(() => computeLoanSection(resLoans, w), [resLoans, w]);
  const com = useMemo(() => computeLoanSection(comLoans, w), [comLoans, w]);
  const insM = useMemo(() => computeInsSection(ins, w), [ins, w]);
  const epc = useMemo(() => computeEpcSection(biz, lenders, w), [biz, lenders, w]);

  return (
    <div className="min-h-screen bg-bg-soft md:flex">
      <AdminSidebar active="analytics" />
      <div className="flex-1 min-w-0">
        {/* Sticky top bar: title + section switcher + period filter */}
        <div className="sticky top-0 z-20 bg-bg-soft/90 backdrop-blur border-b border-line">
          <div className="w-full px-4 sm:px-6 py-4">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="inline-block w-1.5 h-7 rounded-full" style={{ backgroundColor: PURPLE }} />
              <h1 className="font-display text-[24px] sm:text-[28px] font-bold">Analytics</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-input border border-line bg-white p-1">
                {SECTION_TABS.map((s) => {
                  const on = section === s.key;
                  return (
                    <button key={s.key} type="button" onClick={() => setSection(s.key)}
                      className="px-3.5 py-1.5 rounded-[8px] text-[13px] font-semibold transition-colors"
                      style={on ? { backgroundColor: PURPLE + "1a", color: PURPLE } : { color: "var(--muted)" }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}
                  className="rounded-input border border-line bg-white px-3 py-2 text-[13px] font-medium outline-none focus:border-blue">
                  {(["today", "week", "month", "quarter", "year", "custom"] as Preset[]).map((p) => (
                    <option key={p} value={p}>{PRESET_LABEL[p]}</option>
                  ))}
                </select>
                {preset === "custom" && (
                  <>
                    <input type="date" value={cs} onChange={(e) => setCs(e.target.value)} aria-label="From"
                      className="rounded-input border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-blue" />
                    <input type="date" value={ce} onChange={(e) => setCe(e.target.value)} aria-label="To"
                      className="rounded-input border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-blue" />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <section className="w-full px-4 sm:px-6 py-6">
          {loading ? (
            <p className="text-[13px] text-text-muted">Loading…</p>
          ) : (
            <div className="space-y-6">
              {section === "res" && <LoanSectionView title="Residential" s={res} w={w} note={null} loans={resLoans} />}
              {section === "com" && <LoanSectionView title="C&I" s={com} w={w} note={uncategorized ? `${uncategorized} loan${uncategorized === 1 ? "" : "s"} have no Residential/C&I category and are excluded from both sections.` : null} loans={comLoans} />}
              {section === "ins" && <InsSectionView s={insM} w={w} />}
              {section === "epc" && <EpcSectionView s={epc} w={w} />}
              {section === "geo" && <GeographySectionView resLoans={resLoans} comLoans={comLoans} allLoans={loans} w={w} />}

              {/* Cross-business comparison — identical across sections (not on Geography) */}
              {section !== "geo" && <CrossTable res={res} com={com} ins={insM} epc={epc} />}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── shared presentational pieces ─────────────────────────────────────────────
function SummaryBar({ text }: { text: string }) {
  return (
    <Card className="p-5" >
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 mt-0.5" style={{ backgroundColor: PURPLE + "1a", color: PURPLE }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v4M12 16h.01" /></svg>
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">Summary</p>
          <p className="text-[15px] leading-relaxed text-text">{text}</p>
        </div>
      </div>
    </Card>
  );
}

function KpiCard({ k }: { k: Kpi }) {
  const d = toDeltas([k])[0];
  const a = arrowFor(d);
  return (
    <Card className="p-4">
      <p className="text-[12px] text-text-muted">{k.label}</p>
      <p className="text-[26px] font-display font-bold leading-none mt-1.5 text-text">{k.fmt(k.m.cur)}</p>
      <div className="flex items-center gap-2 mt-2">
        <span className={`text-[13px] font-semibold ${a.cls}`}>{a.glyph} {a.text}</span>
      </div>
      <p className="text-[11px] text-text-muted mt-0.5">vs {k.fmt(k.m.prev)} prev</p>
      {k.caption && <p className="text-[10.5px] text-text-muted mt-1.5 italic">{k.caption}</p>}
    </Card>
  );
}

function EmptyState({ msg }: { msg?: string }) {
  return (
    <div className="border border-dashed border-line rounded-xl p-8 flex flex-col items-center text-center bg-bg-tint/40">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={PURPLE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 14l3-3 4 4 6-6" /></svg>
      <p className="mt-2.5 text-[13px] font-semibold text-text">Not enough data yet</p>
      <p className="mt-1 text-[12px] text-text-muted">{msg ?? "This will populate as applications flow."}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-semibold text-text mb-3">{title}</p>
      {children}
    </Card>
  );
}

function TrendChart({ data }: { data: { label: string; cur: number; prev: number }[] }) {
  const total = data.reduce((s, d) => s + d.cur + d.prev, 0);
  if (total < MIN_CHART) return <EmptyState />;
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} width={28} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
          <Line type="monotone" dataKey="prev" name="Previous" stroke="#c9c4d8" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="cur" name="Current" stroke={PURPLE} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FunnelBars({ stages }: { stages: { label: string; value: number }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  if (stages.reduce((s, x) => s + x.value, 0) < MIN_CHART) return <EmptyState />;
  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => (
        <div key={s.label}>
          <div className="flex items-center justify-between text-[12px] mb-1">
            <span className="text-text-mid">{s.label}</span>
            <span className="font-semibold text-text">{s.value}</span>
          </div>
          <div className="h-3 rounded-full bg-bg-tint overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(s.value / max) * 100}%`, backgroundColor: PURPLE, opacity: 1 - i * 0.22 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total < MIN_CHART) return <EmptyState />;
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2} stroke="#fff" strokeWidth={2}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-text-mid -mt-2">
        {data.map((d) => <span key={d.name} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />{d.name}: {d.value}</span>)}
      </div>
    </div>
  );
}

function SimpleBar({ data }: { data: { name: string; value: number }[] }) {
  if (data.reduce((s, d) => s + d.value, 0) < 1) return <EmptyState />;
  return (
    <div style={{ width: "100%", height: 180 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} width={28} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={d.name} fill={i === data.length - 1 ? PURPLE : "#c9c4d8"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TatTrendChart({ data }: { data: { label: string; tat: number | null }[] }) {
  const pts = data.filter((d) => d.tat != null);
  if (pts.length < MIN_CHART) return <EmptyState />;
  return (
    <div style={{ width: "100%", height: 180 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} width={30} tickFormatter={(v: number) => `${v}d`} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
          <Line type="monotone" dataKey="tat" name="Avg TAT (d)" stroke={PURPLE} strokeWidth={2.5} connectNulls dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function HealthCard({ h }: { h: Health }) {
  if (!h) return null;
  const tone = h.score >= 70 ? "#178a5c" : h.score >= 45 ? "#b45309" : "#b42318";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-semibold text-text">Business Health <span className="text-[11px] text-text-muted font-normal" title="Experimental — a transparent weighted score; interpret with care while data is sparse.">· experimental ⓘ</span></p>
        <span className="text-[26px] font-display font-bold" style={{ color: tone }}>{h.score}<span className="text-[13px] text-text-muted font-normal">/100</span></span>
      </div>
      <div className="space-y-2">
        {h.subs.map((s) => (
          <div key={s.label}>
            <div className="flex items-center justify-between text-[11.5px] mb-0.5"><span className="text-text-mid">{s.label}</span><span className="font-semibold text-text">{s.score}</span></div>
            <div className="h-1.5 rounded-full bg-bg-tint overflow-hidden"><div className="h-full rounded-full" style={{ width: `${clamp(s.score)}%`, backgroundColor: PURPLE }} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function WhatChangedCard({ wc, geoNote }: { wc: WhatChanged; geoNote?: string | null }) {
  const empty = !wc.positives.length && !wc.concerns.length && !wc.attention.length;
  return (
    <Card className="p-5">
      <p className="text-[13px] font-semibold text-text mb-3">What Changed</p>
      {empty && !geoNote ? (
        <p className="text-[12.5px] text-text-muted">No significant period-over-period changes above the reporting threshold.</p>
      ) : (
        <>
          {!empty && (
            <div className="grid gap-4 sm:grid-cols-3">
              <ChangeList title="Positive" color="#178a5c" items={wc.positives} />
              <ChangeList title="Areas of concern" color="#b42318" items={wc.concerns} />
              <ChangeList title="Needs attention" color="#b45309" items={wc.attention} />
            </div>
          )}
          {geoNote && (
            <div className={(empty ? "" : "mt-3 border-t border-line pt-3 ") + "flex items-start gap-2"}>
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: GEO + "1a", color: GEO }}>Geography</span>
              <span className="text-[12.5px] text-text-mid leading-snug">{geoNote}</span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
function ChangeList({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color }}>{title}</p>
      {items.length ? (
        <ul className="space-y-1.5">{items.map((x, i) => <li key={i} className="text-[12.5px] text-text-mid leading-snug flex gap-1.5"><span style={{ color }}>•</span><span>{x}</span></li>)}</ul>
      ) : <p className="text-[12px] text-text-muted">—</p>}
    </div>
  );
}

const SEV_STYLE: Record<Alert["sev"], { bg: string; fg: string; label: string }> = {
  high: { bg: "#fbeae8", fg: "#b42318", label: "High" },
  medium: { bg: "#fef0d6", fg: "#854f0b", label: "Medium" },
  positive: { bg: "#e6f6ee", fg: "#178a5c", label: "Positive" },
  monitor: { bg: "#eef1f0", fg: "#5a8a76", label: "Monitoring" },
};
function AlertsCard({ alerts }: { alerts: Alert[] }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-semibold text-text mb-3">Alerts</p>
      {alerts.length ? (
        <ul className="space-y-2">
          {alerts.map((a, i) => {
            const s = SEV_STYLE[a.sev];
            return (
              <li key={i} className="flex items-start gap-2.5">
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: s.bg, color: s.fg }}>{s.label}</span>
                <span className="text-[12.5px] text-text-mid leading-snug">{a.text}</span>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-[12.5px] text-text-muted">No alerts — metrics within normal range (or not enough data to raise one).</p>}
    </Card>
  );
}

function BottleneckCard({ text }: { text: string | null }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-semibold text-text mb-2">Bottleneck</p>
      <p className="text-[12.5px] text-text-mid leading-snug">{text ?? "No stage is dropping conversion significantly vs the previous period (or not enough data to compare)."}</p>
    </Card>
  );
}

function RecommendationsCard({ items }: { items: string[] }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-semibold text-text mb-2">Recommended Actions</p>
      {items.length ? (
        <ol className="space-y-2 list-none">
          {items.map((x, i) => <li key={i} className="text-[12.5px] text-text-mid leading-snug flex gap-2"><span className="font-semibold" style={{ color: PURPLE }}>{i + 1}.</span><span>{x}</span></li>)}
        </ol>
      ) : <p className="text-[12.5px] text-text-muted">No actions triggered — nothing above threshold this period.</p>}
    </Card>
  );
}

// ── section views (identical order/layout across sections) ────────────────────
function LoanSectionView({ title, s, w, note, loans }: { title: string; s: LoanSection; w: Windows; note: string | null; loans: Loan[] }) {
  const deltas = toDeltas(s.kpis);
  const geoNote = geoWhatChangedLine(loans, w);
  const bottleneck = s.convDrop ? `${s.convDrop.stage} conversion fell ${s.convDrop.drop.toFixed(0)} points vs the previous ${w.label.toLowerCase()} — the biggest drop in the pipeline.` : null;
  const recs: string[] = [];
  if (s.pendingOverdue > 0) recs.push(`${s.pendingOverdue} application${s.pendingOverdue === 1 ? "" : "s"} pending beyond 7 days — review the post-sanction queue.`);
  if (s.convDrop) recs.push(`Focus on the "${s.convDrop.stage}" step — its conversion dropped ${s.convDrop.drop.toFixed(0)} points.`);
  const rej = deltas.find((d) => d.label === "Total Rejected");
  if (rej && flagged(rej) && !improving(rej)) recs.push(`Rejections up ${Math.abs(rej.changePct as number).toFixed(0)}% — audit recent lender rejections for a common cause.`);

  return (
    <div className="space-y-6">
      {note && <p className="text-[12px] text-text-muted bg-bg-tint/60 border border-line rounded-lg px-3 py-2">{note}</p>}
      <SummaryBar text={buildSummary(title, deltas, w)} />
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">{s.kpis.map((k) => <KpiCard key={k.label} k={k} />)}</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><WhatChangedCard wc={buildWhatChanged(deltas, s.pendingOverdue)} geoNote={geoNote} /></div>
        <HealthCard h={loanHealth(s)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Applications trend (current vs previous)"><TrendChart data={s.trend} /></ChartCard>
        <ChartCard title="Funnel — Applied → Sanctioned → Disbursed"><FunnelBars stages={[{ label: "Applied", value: s.funnel.applied }, { label: "Sanctioned", value: s.funnel.sanctioned }, { label: "Disbursed", value: s.funnel.disbursed }]} /></ChartCard>
        <ChartCard title="Sanctioned vs Rejected vs Pending"><DonutChart data={[{ name: "Sanctioned", value: s.donut.sanctioned, color: "#178a5c" }, { name: "Rejected", value: s.donut.rejected, color: "#b42318" }, { name: "Pending", value: s.donut.pending, color: PURPLE }]} /></ChartCard>
        <ChartCard title="TAT trend (disbursed loans)"><TatTrendChart data={s.tatTrend} /></ChartCard>
        <ChartCard title="Disbursements — current vs previous"><SimpleBar data={s.disbBar} /></ChartCard>
      </div>
      <GeoBlock loans={loans} w={w} />
      <div className="grid gap-4 lg:grid-cols-3">
        <AlertsCard alerts={buildAlerts(deltas, s.pendingOverdue > 0 ? [{ sev: "medium", text: `${s.pendingOverdue} application${s.pendingOverdue === 1 ? "" : "s"} pending beyond 7 days.` }] : [])} />
        <BottleneckCard text={bottleneck} />
        <RecommendationsCard items={recs.slice(0, 3)} />
      </div>
    </div>
  );
}

function InsSectionView({ s, w }: { s: InsSection; w: Windows }) {
  const deltas = toDeltas(s.kpis);
  const recs: string[] = [];
  if (s.underIssuanceCur > 0) recs.push(`${s.underIssuanceCur} application${s.underIssuanceCur === 1 ? "" : "s"} awaiting a policy document — chase the insurer/upload queue.`);
  const iss = deltas.find((d) => d.label === "Policy Issued");
  if (iss && flagged(iss) && !improving(iss)) recs.push(`Policies issued down ${Math.abs(iss.changePct as number).toFixed(0)}% — check the issuance pipeline.`);
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
        <ChartCard title="Issued vs Rejected vs Pending"><DonutChart data={[{ name: "Issued", value: s.donut.issued, color: "#178a5c" }, { name: "Rejected", value: s.donut.rejected, color: "#b42318" }, { name: "Pending", value: s.donut.pending, color: PURPLE }]} /></ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <AlertsCard alerts={buildAlerts(deltas)} />
        <BottleneckCard text={null} />
        <RecommendationsCard items={recs.slice(0, 3)} />
      </div>
    </div>
  );
}

function EpcSectionView({ s, w }: { s: EpcSection; w: Windows }) {
  const deltas = toDeltas(s.kpis);
  const recs: string[] = [];
  const rev = deltas.find((d) => d.label === "Avg Review Time");
  if (rev && flagged(rev) && !improving(rev)) recs.push(`Review time up ${Math.abs(rev.changePct as number).toFixed(0)}% (${rev.fmt(rev.m.cur)}) — clear the EPC review backlog.`);
  const og = deltas.find((d) => d.label === "% Filled in One Go");
  if (og && flagged(og) && !improving(og)) recs.push(`Single-session completion dropped to ${og.fmt(og.m.cur)} — check where EPCs abandon onboarding.`);
  return (
    <div className="space-y-6">
      <SummaryBar text={buildSummary("EPC", deltas, w)} />
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">{s.kpis.map((k) => <KpiCard key={k.label} k={k} />)}</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><WhatChangedCard wc={buildWhatChanged(deltas)} /></div>
        <HealthCard h={epcHealth(s)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Fill-time distribution"><SimpleBar data={s.fillHist.map((b) => ({ name: b.label, value: b.count }))} /></ChartCard>
        <ChartCard title="Filled in one go">{s.oneGo.length ? <DonutChart data={[{ name: "One go", value: s.oneGo[0].value, color: "#178a5c" }, { name: "Multi-session", value: s.oneGo[1].value, color: PURPLE }]} /> : <EmptyState />}</ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <AlertsCard alerts={buildAlerts(deltas)} />
        <BottleneckCard text={null} />
        <RecommendationsCard items={recs.slice(0, 3)} />
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
function GeographySectionView({ resLoans, comLoans, allLoans, w }: { resLoans: Loan[]; comLoans: Loan[]; allLoans: Loan[]; w: Windows }) {
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
function CrossTable({ res, com, ins, epc }: { res: LoanSection; com: LoanSection; ins: InsSection; epc: EpcSection }) {
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
