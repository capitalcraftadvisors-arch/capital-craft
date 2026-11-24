// EPC View · labels and formatters for the header and the Business info card
// (service, team size, capacity, turnover).

export type AdminInfo = {
  team_size: string | null;
  team_technical: number | null;
  team_non_technical: number | null;
  capacity_residential: number | null;
  capacity_residential_unit: "KW" | "MW" | null;
  capacity_commercial: number | null;
  capacity_commercial_unit: "KW" | "MW" | null;
  turnover_last_fy: string | null;
  turnover_lakhs: number | null;
};

// The EPC's service (epc_business.service_type) as shown in the header.
export const SERVICE_LABEL: Record<string, string> = {
  loans:     "Loan",
  insurance: "Insurance",
  both:      "Loan and Insurance",
};

export function fmtCapacity(n: number | null | undefined, unit: string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const u = unit === "KW" ? "kW" : unit === "MW" ? "MW" : (unit ?? "");
  return `${n} ${u}`.trim();
}

// Team size: prefer the split Technical/Non-Technical counts; fall back to
// the legacy combined free-text value for historical rows.
export function fmtTeam(ai: AdminInfo | null): string | null {
  if (!ai) return null;
  if (ai.team_technical != null || ai.team_non_technical != null) {
    const t = ai.team_technical != null ? String(ai.team_technical) : "—";
    const nt = ai.team_non_technical != null ? String(ai.team_non_technical) : "—";
    return `${t} tech · ${nt} non-tech`;
  }
  return ai.team_size ?? null;
}

// Turnover: prefer the numeric ₹ Lakhs value; fall back to the legacy
// free-text value for historical rows.
export function fmtTurnover(ai: AdminInfo | null): string | null {
  if (!ai) return null;
  if (ai.turnover_lakhs != null) return `₹${ai.turnover_lakhs} Lakhs`;
  return ai.turnover_last_fy ?? null;
}

export function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
