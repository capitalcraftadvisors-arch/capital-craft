"use client";

// Analytics dashboard — admin-only, /admin/analytics.
//
// Five metric cards derived from the timestamps introduced in
// migration 0019 plus columns that already existed on epc_business
// and epc_lender_status.
//
// All metrics are computed client-side from two SELECTs; the row
// count stays small (< a few hundred) for the foreseeable future.
// If it ever grows, move the aggregation into a Postgres view.
//
// Metrics:
//   1. EPC fill time         — created_at → submitted_at
//   2. Filled in one go      — no gap > ONE_GO_MAX_GAP_MIN minutes
//                              between consecutive step timestamps
//   3. Admin review time     — submitted_at → reviewed_at (first admin
//                              decision after submit)
//   4. Docs to lender        — submitted_at → docs_given_at, per lender
//   5. Lender approval time  — docs_given_at → approved_at, per lender
//
// Empty-state: each card shows a placeholder until it has >= MIN_SAMPLES.
// Existing 37 EPCs onboarded before 0019 have NULL timestamps and are
// naturally excluded — they never appear in any denominator.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import { supabase } from "@/lib/supabase";

// ── brand palette ────────────────────────────────────────
const GREEN       = "#178a5c";
const GREEN_MID   = "#2b955f";
const GREEN_LIGHT = "#3fa07d";
const SKY         = "#185fa5";
const SKY_MID     = "#3175b0";
const SKY_LIGHT   = "#4a8cc5";

// ── constants ────────────────────────────────────────────
const MIN_SAMPLES = 3;              // per-card empty-state threshold
const ONE_GO_MAX_GAP_MIN = 30;      // in-flow gap threshold for one-go

const LENDERS = ["creditfair", "aerem", "solfin"] as const;
type Lender = typeof LENDERS[number];
const LENDER_LABEL: Record<Lender, string> = {
  creditfair: "CreditFair",
  aerem:      "Aerem",
  solfin:     "Solfin",
};

// ── DB row shapes ────────────────────────────────────────
type Biz = {
  id: string;
  source: string | null;
  status: string;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  step_timestamps: Record<string, string> | null;
};
type LenderRow = {
  business_id: string;
  lender: Lender;
  docs_given_at: string | null;
  approved_at:   string | null;
};

// ── time helpers ─────────────────────────────────────────
function diffSeconds(later: string | Date, earlier: string | Date): number {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / 1000;
}

function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "—";
  if (sec < 90)    return `${Math.round(sec)} sec`;
  if (sec < 5400)  return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
  return `${(sec / 86400).toFixed(1)} d`;
}

const FILL_BUCKETS = [
  { label: "< 15 min",  cap: 15 * 60 },
  { label: "15–60 min", cap: 60 * 60 },
  { label: "1–4 h",     cap: 4 * 3600 },
  { label: "4–24 h",    cap: 24 * 3600 },
  { label: "1–7 d",     cap: 7 * 86400 },
  { label: "> 7 d",     cap: Infinity },
];
const REVIEW_BUCKETS = [
  { label: "< 1 h",  cap: 3600 },
  { label: "1–4 h",  cap: 4 * 3600 },
  { label: "4–24 h", cap: 24 * 3600 },
  { label: "1–3 d",  cap: 3 * 86400 },
  { label: "> 3 d",  cap: Infinity },
];

function bucketize(sec: number, buckets: { label: string; cap: number }[]): number {
  return buckets.findIndex((b) => sec < b.cap);
}

// ── page ────────────────────────────────────────────────

export default function AnalyticsPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const [biz, setBiz]         = useState<Biz[]>([]);
  const [lender, setLender]   = useState<LenderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [{ data: b }, { data: l }] = await Promise.all([
        supabase().from("epc_business")
          .select("id, source, status, created_at, submitted_at, reviewed_at, step_timestamps")
          .not("submitted_at", "is", null)
          .neq("business_type", "admin"),
        supabase().from("epc_lender_status")
          .select("business_id, lender, docs_given_at, approved_at"),
      ]);
      setBiz((b ?? []) as Biz[]);
      setLender((l ?? []) as LenderRow[]);
      setLoading(false);
    })();
  }, []);

  // Metric #1 — fill time. source='epc' only so admin-created shells
  // don't dirty the average (their created_at is the admin's click time,
  // not the EPC's actual sit-down start).
  const fillSamples = useMemo(() => {
    return biz
      .filter((r) => (r.source ?? "epc") === "epc" && r.submitted_at)
      .map((r) => diffSeconds(r.submitted_at!, r.created_at))
      .filter((s) => isFinite(s) && s >= 0);
  }, [biz]);

  // Metric #2 — one-go. Requires all 6 step_N_completed_at + submitted_at.
  // Gaps checked between step_1..step_6, then to submitted_at. If any
  // is missing (e.g. legacy row, or an EPC that started before 0019),
  // that EPC is silently skipped from the denominator.
  const oneGoSamples = useMemo(() => {
    const out: { oneGo: boolean }[] = [];
    for (const r of biz) {
      const ts = r.step_timestamps ?? {};
      const times: number[] = [];
      let missing = false;
      for (let i = 1; i <= 6; i++) {
        const v = ts[`step_${i}_completed_at`];
        if (!v) { missing = true; break; }
        times.push(new Date(v).getTime());
      }
      if (missing || !r.submitted_at) continue;
      times.push(new Date(r.submitted_at).getTime());

      let maxGapMin = 0;
      for (let i = 1; i < times.length; i++) {
        const gapMin = (times[i] - times[i - 1]) / 1000 / 60;
        if (gapMin > maxGapMin) maxGapMin = gapMin;
      }
      out.push({ oneGo: maxGapMin < ONE_GO_MAX_GAP_MIN });
    }
    return out;
  }, [biz]);

  // Metric #3 — admin review time.
  const reviewSamples = useMemo(() => {
    return biz
      .filter((r) => r.submitted_at && r.reviewed_at)
      .map((r) => diffSeconds(r.reviewed_at!, r.submitted_at!))
      .filter((s) => isFinite(s) && s >= 0);
  }, [biz]);

  // Metric #4 — submitted_at → docs_given_at, per lender.
  const docsByLender = useMemo(() => {
    const submittedAt = new Map(biz.map((r) => [r.id, r.submitted_at]));
    const out: Record<Lender, number[]> = { creditfair: [], aerem: [], solfin: [] };
    for (const l of lender) {
      const s = submittedAt.get(l.business_id);
      if (!s || !l.docs_given_at) continue;
      const d = diffSeconds(l.docs_given_at, s);
      if (isFinite(d) && d >= 0) out[l.lender].push(d);
    }
    return out;
  }, [biz, lender]);

  // Metric #5 — docs_given_at → approved_at, per lender.
  const approvalByLender = useMemo(() => {
    const out: Record<Lender, number[]> = { creditfair: [], aerem: [], solfin: [] };
    for (const l of lender) {
      if (!l.docs_given_at || !l.approved_at) continue;
      const d = diffSeconds(l.approved_at, l.docs_given_at);
      if (isFinite(d) && d >= 0) out[l.lender].push(d);
    }
    return out;
  }, [lender]);

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-[20px] grad-text">Capital Craft</span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">
              Analytics
            </span>
          </div>
          <button
            onClick={() => router.push("/admin")}
            className="text-[13px] text-text-muted hover:text-text"
          >
            ← Back to console
          </button>
        </div>
      </header>

      <section className="w-full px-4 sm:px-6 py-8">
        <h1 className="font-display text-[26px] sm:text-[30px] font-bold">Analytics</h1>
        <p className="text-[13px] text-text-muted mt-1 mb-6 max-w-2xl">
          Metrics populate as new EPCs move through the pipeline.
          The 37 EPCs onboarded before analytics tracking was added
          do not have the timestamps and are excluded from every metric.
        </p>

        {loading ? (
          <p className="text-[13px] text-text-muted">Loading…</p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <FillTimeCard       samples={fillSamples} />
            <OneGoCard          samples={oneGoSamples} />
            <ReviewTimeCard     samples={reviewSamples} />
            <DocsToLenderCard   byLender={docsByLender} />
            <LenderApprovalCard byLender={approvalByLender} />
          </div>
        )}
      </section>
    </main>
  );
}

// ── shared card scaffold ─────────────────────────────────

function MetricCard({
  title, subtitle, stat, statColor, children, n,
}: {
  title: string;
  subtitle?: string;
  stat?: string;
  statColor?: string;
  children: React.ReactNode;
  n: number;
}) {
  const hasData = n >= MIN_SAMPLES;
  return (
    <Card className="p-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold text-[16px]">{title}</h3>
          {subtitle && <p className="text-[12px] text-text-muted mt-0.5">{subtitle}</p>}
        </div>
        <div className="text-[11px] text-text-muted whitespace-nowrap">n = {n}</div>
      </div>

      {hasData && stat && (
        <p className="mt-3 text-[28px] font-display font-bold" style={{ color: statColor ?? SKY }}>
          {stat}
        </p>
      )}

      <div className="mt-4">
        {hasData ? children : <EmptyState n={n} />}
      </div>
    </Card>
  );
}

function EmptyState({ n }: { n: number }) {
  return (
    <div className="border border-dashed border-line rounded-input p-8 flex flex-col items-center text-center bg-bg-tint">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={SKY} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M7 14l3-3 4 4 6-6" />
      </svg>
      <p className="mt-3 text-[13px] font-semibold text-text">Not enough data yet</p>
      <p className="mt-1 text-[12px] text-text-muted">
        This will populate as EPCs move through the pipeline.
      </p>
      <p className="mt-2 text-[11px] text-text-muted">
        Currently tracking: {n} sample{n === 1 ? "" : "s"}
      </p>
    </div>
  );
}

// ── metric #1 — fill time histogram ─────────────────────

function FillTimeCard({ samples }: { samples: number[] }) {
  const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
  const data = FILL_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const s of samples) {
    const idx = bucketize(s, FILL_BUCKETS);
    if (idx >= 0) data[idx].count++;
  }
  return (
    <MetricCard
      title="EPC fill time"
      subtitle="created_at → submitted_at (self-onboarded EPCs)"
      stat={samples.length ? fmtDuration(avg) : undefined}
      statColor={SKY}
      n={samples.length}
    >
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
            <Tooltip cursor={{ fill: "rgba(24,95,165,0.06)" }} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
            <Bar dataKey="count" fill={SKY} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </MetricCard>
  );
}

// ── metric #2 — one-go donut ─────────────────────────────

function OneGoCard({ samples }: { samples: { oneGo: boolean }[] }) {
  const n = samples.length;
  const oneGoCount = samples.filter((s) => s.oneGo).length;
  const pct = n > 0 ? Math.round((oneGoCount / n) * 100) : 0;
  const data = [
    { name: "One go",         value: oneGoCount },
    { name: "Multi-session",  value: n - oneGoCount },
  ];
  return (
    <MetricCard
      title="Filled in one go"
      subtitle={`No gap > ${ONE_GO_MAX_GAP_MIN} min between onboarding steps`}
      stat={n ? `${pct}%` : undefined}
      statColor={GREEN}
      n={n}
    >
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              stroke="#ffffff"
              strokeWidth={2}
            >
              <Cell fill={GREEN} />
              <Cell fill={SKY} />
            </Pie>
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </MetricCard>
  );
}

// ── metric #3 — admin review time histogram ─────────────

function ReviewTimeCard({ samples }: { samples: number[] }) {
  const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
  const data = REVIEW_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const s of samples) {
    const idx = bucketize(s, REVIEW_BUCKETS);
    if (idx >= 0) data[idx].count++;
  }
  return (
    <MetricCard
      title="Admin review time"
      subtitle="submitted_at → first admin decision"
      stat={samples.length ? fmtDuration(avg) : undefined}
      statColor={GREEN}
      n={samples.length}
    >
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
            <Tooltip cursor={{ fill: "rgba(23,138,92,0.06)" }} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
            <Bar dataKey="count" fill={GREEN} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </MetricCard>
  );
}

// ── metrics #4 & #5 — per-lender bar charts ─────────────

function DocsToLenderCard({ byLender }: { byLender: Record<Lender, number[]> }) {
  return (
    <PerLenderCard
      title="Time to send docs to lender"
      subtitle="submitted_at → docs_given_at, per lender"
      byLender={byLender}
      palette={[SKY, SKY_MID, SKY_LIGHT]}
      statColor={SKY}
    />
  );
}

function LenderApprovalCard({ byLender }: { byLender: Record<Lender, number[]> }) {
  return (
    <PerLenderCard
      title="Lender approval time"
      subtitle="docs_given_at → approved_at, per lender"
      byLender={byLender}
      palette={[GREEN, GREEN_MID, GREEN_LIGHT]}
      statColor={GREEN}
    />
  );
}

function PerLenderCard({
  title, subtitle, byLender, palette, statColor,
}: {
  title: string;
  subtitle: string;
  byLender: Record<Lender, number[]>;
  palette: [string, string, string];
  statColor: string;
}) {
  const total = LENDERS.reduce((a, k) => a + byLender[k].length, 0);
  const data = LENDERS.map((k) => {
    const arr = byLender[k];
    const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return { lender: LENDER_LABEL[k], avgSec: avg, n: arr.length };
  });
  const overallAvg = total > 0
    ? LENDERS.flatMap((k) => byLender[k]).reduce((a, b) => a + b, 0) / total
    : 0;

  return (
    <MetricCard
      title={title}
      subtitle={subtitle}
      stat={total ? fmtDuration(overallAvg) : undefined}
      statColor={statColor}
      n={total}
    >
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <XAxis dataKey="lender" tick={{ fontSize: 12, fill: "#374151", fontWeight: 600 }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: "#6b7280" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickLine={false}
              tickFormatter={(v: number) => (v > 0 ? fmtDuration(v) : "0")}
              width={70}
            />
            <Tooltip
              formatter={(v: number | string) => [fmtDuration(Number(v)), "Avg"]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
            />
            <Bar dataKey="avgSec" radius={[4, 4, 0, 0]}>
              <Cell fill={palette[0]} />
              <Cell fill={palette[1]} />
              <Cell fill={palette[2]} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
        {LENDERS.map((k) => (
          <span key={k}>
            <span className="font-semibold text-text">{LENDER_LABEL[k]}:</span>{" "}
            n = {byLender[k].length}
          </span>
        ))}
      </div>
    </MetricCard>
  );
}
