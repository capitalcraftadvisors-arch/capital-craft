// The follow-up status of a raw lead (customer_leads, gozerobils_leads) — its
// values, labels and pill colours, shared by the lead lists.

export const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "converted", label: "Converted" },
  { value: "closed", label: "Closed" },
];

export const LEAD_STATUS_PILL: Record<string, string> = {
  new:       "bg-cc-blue-tint text-cc-blue",
  contacted: "bg-warn-tint text-warn-ink",
  converted: "bg-cc-tint text-cc-green",
  closed:    "bg-cc-chip text-cc-muted",
};
