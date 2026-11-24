"use client";

// Pieces shared by the two insurance tables (Solar Insurance + Other
// Insurance): the Policy Validity cell, the policy-expiry filter and its
// days-left sort, the Report's policy-date cells, and the Download Policy button.

import { policyValidityParts } from "@/lib/insurance-validity";
import { fmtDate } from "@/lib/dates";
import { IconDownload } from "./kit";

type PolicyDates = { policy_from_date: string | null; policy_to_date: string | null; created_at: string };

// The file icon in the Insured-name cell.
export const IconPolicyDoc = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>
);

// "Policy expiry" filter options.
export const EXPIRY_OPTIONS = [
  { value: "30",      label: "Expiring in 30 days" },
  { value: "90",      label: "Expiring in 90 days" },
  { value: "expired", label: "Expired" },
  { value: "none",    label: "No policy" },
];

// Days left on the policy (negative = expired); null when it has no dates.
export const policyDaysLeft = (r: PolicyDates): number | null =>
  policyValidityParts(r.policy_from_date, r.policy_to_date)?.daysLeft ?? null;

// The "Policy expiry" filter on a row's days left (expiryFilter non-empty).
export function expiryMatch(d: number | null, expiryFilter: string): boolean {
  if (expiryFilter === "none")    { if (d !== null) return false; }
  else if (d === null)            { return false; }
  else if (expiryFilter === "expired") { if (d >= 0) return false; }
  else if (expiryFilter === "30")      { if (d < 0 || d > 30) return false; }
  else if (expiryFilter === "90")      { if (d < 0 || d > 90) return false; }
  return true;
}

// The Report CSV's "Policy from" / "Policy to" cells (blank when not set).
export const policyDateCells = (r: PolicyDates): [string, string] => [
  r.policy_from_date ? fmtDate(r.policy_from_date) : "",
  r.policy_to_date ? fmtDate(r.policy_to_date) : "",
];

// Rows WITH policy dates first, fewest days left on top (expired is negative,
// so it floats to the very top); rows with no policy below, newest first.
export function byPolicyDaysLeft(a: PolicyDates, b: PolicyDates): number {
  const da = policyDaysLeft(a), db = policyDaysLeft(b);
  const ha = da !== null, hb = db !== null;
  if (ha !== hb) return ha ? -1 : 1;
  if (ha && hb) return (da as number) - (db as number);
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

// Policy Validity cell — end date, with the colour-coded days-left badge below.
// Shared by the Solar Insurance and Other Insurance tables.
export function PolicyValidityCell({ from, to }: { from: string | null; to: string | null }) {
  const v = policyValidityParts(from, to);
  if (!v) return <span className="text-[13px] text-cc-muted">—</span>;
  const badge =
    v.tone === "red"   ? "bg-red-50 text-red-700 border-red-200" :
    v.tone === "amber" ? "bg-warn-tint text-warn-ink border-warn-line" :
                         "bg-cc-tint text-cc-green border-cc-line";
  const daysText =
    v.daysLeft == null ? null :
    v.daysLeft < 0 ? `Expired ${Math.abs(v.daysLeft)}d ago` :
    `${v.daysLeft} ${v.daysLeft === 1 ? "day" : "days"} left`;
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[13px] font-semibold text-cc-ink">{v.toLabel ?? "—"}</span>
      {daysText && (
        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold ${badge}`}>{daysText}</span>
      )}
    </div>
  );
}

// Download Policy — shown only when a policy document exists; `busy` while it opens.
export function DownloadPolicyButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={busy} onClick={onClick}
      className={["text-[12px] font-semibold px-2.5 py-1.5 rounded-input inline-flex items-center justify-center gap-1.5 transition-colors",
        busy ? "bg-bg-soft text-text-muted cursor-not-allowed" : "bg-cc-green text-white hover:bg-cc-green-hover"].join(" ")}>
      {IconDownload} {busy ? "Opening…" : "Download Policy"}
    </button>
  );
}
