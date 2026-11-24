// Analytics — data shapes, period math and the rule-based "intelligence" (no AI): KPIs, deltas, summaries, health scores, geography.

import { lenderOutcome } from "@/lib/loan-status";
import type { Win, Windows } from "@/lib/periods";

// Thresholds (deterministic intelligence).
const FLAG_PCT = 10;   // flag a change only when |Δ| ≥ 10%
const FLAG_TAT = 2;    // …or ≥ 2 days for TAT metrics
const STABLE_PCT = 5;  // arrow reads "stable" below this
const MIN_PREV = 5;    // suppress deltas/insight when previous window < 5 points
export const MIN_CHART = 3;   // charts show the empty state below this many points

// Geography thresholds (display-layer normalization only).
export const GEO_MIN_INSIGHT = 10;   // suppress geo insights when the period cohort < 10
const GEO_MIN_PLACE = 5;      // a place needs ≥5 rows before it's named in an insight

// ── data shapes ─────────────────────────────────────────────────────────────
export type Loan = {
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
export type Insurance = { id: string; created_at: string; status: string; policy_path: string | null };
export type Biz = {
  id: string; source: string | null; status: string; created_at: string;
  submitted_at: string | null; reviewed_at: string | null;
  step_timestamps: Record<string, string> | null;
};
export type LenderRow = { business_id: string; lender: string; docs_given_at: string | null; approved_at: string | null };

// ── numeric helpers ──────────────────────────────────────────────────────────
export const t = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);
export const inWin = (ms: number, w: Win) => Number.isFinite(ms) && ms >= w.start && ms < w.end;
const days = (a: number, b: number) => (a - b) / 86_400_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function pct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
export const fmtInt = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-IN"));
export const fmtPct1 = (n: number | null) => (n == null ? "—" : `${n.toFixed(0)}%`);
export const fmtDays = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)} d`);

type Metric = { cur: number | null; prev: number | null; nCur: number; nPrev: number };
type Dir = "up" | "down"; // "up" = higher is better; "down" = lower is better
export type Kpi = { label: string; m: Metric; fmt: (n: number | null) => string; dir: Dir; caption?: string };

// ── section computation: LOANS (Residential / C&I) ───────────────────────────
export type LoanSection = {
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

export function computeLoanSection(all: Loan[], w: Windows): LoanSection {
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
export type GeoMetric = "apps" | "sanctioned" | "disbursed";
type GeoFieldKey = "install_city" | "install_district" | "install_state";
export type GeoBar = { label: string; value: number; share: number; valueLabel: string };
export const GEO_UNKNOWN = "\u0000unknown"; // NUL-prefixed: can never equal a real (normalised) place key

// Trim + collapse whitespace + case-fold for grouping; Title Case for display.
// Null/blank → null (grouped as "Unknown" by callers, excluded from insights).
export function normPlace(raw: string | null | undefined): { key: string; label: string } | null {
  if (raw == null) return null;
  const cleaned = String(raw).trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  return { key: lower, label: lower.replace(/\b\w/g, (c) => c.toUpperCase()) };
}

export function groupPlaces(arr: Loan[], f: GeoFieldKey): Map<string, { label: string; count: number }> {
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
export function topBars(m: Map<string, { label: string; count: number }>, n = 5): GeoBar[] {
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
export function geoInsights(cur: Loan[], prev: Loan[], noun: string): string[] {
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

// ── section computation: INSURANCE ───────────────────────────────────────────
export type InsSection = {
  kpis: Kpi[];
  funnel: { applied: number; issued: number };
  donut: { issued: number; rejected: number; pending: number };
  trend: { label: string; cur: number; prev: number }[];
  totalCur: number; totalPrev: number; issuedCur: number; issuanceRateCur: number | null;
  underIssuanceCur: number;
};
export function computeInsSection(all: Insurance[], w: Windows): InsSection {
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
export type EpcSection = {
  kpis: Kpi[];
  fillHist: { label: string; count: number }[];
  oneGo: { name: string; value: number }[];
  onboardedCur: number; onboardedPrev: number;
  approvalRateCur: number | null; reviewCur: number | null;
};
const ONE_GO_MAX_GAP_MIN = 30;
export function computeEpcSection(biz: Biz[], lenders: LenderRow[], w: Windows): EpcSection {
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
export function toDeltas(kpis: Kpi[]): Delta[] {
  return kpis.map((k) => ({ label: k.label, changePct: pct(k.m.cur, k.m.prev), dir: k.dir, m: k.m, fmt: k.fmt }));
}
const improving = (d: Delta) => d.changePct != null && (d.dir === "up" ? d.changePct > 0 : d.changePct < 0);
const flagged = (d: Delta) => {
  if (d.changePct == null || d.m.nPrev < MIN_PREV) return false;
  const tatLike = d.fmt === fmtDays;
  if (tatLike && d.m.cur != null && d.m.prev != null) return Math.abs(d.m.cur - d.m.prev) >= FLAG_TAT || Math.abs(d.changePct) >= FLAG_PCT;
  return Math.abs(d.changePct) >= FLAG_PCT;
};

export type WhatChanged = { positives: string[]; concerns: string[]; attention: string[] };
export function buildWhatChanged(deltas: Delta[], pendingOverdue?: number): WhatChanged {
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

export function buildSummary(title: string, deltas: Delta[], w: Windows): string {
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

// ── good/bad arrow ────────────────────────────────────────────────────────────
export function arrowFor(d: Delta): { glyph: string; cls: string; text: string } {
  if (d.changePct == null || d.m.nPrev < MIN_PREV) return { glyph: "→", cls: "text-text-muted", text: "no prior data" };
  if (Math.abs(d.changePct) < STABLE_PCT) return { glyph: "→", cls: "text-text-muted", text: `${Math.abs(d.changePct).toFixed(0)}% · stable` };
  return improving(d)
    ? { glyph: "↑", cls: "text-cc-green", text: `${Math.abs(d.changePct).toFixed(0)}% · improving` }
    : { glyph: "↓", cls: "text-danger-ink", text: `${Math.abs(d.changePct).toFixed(0)}% · declining` };
}

// ── health score (transparent weighted formula, documented) ───────────────────
export type Health = { score: number; subs: { label: string; score: number }[] } | null;
export const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
// Loans: 35% approval rate · 25% speed (TAT, 20d→0) · 20% momentum (apps Δ) ·
//        20% flow (disbursed/sanctioned). Insurance: 55% issuance rate · 25%
//        momentum · 20% backlog-clear. Each sub-score is 0–100; final = weighted mean.
export function insHealth(s: InsSection): Health {
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
export function epcHealth(s: EpcSection): Health {
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
