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

const PILL_BASE =
  "inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide";

export default function StatusBadge({
  status,
  updated,
}: {
  status: AllStatus | string;
  // When true, render a second "Updated" pill next to the status. Used to
  // surface the EPC's one-time self-edit having happened.
  updated?: boolean;
}) {
  const s = (status as AllStatus) in STYLES ? (status as AllStatus) : "draft";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={[PILL_BASE, STYLES[s]].join(" ")}>{LABELS[s]}</span>
      {updated && (
        <span
          className={[PILL_BASE, "bg-gold-50 text-[#8a6500]"].join(" ")}
          title="EPC used their one-time self-edit"
        >
          Updated
        </span>
      )}
    </span>
  );
}
