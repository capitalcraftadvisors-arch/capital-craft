// Rupee formatting — one home for the ₹ helpers that were copied across the app.
// Behaviour-preserving: each export matches, byte-for-byte, the copies it replaces.

/** "₹1,80,000" — rounded, Indian grouping. "—" for null/NaN; "₹0" for 0. */
export function fmtRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
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

/** Like fmtRupees but ALSO shows "—" for 0 (lender summaries / ZIP routes). */
export function rupees(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0 ? "₹" + Math.round(v).toLocaleString("en-IN") : "—";
}
