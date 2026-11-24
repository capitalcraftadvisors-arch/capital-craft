// EPC members (epc_business.stakeholders) and references
// (epc_business.business_references): the stored shapes, the read-back
// normaliser and the dropdown options shared by the onboarding steps, the
// admin onboarding chat and the admin EPC page.

/** One proprietor / partner / director as stored in epc_business.stakeholders. */
export type Stakeholder = {
  id: string;
  name: string;
  designation: string;
  mobile: string;
  email: string;
  father_name: string;
  dob: string;
  aadhaar_number: string;
  aadhaar_address: string;
};

/** One customer / supplier reference as stored in epc_business.business_references. */
export type EpcReference = { type: "customer" | "supplier"; name: string; mobile: string };

function withId(r: Record<string, unknown>, id: string): Stakeholder {
  return {
    id,
    name: (r.name as string) ?? "",
    designation: (r.designation as string) ?? "",
    mobile: (r.mobile as string) ?? "",
    email: (r.email as string) ?? "",
    father_name: (r.father_name as string) ?? "",
    dob: (r.dob as string) ?? "",
    aadhaar_number: (r.aadhaar_number as string) ?? "",
    aadhaar_address: (r.aadhaar_address as string) ?? "",
  };
}

/** A stored member with every field present ("" when missing — legacy rows lack
 *  mobile / email); a member without an id gets a new one. */
export function normalizeStakeholder(raw: unknown): Stakeholder {
  const r = (raw ?? {}) as Record<string, unknown>;
  return withId(r, (r.id as string) ?? crypto.randomUUID());
}

/** Same, but a member without an id keeps "" (the admin EPC page). */
export function normalizeStakeholderKeepId(raw: unknown): Stakeholder {
  const r = (raw ?? {}) as Record<string, unknown>;
  return withId(r, (r.id as string) ?? "");
}

/** "How did you hear about us?" */
export const REFERRAL_OPTIONS = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "website", label: "Website" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "friend", label: "Friend" },
  { value: "epc_partner", label: "EPC Partner" },
  { value: "others", label: "Others (Please specify)" },
];

/** The contact person's designation. */
export const DESIGNATION_OPTIONS = [
  { value: "Partner",    label: "Partner" },
  { value: "Director",   label: "Director" },
  { value: "Proprietor", label: "Proprietor" },
  { value: "Owner",      label: "Owner" },
  { value: "Manager",    label: "Manager" },
];
