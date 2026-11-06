// EPC business display helpers — shared by the admin EPC pages, the ZIP export
// and the partner's own Organization profile (pure, no IO: safe on the server).

export const BUSINESS_TYPE_LABEL: Record<string, string> = {
  proprietorship: "Proprietorship",
  pvt_ltd:        "Private Limited",
  partnership:    "Partnership",
  llp:            "LLP",
};

/** The heading for an EPC's people — by constitution. */
export function peopleHeading(bt: string | null | undefined): string {
  switch (bt) {
    case "proprietorship": return "Proprietor details";
    case "pvt_ltd":        return "Director details";
    case "partnership":
    case "llp":            return "Partner details";
    default:               return "Stakeholder details";
  }
}

/** Account number with all but the last 4 digits hidden. */
export function maskAcct(a: string | null | undefined): string {
  if (!a) return "—";
  if (a.length <= 4) return "•".repeat(6) + a;
  return "•".repeat(Math.max(6, a.length - 4)) + a.slice(-4);
}
