// ── Summary-card time period (Today / Week / Month / Quarter / Year / Custom) ──
// IST-aware boundary logic, shared between the admin dashboards and profile
// pages (e.g. EPC Health) so they filter counts identically.
export type Period = "today" | "week" | "month" | "quarter" | "year" | "custom";

export const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: "today",   label: "Today" },
  { value: "week",    label: "This Week" },
  { value: "month",   label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "year",    label: "This Year" },
  { value: "custom",  label: "Custom range" },
];

export function periodBounds(period: Period, from?: string, to?: string): { start: number; end: number } {
  const DAY = 86400000;
  if (period === "custom") {
    return {
      start: from ? Date.parse(from + "T00:00:00+05:30") : -Infinity,
      end:   to   ? Date.parse(to + "T23:59:59.999+05:30") : Infinity,
    };
  }
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(new Date());
  const y = Number(p.find((x) => x.type === "year")?.value);
  const m = Number(p.find((x) => x.type === "month")?.value);
  const d = Number(p.find((x) => x.type === "day")?.value);
  const wd = p.find((x) => x.type === "weekday")?.value ?? "Mon";
  const mid = (yy: number, mm: number, dd: number) =>
    Date.parse(`${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}T00:00:00+05:30`);
  const todayStart = mid(y, m, d);
  switch (period) {
    case "today":   return { start: todayStart, end: todayStart + DAY };
    case "week": {
      const off = Math.max(0, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd));
      const start = todayStart - off * DAY;
      return { start, end: start + 7 * DAY };
    }
    case "month":   return { start: mid(y, m, 1), end: m === 12 ? mid(y + 1, 1, 1) : mid(y, m + 1, 1) };
    case "quarter": {
      const qs = m - ((m - 1) % 3);
      const qe = qs + 3;
      return { start: mid(y, qs, 1), end: qe > 12 ? mid(y + 1, qe - 12, 1) : mid(y, qe, 1) };
    }
    case "year":    return { start: mid(y, 1, 1), end: mid(y + 1, 1, 1) };
    default:        return { start: -Infinity, end: Infinity };
  }
}

export function inPeriod(dateStr: string | null | undefined, period: Period, from?: string, to?: string): boolean {
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
    <div className="flex items-center gap-2 flex-wrap mb-3">
      <select
        value={period}
        onChange={(e) => onPeriod(e.target.value as Period)}
        className="rounded-input border border-line bg-white px-3 py-2 text-[13px] font-medium text-[#0f3d2e] outline-none focus:border-[#185fa5] cursor-pointer"
      >
        {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {period === "custom" && (
        <>
          <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="rounded-input border border-line bg-white px-2.5 py-2 text-[13px]" />
          <span className="text-[12px] text-text-muted">to</span>
          <input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="rounded-input border border-line bg-white px-2.5 py-2 text-[13px]" />
        </>
      )}
    </div>
  );
}
