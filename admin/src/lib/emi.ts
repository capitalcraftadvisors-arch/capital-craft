// Shared EMI + subsidy math for the loan-application flows.
//
// Single source of truth used by BOTH the admin Step 5 (Loan Offers)
// page and the EPC-facing 3-page apply flow — same reducing-balance
// formula, same PM Surya Ghar subsidy tiers, so the numbers a customer
// sees in either flow always agree.

export const ROI_MIN = 7.5;
export const ROI_MAX = 10.8;
export const CENTRAL_SUBSIDY_CAP = 78000;
export const TENURES = [1, 2, 3, 4, 5] as const;

// Fixed reducing-balance rate used to compute every loan EMI. This is a
// BACKEND-ONLY value — the rate itself is never shown to admins or EPCs; only
// the resulting EMI amounts are displayed.
export const DEFAULT_INDICATIVE_ROI = 16;

// PM Surya Ghar central subsidy tiers on installed capacity (kW):
//   1 kW  → ₹30,000
//   2 kW  → ₹60,000
//   ≥3 kW → ₹78,000 (cap)
export function computeCentralSubsidy(kw: number | null): number {
  if (kw == null || !Number.isFinite(kw) || kw <= 0) return 0;
  const whole = Math.floor(kw);
  if (whole <= 0) return 0;
  if (whole === 1) return 30000;
  if (whole === 2) return 60000;
  return CENTRAL_SUBSIDY_CAP;
}

// Reducing-balance EMI, rounded to the nearest rupee.
// principal in rupees, roi in percent per annum, years whole years.
export function computeEmi(principal: number, roiPct: number, years: number): number {
  if (principal <= 0 || roiPct <= 0 || years <= 0) return 0;
  const r = (roiPct / 100) / 12;
  const n = years * 12;
  const pow = Math.pow(1 + r, n);
  return Math.round(principal * r * pow / (pow - 1));
}

export function formatRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
