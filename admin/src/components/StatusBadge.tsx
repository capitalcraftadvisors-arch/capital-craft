type AllStatus =
  | "draft" | "under_review" | "approved" | "on_hold" | "rejected"
  | "submitted" | "sent_to_nbfc" | "disbursed";

const STYLES: Record<AllStatus, string> = {
  draft:        "bg-line-soft text-text-mid",
  submitted:    "bg-blue-50 text-blue",
  under_review: "bg-blue-50 text-blue",
  on_hold:      "bg-gold-50 text-[#8a6500]",
  approved:     "bg-green-50 text-green-dark",
  rejected:     "bg-red-50 text-red-700",
  sent_to_nbfc: "bg-blue-50 text-blue-dark",
  disbursed:    "bg-green-50 text-green-dark",
};

const LABELS: Record<AllStatus, string> = {
  draft:        "Draft",
  submitted:    "Submitted",
  under_review: "Under review",
  on_hold:      "On hold",
  approved:     "Approved",
  rejected:     "Rejected",
  sent_to_nbfc: "Sent to NBFC",
  disbursed:    "Disbursed",
};

export default function StatusBadge({ status }: { status: AllStatus | string }) {
  const s = (status as AllStatus) in STYLES ? (status as AllStatus) : "draft";
  return (
    <span className={["inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide", STYLES[s]].join(" ")}>
      {LABELS[s]}
    </span>
  );
}
