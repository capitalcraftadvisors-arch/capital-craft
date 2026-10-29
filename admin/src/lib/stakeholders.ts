// Stakeholders (/admin/stakeholders, main admin only — migration 0106): the CC
// team's profiles and the partners (lenders, insurance partners). Each profile
// keeps its details in one jsonb `details` object; the fields and document
// slots below define what a profile shows. Adding a field = one line here.

import { supabase } from "@/lib/supabase";
import { addLender, invalidateLenders } from "@/lib/lenders";

export type FieldSpec = { key: string; label: string; type?: "text" | "date" | "email" | "tel" | "url" | "textarea" };
export type FieldGroup = { title: string; fields: FieldSpec[] };
export type Details = Record<string, string>;
export type PartnerKind = "lender" | "insurance";
export type Partner = { id: string; kind: PartnerKind; name: string; lender_key: string | null; details: Details };
export type StakeholderDoc = { id: string; category: string; storage_path: string; file_name: string | null; mime_type: string | null; created_at: string };

// "Other" holds any number of extra documents (shown by file name).
export const OTHER_DOC = "Other";

// A team member = an admin login (epc_business, business_type 'admin').
export type TeamMember = { id: string; contact_name: string | null; contact_mobile: string | null; contact_email: string | null; role: string | null };
export const ROLE_LABEL: Record<string, string> = { MAIN_ADMIN: "Main admin", MANAGER: "Manager", OPERATIONS_USER: "Operations" };
export const roleLabel = (role: string | null | undefined) => ROLE_LABEL[role ?? ""] ?? (role || "Admin");

export const TEAM_GROUPS: FieldGroup[] = [
  { title: "Work", fields: [
    { key: "designation", label: "Designation" },
    { key: "joining_date", label: "Joining date", type: "date" },
    { key: "reporting_to", label: "Reports to" },
    { key: "work_location", label: "Work location" },
  ] },
  { title: "Personal", fields: [
    { key: "date_of_birth", label: "Date of birth", type: "date" },
    { key: "personal_phone", label: "Personal phone", type: "tel" },
    { key: "address", label: "Address", type: "textarea" },
  ] },
  { title: "Emergency contact", fields: [
    { key: "emergency_name", label: "Name" },
    { key: "emergency_relation", label: "Relation" },
    { key: "emergency_phone", label: "Phone", type: "tel" },
  ] },
  { title: "Salary account", fields: [
    { key: "bank_name", label: "Bank" },
    { key: "account_no", label: "Account no" },
    { key: "ifsc", label: "IFSC" },
  ] },
  { title: "Notes", fields: [{ key: "notes", label: "Notes", type: "textarea" }] },
];
export const TEAM_DOCS = ["Aadhaar card", "PAN card", "Photo", "Offer letter", "Appointment letter", "Cancelled cheque"];

export const LENDER_GROUPS: FieldGroup[] = [
  { title: "Company", fields: [
    { key: "legal_name", label: "Legal name" },
    { key: "lender_type", label: "Type (NBFC / Bank)" },
    { key: "rbi_registration", label: "RBI registration no" },
    { key: "gstin", label: "GSTIN" },
    { key: "website", label: "Website", type: "url" },
    { key: "address", label: "Registered address", type: "textarea" },
  ] },
  { title: "Contacts", fields: [
    { key: "rm_name", label: "Relationship manager" },
    { key: "rm_phone", label: "RM phone", type: "tel" },
    { key: "rm_email", label: "RM email", type: "email" },
    { key: "files_email", label: "Send files to (email)", type: "email" },
    { key: "escalation", label: "Escalation contact" },
  ] },
  { title: "Lending terms", fields: [
    { key: "products", label: "Products (residential / commercial)" },
    { key: "interest_rate", label: "Interest rate" },
    { key: "loan_range", label: "Loan amount range" },
    { key: "tenure", label: "Tenure" },
    { key: "processing_fee", label: "Processing fee" },
    { key: "states", label: "States covered" },
    { key: "tat", label: "Approval TAT" },
  ] },
  { title: "Agreement", fields: [
    { key: "agreement_start", label: "Agreement start", type: "date" },
    { key: "agreement_end", label: "Agreement end / renewal", type: "date" },
    { key: "payout", label: "Payout / commission" },
  ] },
  { title: "Notes", fields: [{ key: "notes", label: "Notes", type: "textarea" }] },
];
export const LENDER_DOCS = ["Lender policy", "Credit policy", "Agreement / MoU", "Rate card", "Document checklist"];

export const INSURANCE_GROUPS: FieldGroup[] = [
  { title: "Company", fields: [
    { key: "legal_name", label: "Legal name" },
    { key: "irdai_registration", label: "IRDAI registration no" },
    { key: "gstin", label: "GSTIN" },
    { key: "website", label: "Website", type: "url" },
    { key: "address", label: "Address", type: "textarea" },
  ] },
  { title: "Contacts", fields: [
    { key: "rm_name", label: "Relationship manager" },
    { key: "rm_phone", label: "RM phone", type: "tel" },
    { key: "rm_email", label: "RM email", type: "email" },
    { key: "claims_email", label: "Claims email", type: "email" },
    { key: "claims_phone", label: "Claims phone", type: "tel" },
  ] },
  { title: "Products", fields: [
    { key: "products", label: "Products" },
    { key: "coverage", label: "Coverage" },
    { key: "premium_rate", label: "Premium rate" },
    { key: "commission", label: "Commission" },
  ] },
  { title: "Agreement", fields: [
    { key: "agreement_start", label: "Agreement start", type: "date" },
    { key: "agreement_end", label: "Agreement end / renewal", type: "date" },
  ] },
  { title: "Notes", fields: [{ key: "notes", label: "Notes", type: "textarea" }] },
];
export const INSURANCE_DOCS = ["Policy wording", "Agreement / MoU", "Premium chart", "Claim process"];

export const PARTNER_SPEC: Record<PartnerKind, { label: string; groups: FieldGroup[]; docs: string[] }> = {
  lender: { label: "Lender", groups: LENDER_GROUPS, docs: LENDER_DOCS },
  insurance: { label: "Insurance partner", groups: INSURANCE_GROUPS, docs: INSURANCE_DOCS },
};

// Keeps only non-empty, trimmed values — an emptied field leaves the object.
export function cleanDetails(d: Details): Details {
  const out: Details = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === "string" && v.trim()) out[k] = v.trim();
  return out;
}

export async function listPartners(): Promise<Partner[]> {
  const { data } = await supabase().from("partners").select("id, kind, name, lender_key, details").order("name");
  return (data ?? []) as Partner[];
}

export async function getPartner(id: string): Promise<Partner | null> {
  const { data } = await supabase().from("partners").select("id, kind, name, lender_key, details").eq("id", id).maybeSingle();
  return (data as Partner | null) ?? null;
}

export async function createPartner(kind: PartnerKind, name: string, details: Details): Promise<{ id?: string; error?: string }> {
  if (kind === "lender") {
    // A lender joins the registry every screen reads; 0107 makes its profile.
    // One already registered opens as it is.
    const r = await addLender(name);
    if (r.error || !r.lender) return { error: r.error || "Couldn't add the lender." };
    const q = supabase().from("partners");
    const { data, error } = r.existed
      ? await q.select("id").eq("lender_key", r.lender.key).single()
      : await q.update({ details: cleanDetails(details), updated_at: new Date().toISOString() }).eq("lender_key", r.lender.key).select("id").single();
    return error ? { error: error.message } : { id: (data as { id: string }).id };
  }
  const { data, error } = await supabase().from("partners").insert({ kind, name: name.trim(), details: cleanDetails(details) }).select("id").single();
  return error ? { error: error.message } : { id: (data as { id: string }).id };
}

export async function savePartner(id: string, name: string, details: Details): Promise<string | null> {
  const { error } = await supabase().from("partners")
    .update({ name: name.trim(), details: cleanDetails(details), updated_at: new Date().toISOString() }).eq("id", id);
  invalidateLenders(); // a lender's rename reaches the registry (0107)
  return error ? error.message : null;
}

export async function getTeamDetails(id: string): Promise<Details> {
  const { data } = await supabase().from("team_profiles").select("details").eq("business_id", id).maybeSingle();
  return ((data as { details?: Details } | null)?.details ?? {}) as Details;
}

export async function saveTeamDetails(id: string, details: Details): Promise<string | null> {
  const { error } = await supabase().from("team_profiles")
    .upsert({ business_id: id, details: cleanDetails(details), updated_at: new Date().toISOString() });
  return error ? error.message : null;
}

export async function listStakeholderDocs(owner: { team_id: string } | { partner_id: string }): Promise<StakeholderDoc[]> {
  const [col, id] = "team_id" in owner ? ["team_id", owner.team_id] : ["partner_id", owner.partner_id];
  const { data } = await supabase().from("stakeholder_docs")
    .select("id, category, storage_path, file_name, mime_type, created_at").eq(col, id).order("created_at");
  return (data ?? []) as StakeholderDoc[];
}
