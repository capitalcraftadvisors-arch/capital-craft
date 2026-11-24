"use client";

// Admin console — summary period: the picker in the section header (owned by
// the page shell, persisted per tab) and the IST window every console tab
// scopes its cards + list to. Same dropdown as the Task Manager board, so NOT
// lib/period's options/picker: the console offers different labels ("Current
// Month", "Month to month"), no "This Week" ("week" stays in the union for
// back-compat but is no longer offered), and a month-to-month custom range.
// Every other period's bounds are lib/period's.

import { useMemo } from "react";
import { periodBounds as libPeriodBounds, type Period } from "@/lib/period";

export type { Period };
// Period is owned by the page shell and passed to each summary tab so the
// picker can live in the section header (top-right), with a per-tab default.
export type TabPeriodProps = { period: Period; pFrom: string; pTo: string };
const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: "today",      label: "Today" },
  { value: "month",      label: "Current Month" },
  { value: "prev_month", label: "Previous Month" },
  { value: "quarter",    label: "This Quarter" },
  { value: "year",       label: "This Year" },
  { value: "all",        label: "All time" },
  { value: "custom",     label: "Month to month" },
];
function periodBounds(period: Period, from?: string, to?: string): { start: number; end: number } {
  if (period === "custom") {
    // Month-to-month range (matches the board): from/to are "YYYY-MM",
    // inclusive of whole months. (.slice guards any stale day-level value
    // persisted before this became a month picker.)
    const f = from ? from.slice(0, 7) : "";
    const t = to ? to.slice(0, 7) : "";
    const monthStart = (ym: string) => Date.parse(`${ym}-01T00:00:00+05:30`);
    const nextMonthStart = (ym: string) => {
      const [yy, mm] = ym.split("-").map(Number);
      return mm === 12
        ? Date.parse(`${yy + 1}-01-01T00:00:00+05:30`)
        : Date.parse(`${yy}-${String(mm + 1).padStart(2, "0")}-01T00:00:00+05:30`);
    };
    return { start: f ? monthStart(f) : -Infinity, end: t ? nextMonthStart(t) : Infinity };
  }
  return libPeriodBounds(period);
}
export function inPeriod(dateStr: string | null | undefined, period: Period, from?: string, to?: string): boolean {
  if (period === "all") return true; // no date filter — keeps rows with null dates too
  if (!dateStr) return false;
  const t = Date.parse(dateStr);
  if (isNaN(t)) return false;
  const { start, end } = periodBounds(period, from, to);
  return t >= start && t < end;
}
export function PeriodPicker({ period, onPeriod, from, onFrom, to, onTo }: {
  period: Period; onPeriod: (p: Period) => void;
  from: string; onFrom: (v: string) => void; to: string; onTo: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={period}
        onChange={(e) => onPeriod(e.target.value as Period)}
        className="rounded-input border border-line bg-white px-3 py-2 text-[13px] font-medium text-[#0f3d2e] outline-none focus:border-[#185fa5] cursor-pointer"
      >
        {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {period === "custom" && (
        <>
          <input type="month" value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} className="rounded-input border border-line bg-white px-2.5 py-2 text-[13px]" aria-label="From month" />
          <span className="text-[12px] text-text-muted">to</span>
          <input type="month" value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} className="rounded-input border border-line bg-white px-2.5 py-2 text-[13px]" aria-label="To month" />
        </>
      )}
    </div>
  );
}

// The rows a tab's summary cards count: created inside the picked period.
export function usePeriodRows<T extends { created_at: string }>(rows: T[], period: Period, pFrom: string, pTo: string): T[] {
  return useMemo(() => rows.filter((r) => inPeriod(r.created_at, period, pFrom, pTo)), [rows, period, pFrom, pTo]);
}
