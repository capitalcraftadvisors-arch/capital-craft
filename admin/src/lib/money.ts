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

/** Like fmtRupees but ALSO shows "—" for 0 (lender summaries / ZIP routes). */
export function rupees(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0 ? "₹" + Math.round(v).toLocaleString("en-IN") : "—";
}
