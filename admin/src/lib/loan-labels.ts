// Loan labels shared by the admin pages, the partner pages and the server routes.

/** Solar system type → short label ("On-Grid"). */
export const SYSTEM_LABEL: Record<string, string> = { on_grid: "On-Grid", off_grid: "Off-Grid", hybrid: "Hybrid" };

/** Plant use → label. */
export const PLANT_USE_LABEL: Record<string, string> = { residential: "Residential", commercial: "Commercial" };

/** Employment type → label. */
export const EMPLOYMENT_LABEL: Record<string, string> = { salaried: "Salaried", self_employed: "Self-employed" };

/** The customer-facing application id: the stored loan_display_id
 *  (LA-<last5 mobile>-<seq>, set by the 0030 trigger once Step 1 saves the
 *  mobile), else a reference made from the row's uuid (rows created before it). */
export function loanDisplayId(id: string, stored?: string | null): string {
  return stored || "LA-" + String(id).replace(/-/g, "").slice(0, 8).toUpperCase();
}
