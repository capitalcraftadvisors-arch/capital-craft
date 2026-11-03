// Analytics period windows — shared by Analytics and Team analytics.
//
// The current window runs from the period start to NOW (period-to-date); the
// previous window is the equivalent-length window immediately before, using
// the SAME elapsed duration, so comparisons are fair (e.g. month-to-date vs
// last-month-to-the-same-elapsed-point).

export type Preset = "today" | "week" | "month" | "quarter" | "year" | "custom";
export type Win = { start: number; end: number };
export type Windows = { cur: Win; prev: Win; label: string; recent: boolean };

export const PRESET_LABEL: Record<Preset, string> = {
  today: "Today", week: "This Week", month: "This Month",
  quarter: "This Quarter", year: "This Year", custom: "Custom range",
};

export function computeWindows(preset: Preset, now: Date, cs?: string, ce?: string): Windows {
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
