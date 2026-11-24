"use client";

// Analytics — shared presentational pieces: summary bar, KPI card, empty state, charts, health and what-changed cards.

import type { ReactNode } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, Cell, PieChart, Pie, CartesianGrid,
} from "recharts";
import { ACCENTS } from "@/components/AdminSidebar";
import Card from "@/components/ui/Card";
import { MIN_CHART, toDeltas, arrowFor, clamp, type Kpi, type Health, type WhatChanged } from "./metrics";

export const ACCENT = ACCENTS.analytics.color; // the Analytics green — chrome + charts
export const SLATE = "#94a3b8"; // neutral slice colour (kept distinct from the green "good" slice)
// Geography (sections A–D) — teal accent.
export const GEO = "#0d9488";        // Geography accent (distinct from the analytics purple)

// ── shared presentational pieces ─────────────────────────────────────────────
export function SummaryBar({ text }: { text: string }) {
  return (
    <Card className="p-5" >
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 mt-0.5" style={{ backgroundColor: ACCENT + "1a", color: ACCENT }}>
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

export function KpiCard({ k }: { k: Kpi }) {
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

export function EmptyState({ msg }: { msg?: string }) {
  return (
    <div className="border border-dashed border-line rounded-xl p-8 flex flex-col items-center text-center bg-bg-tint/40">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 14l3-3 4 4 6-6" /></svg>
      <p className="mt-2.5 text-[13px] font-semibold text-text">Not enough data yet</p>
      <p className="mt-1 text-[12px] text-text-muted">{msg ?? "This will populate as applications flow."}</p>
    </div>
  );
}

export function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-semibold text-text mb-3">{title}</p>
      {children}
    </Card>
  );
}

export function TrendChart({ data }: { data: { label: string; cur: number; prev: number }[] }) {
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
          <Line type="monotone" dataKey="cur" name="Current" stroke={ACCENT} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FunnelBars({ stages }: { stages: { label: string; value: number }[] }) {
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
            <div className="h-full rounded-full" style={{ width: `${(s.value / max) * 100}%`, backgroundColor: ACCENT, opacity: 1 - i * 0.22 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DonutChart({ data }: { data: { name: string; value: number; color: string }[] }) {
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

export function SimpleBar({ data }: { data: { name: string; value: number }[] }) {
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
            {data.map((d, i) => <Cell key={d.name} fill={i === data.length - 1 ? ACCENT : "#c9c4d8"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HealthCard({ h }: { h: Health }) {
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
            <div className="h-1.5 rounded-full bg-bg-tint overflow-hidden"><div className="h-full rounded-full" style={{ width: `${clamp(s.score)}%`, backgroundColor: ACCENT }} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function WhatChangedCard({ wc, geoNote }: { wc: WhatChanged; geoNote?: string | null }) {
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
