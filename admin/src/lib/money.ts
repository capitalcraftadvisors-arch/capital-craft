// Rupee formatting + number typing — one home for the ₹ helpers that were copied
// across the app. Amounts show their paise whenever they have any (15/11, the
// user: "where we take numbers we allow every real number, and show it").

/** "1,74,139.20" / "1,80,000" — Indian grouping, paise only when there are some. */
export function inrPlain(n: number): string {
  const v = Math.round(n * 100) / 100;
  return v.toLocaleString("en-IN", Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "₹1,80,000" / "₹1,74,139.20" — Indian grouping, paise when present. "—" for null/NaN; "₹0" for 0. */
export function fmtRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + inrPlain(Number(n));
}

/** "₹57,777.5" — EXACT, never rounded (up to 6 decimal places), Indian grouping.
 *  For sanctioned / approval / disbursement amounts. "—" for null/NaN. */
export function fmtRupeesExact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 6 });
}

/** "80%" — `part` as a share of `whole` (at most 1 decimal); null when either is missing or 0.
 *  E.g. the loan amount as a share of the project cost. */
export function pctOf(part: unknown, whole: unknown): string | null {
  const p = Number(part), w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || p <= 0 || w <= 0) return null;
  return `${Number(((p / w) * 100).toFixed(1))}%`;
}

/** What a number box keeps while typing — any real number: an optional leading
 *  minus, digits and ONE decimal point with at most `places` decimals. A box that
 *  turned each keystroke into a number would drop a trailing "." or a lone "-".
 *  (Rules like "must be more than 0" are checked on save, not while typing.) */
export function numberInput(v: string, places = Infinity): string {
  const minus = v.trimStart().startsWith("-") ? "-" : "";
  const s = v.replace(/[^\d.]/g, "");
  const i = s.indexOf(".");
  return minus + (i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "").slice(0, places));
}

/** An amount box: any real number, to the paisa (2 decimals) — "174139.2", "-500", "0". */
export function amountInput(v: string): string {
  return numberInput(v, 2);
}

/** "₹1.25 Cr" / "₹4.5 L" / "₹85,000.50" — short form for analytics figures. */
export function rupeesShort(v: number): string {
  return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : `₹${inrPlain(v)}`;
}

/** Like fmtRupees but ALSO shows "—" for 0 (lender summaries / ZIP routes). */
export function rupees(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0 ? "₹" + inrPlain(v) : "—";
}
