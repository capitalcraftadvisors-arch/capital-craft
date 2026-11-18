// The follow-up status of a raw lead (customer_leads, gozerobils_leads) — its
// values, labels and pill colours, shared by the lead lists.

export const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "converted", label: "Converted" },
  { value: "closed", label: "Closed" },
];

export const LEAD_STATUS_PILL: Record<string, string> = {
  new:       "bg-[#dceffb] text-[#185fa5]",
  contacted: "bg-[#fef0d6] text-[#854f0b]",
  converted: "bg-[#e6f6ee] text-[#178a5c]",
  closed:    "bg-[#eef1f0] text-[#5a8a76]",
};
