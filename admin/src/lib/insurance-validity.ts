// Policy validity display — shared by the admin insurance View and the admin
// dashboard's "Policy Validity" column, so they never disagree.
//
//   "12 Jul 2026 – 11 Jul 2027 · 284 days left"
//   green normally · amber within 30 days · red once expired
//
// Dates are Postgres `date` columns ("YYYY-MM-DD"); parsed as LOCAL calendar
// dates (never new Date("YYYY-MM-DD"), which is UTC and can shift a day in IST).

export type ValidityTone = "green" | "amber" | "red";

const DAY = 24 * 60 * 60 * 1000;

function parseISO(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function fmt(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export type ValidityParts = {
  text: string;
  tone: ValidityTone;
  daysLeft: number | null;
  // Individually formatted endpoints (same safe local-date parse as `text`),
  // so callers can show a "Valid until" date without re-parsing the raw
  // "YYYY-MM-DD" (which risks an IST off-by-one).
  fromLabel: string | null;
  toLabel: string | null;
};

export function policyValidityParts(
  from: string | null | undefined,
  to: string | null | undefined,
): ValidityParts | null {
  const f = from ? parseISO(from) : null;
  const t = to ? parseISO(to) : null;
  if (!f && !t) return null;

  const fromLabel = f ? fmt(f) : null;
  const toLabel = t ? fmt(t) : null;
  const range = `${fromLabel ?? "?"} – ${toLabel ?? "?"}`;
  if (!t) return { text: range, tone: "green", daysLeft: null, fromLabel, toLabel };

  const today = startOfDay(new Date());
  const daysLeft = Math.round((t.getTime() - today.getTime()) / DAY);
  let tone: ValidityTone;
  let tail: string;
  if (daysLeft < 0) {
    tone = "red";
    const n = Math.abs(daysLeft);
    tail = `expired ${n} ${n === 1 ? "day" : "days"} ago`;
  } else {
    tone = daysLeft <= 30 ? "amber" : "green";
    tail = `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
  }
  return { text: `${range} · ${tail}`, tone, daysLeft, fromLabel, toLabel };
}

export function policyValidity(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  return policyValidityParts(from, to)?.text ?? "—";
}

export const VALIDITY_TEXT: Record<ValidityTone, string> = {
  green: "text-[#178a5c]",
  amber: "text-[#854f0b]",
  red: "text-red-700",
};
