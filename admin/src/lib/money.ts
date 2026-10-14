// Rupee formatting — one home for the ₹ helpers that were copied across the app.
// Behaviour-preserving: each export matches, byte-for-byte, the copies it replaces.

/** "₹1,80,000" — rounded, Indian grouping. "—" for null/NaN; "₹0" for 0. */
export function fmtRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
}

/** Like fmtRupees but ALSO shows "—" for 0 (lender summaries / ZIP routes). */
export function rupees(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0 ? "₹" + Math.round(v).toLocaleString("en-IN") : "—";
}
