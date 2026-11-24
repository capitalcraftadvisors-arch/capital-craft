// Partner dashboard · the loan / insurance rows it reads, their stage, labels and
// the small formatters the sections share; the regional managers it shows.

import { fmtDateTime } from "@/lib/dates";
import { fmtRupees } from "@/lib/money";

// Capital Craft regional managers shown on the EPC portal (tap to Call). Numbers
// are in international format, digits only. TODO: confirm these are the correct
// numbers before deploying to production.
export const RMS: { name: string; phone: string }[] = [
  { name: "Manish Kumar", phone: "918769145691" },
  { name: "Malvika",      phone: "917300085864" },
];

export type AppRow = {
  id: string;
  borrower_name: string | null; aadhaar_name: string | null; loan_display_id: string | null;
  loan_amount: number | null; loan_amount_required: number | null;
  project_size: number | null; project_size_unit: string | null;
  sanctioned_amount: number | null;
  first_disbursement_amount: number | null; first_disbursement_date: string | null;
  second_disbursement_amount: number | null; second_disbursement_date: string | null;
  status: string; created_at: string; aadhaar_front_path: string | null;
  submitted_at: string | null; reviewed_at: string | null; docs_sent_at: string | null;
  approved_at: string | null; rejected_at: string | null; rejection_reason: string | null;
  epc_updated_at: string | null;
  edit_locked: boolean;   // 0084 — locked after submit
  edit_allow: string[] | null;   // 0085 — rows Capital Craft opened for editing
  attention_status: string | null; attention_raised_at: string | null; msg_epc_seen_at: string | null;
};
export type InsRow = {
  id: string; insurance_display_id: string | null; aadhaar_name: string | null;
  sum_insured: number | null; invoice_confirmed_amount: number | null; insurance_partner: string | null;
  policy_from_date: string | null; policy_to_date: string | null; status: string; created_at: string;
  attention_status: string | null; attention_raised_at: string | null; msg_epc_seen_at: string | null;
};

export const INS_STATUS_PILL: Record<string, string> = {
  draft: "bg-cc-chip text-cc-muted", under_review: "bg-warn-tint text-warn-ink",
  issued: "bg-cc-tint text-cc-green", rejected: "bg-red-50 text-red-700", hold: "bg-cc-blue-tint text-cc-blue",
};
export type Stage4 = "under_review" | "updated" | "approved" | "rejected";
// Loan-table filter chips: the 4 stages + "all" + the 2nd-tranche-pending view.
export type FilterKey = "all" | Stage4 | "tranche_pending";
// Insurance-table filter chips ("renewal" = Due for renewal, Partner Portal v2 only).
export type InsFilter = "all" | "under_review" | "issued" | "hold" | "rejected" | "expiring" | "renewal";
export const STAGE4_LABEL: Record<Stage4, string> = { under_review: "Under review", updated: "Updated", approved: "Approved", rejected: "Rejected" };
export const STAGE4_PILL: Record<Stage4, string> = {
  under_review: "bg-warn-tint text-warn-ink", updated: "bg-navy-tint text-navy",
  approved: "bg-cc-tint text-cc-green", rejected: "bg-red-50 text-red-700",
};

/** fmtDateTime, or "" when there's no timestamp. */
export function fmtDateTimeOrBlank(iso: string | null): string {
  return iso ? fmtDateTime(iso) : "";
}
export function borrower(r: AppRow): string { return r.borrower_name || r.aadhaar_name || "—"; }
export function capacity(r: AppRow): string { return r.project_size == null ? "—" : `${r.project_size} ${(r.project_size_unit ?? "kw").toUpperCase()}`; }
// An EPC can edit a file ONLY for the specific rows Capital Craft opened via a
// Message to EPC (the edit_allow grant, 0085). Everything else — drafts AND
// submitted applications — is locked; the EPC has no self-edit without a grant.
export function canEpcEdit(r: AppRow): boolean {
  return Array.isArray(r.edit_allow) && r.edit_allow.length > 0;
}
export function stage4(r: AppRow): Stage4 {
  if (r.status === "rejected") return "rejected";
  if (["approved", "sent_to_nbfc", "disbursed"].includes(r.status)) return "approved";
  if (r.epc_updated_at) return "updated";
  return "under_review";
}
export function statusChangedAt(r: AppRow): string | null {
  const s = stage4(r);
  if (s === "rejected") return r.rejected_at ?? null;
  if (s === "approved") return r.approved_at ?? r.first_disbursement_date ?? null;
  if (s === "updated") return r.epc_updated_at ?? null;
  return null;
}
export function lastChangeTs(r: AppRow): number {
  const ts = [r.created_at, r.submitted_at, r.epc_updated_at, r.approved_at, r.rejected_at, r.first_disbursement_date, r.second_disbursement_date]
    .filter(Boolean).map((d) => new Date(d as string).getTime());
  return ts.length ? Math.max(...ts) : 0;
}
export const appliedAmount = (r: AppRow) => fmtRupees(r.loan_amount_required ?? r.loan_amount);
