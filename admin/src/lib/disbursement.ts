// Shared disbursement logic — used by BOTH portals (admin loan table +
// disbursement screen, and the EPC dashboard table + disbursement screen) so
// the countdown can never disagree between the two.
//
// The 45-day clock starts on first_disbursement_date. Before the first
// disbursement is entered there's no clock yet, so we show the full window
// ("45 days") as a static default.
//
// Overdue is a FLAG, not a gate: it turns the countdown red for admin review
// and never blocks anything on its own.

export const DISBURSEMENT_WINDOW_DAYS = 45;

// Amber once the remaining window drops under this.
const AMBER_AT_DAYS = 10;

export type DeadlineTone = "green" | "amber" | "red";

export type DeadlineState = {
  /** true once first_disbursement_date is set — i.e. the clock is running. */
  started: boolean;
  /** Days left. Negative = overdue. Defaults to the full window before start. */
  daysRemaining: number;
  overdue: boolean;
  tone: DeadlineTone;
  /** Short label for tables: "45 days" / "12 days left" / "3 days overdue". */
  label: string;
  /** first_disbursement_date + 45 days (mirrors the generated DB column). */
  deadline: Date | null;
};

// Parses a DATE column ("YYYY-MM-DD") as a LOCAL calendar date. Using
// new Date("YYYY-MM-DD") would parse as UTC midnight and can land on the
// previous day in IST, which would skew the countdown by one.
function parseDateOnly(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : startOfDay(d);
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function deadlineState(firstDisbursementDate?: string | null): DeadlineState {
  // Clock not started — show the full window as the default.
  if (!firstDisbursementDate) {
    return {
      started: false,
      daysRemaining: DISBURSEMENT_WINDOW_DAYS,
      overdue: false,
      tone: "green",
      label: `${DISBURSEMENT_WINDOW_DAYS} days`,
      deadline: null,
    };
  }

  const start = parseDateOnly(firstDisbursementDate);
  if (!start) {
    return {
      started: false,
      daysRemaining: DISBURSEMENT_WINDOW_DAYS,
      overdue: false,
      tone: "green",
      label: `${DISBURSEMENT_WINDOW_DAYS} days`,
      deadline: null,
    };
  }

  const deadline = new Date(start.getFullYear(), start.getMonth(), start.getDate() + DISBURSEMENT_WINDOW_DAYS);
  const today = startOfDay(new Date());
  const daysRemaining = Math.round((deadline.getTime() - today.getTime()) / DAY_MS);
  const overdue = daysRemaining < 0;

  const tone: DeadlineTone = overdue ? "red" : daysRemaining < AMBER_AT_DAYS ? "amber" : "green";
  const label = overdue
    ? `${Math.abs(daysRemaining)} ${Math.abs(daysRemaining) === 1 ? "day" : "days"} overdue`
    : `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left`;

  return { started: true, daysRemaining, overdue, tone, label, deadline };
}

// Tailwind classes for the countdown pill, keyed by tone. Brand green /
// existing amber / red — same palette the rest of the admin uses.
export const DEADLINE_PILL: Record<DeadlineTone, string> = {
  green: "bg-[#e6f6ee] text-[#178a5c] border border-[#cdeadd]",
  amber: "bg-[#fef0d6] text-[#854f0b] border border-[#f3d9a4]",
  red:   "bg-red-50 text-red-700 border border-red-200",
};

/** Sanctioned − first disbursement. Null when we don't know the sanctioned amount. */
export function remainingAmount(
  sanctioned: number | null | undefined,
  first: number | null | undefined,
): number | null {
  const s = Number(sanctioned);
  if (!Number.isFinite(s)) return null;
  const f = Number.isFinite(Number(first)) ? Number(first) : 0;
  return Math.max(0, s - f);
}

/** The amount shown in the Amount column: sanctioned once approved, else applied. */
export function displayAmount(loan: {
  status?: string | null;
  sanctioned_amount?: number | null;
  loan_amount_required?: number | null;
  loan_amount?: number | null;
}): number | null {
  if (loan.status === "approved" && loan.sanctioned_amount != null) {
    return Number(loan.sanctioned_amount);
  }
  const n = loan.loan_amount_required ?? loan.loan_amount;
  return n == null ? null : Number(n);
}

export function fmtRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
}

/** "12 Jul 2026" — compact date for tables/headers. */
export function fmtDateShort(v: string | null | undefined): string {
  if (!v) return "—";
  const d = parseDateOnly(v);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
