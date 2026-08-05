// Lender-outcome presentation for loan applications.
//
// A loan application has NO internal admin status. Every surface that
// shows a loan application's state (admin list, admin View page, the
// EPC's own dashboard) presents the SAME three buckets, mapped from
// the application's pipeline status:
//
//     approved / sent_to_nbfc / disbursed  →  "Approved by lender"
//     rejected                             →  "Rejected by lender"
//     draft / submitted / under_review /
//     on_hold (and anything else)          →  "Under Review"
//
// Pipeline management (setting approved / rejected / sent_to_nbfc)
// stays on the admin application-detail page; this module is display
// only.

export type LenderOutcome = "approved" | "rejected" | "review";

export function lenderOutcome(status: string | null | undefined): LenderOutcome {
  // 'rfd' (Ready for Disbursement) is post-approval, so the EPC keeps seeing
  // "Approved by lender" — never a regression back to "Under Review".
  if (status === "approved" || status === "rfd" || status === "sent_to_nbfc" || status === "disbursed") return "approved";
  if (status === "rejected") return "rejected";
  return "review";
}

export const OUTCOME_LABEL: Record<LenderOutcome, string> = {
  approved: "Approved by lender",
  rejected: "Rejected by lender",
  review:   "Under Review",
};

export const OUTCOME_PILL: Record<LenderOutcome, string> = {
  approved: "bg-green-50 text-green-dark",
  rejected: "bg-red-50 text-red-700",
  review:   "bg-blue-50 text-blue",
};

// Statuses each bucket covers — used by list filters.
export const OUTCOME_STATUSES: Record<LenderOutcome, string[]> = {
  approved: ["approved", "rfd", "sent_to_nbfc", "disbursed"],
  rejected: ["rejected"],
  review:   ["draft", "submitted", "under_review", "on_hold"],
};
