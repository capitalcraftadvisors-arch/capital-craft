"use client";

// ╔══════════════════════════════════════════════════════════════════╗
// ║  APPROVAL DETAILS TABLE — EDIT THE FIELDS HERE                    ║
// ║                                                                   ║
// ║  This is the single place that defines the approval table. It is  ║
// ║  used in BOTH modes:                                              ║
// ║    • /admin/app/[id]/approval  → editable (admin fills it in)     ║
// ║    • /admin/app/[id]/view      → read-only (after approval)       ║
// ║                                                                   ║
// ║  The layout below is built from the supplied table:               ║
// ║     Approved By          | <lender>                               ║
// ║     Applied Loan Amount  | <snapshot> | Approved Loan Amount | ▢  ║
// ║     Applied Tenure       | <snapshot> | Tenure               | ▢  ║
// ║     Tentative EMI        | <snapshot> | EMI                  | ▢  ║
// ║                                                                   ║
// ║  TO CHANGE THE TABLE: edit ROWS below (and the ApprovalDetails    ║
// ║  type). Nothing else needs to change — the stored value is jsonb  ║
// ║  (epc_applications.approval_details), so adding/removing a row    ║
// ║  needs NO migration.                                              ║
// ╚══════════════════════════════════════════════════════════════════╝

import React from "react";
import type { LenderKey } from "@/components/LenderPickerModal";
import { rupeesInWords, yearsInWords } from "@/lib/numberToWords";

export const LENDER_LABEL: Record<string, string> = {
  creditfair: "Credit Fair",
  aerem:      "Aerem",
  solfin:     "Solfin",
};

// Persisted shape → epc_applications.approval_details (jsonb).
export type ApprovalDetails = {
  approved_by?: LenderKey | string | null;
  // "Applied" columns are snapshots of what the applicant asked for, captured
  // at approval time so the record stays true even if the application is
  // edited later.
  applied_loan_amount?: number | null;
  approved_loan_amount?: number | null;
  applied_tenure_years?: number | null;
  approved_tenure_years?: number | null;
  tentative_emi?: number | null;
  approved_emi?: number | null;
  // Captured at approval: the date the lender approved, and the ROI. ROI is a
  // FLAT rate for Credit Fair and a REDUCING rate for Solfin (label switches by
  // lender). jsonb — no migration.
  approval_date?: string | null; // YYYY-MM-DD
  roi?: number | string | null;  // string while typing (e.g. "9.75") so decimals aren't stripped
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s.length <= 10 ? s + "T00:00:00" : s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
export function roiLabelFor(lender: string | null | undefined): string {
  if (lender === "creditfair") return "Flat ROI (%)";
  if (lender === "solfin") return "Reducing ROI (%)";
  return "ROI (%)";
}

// Which rate the lender's ENTERED ROI represents; the other side is derived.
// Credit Fair enters FLAT; Solfin / Aerem (and anything else) enter REDUCING.
export function roiKind(lender: string | null | undefined): "flat" | "reducing" {
  return lender === "creditfair" ? "flat" : "reducing";
}

// Flat annual % → equivalent reducing-balance annual %, for principal P over
// `years` (solve the EMI equation numerically).
function flatToReducing(flatAnnual: number, P: number, years: number): number | null {
  if (!(flatAnnual > 0) || !(P > 0) || !(years > 0)) return null;
  const n = Math.round(years * 12);
  const emi = (P + P * (flatAnnual / 100) * years) / n;
  let lo = 0, hi = 1; // monthly rate bounds
  for (let i = 0; i < 100; i++) {
    const r = (lo + hi) / 2;
    const emiR = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    if (emiR > emi) hi = r; else lo = r;
  }
  return ((lo + hi) / 2) * 12 * 100;
}
// Reducing-balance annual % → equivalent flat annual %.
function reducingToFlat(reducingAnnual: number, P: number, years: number): number | null {
  if (!(reducingAnnual > 0) || !(P > 0) || !(years > 0)) return null;
  const n = Math.round(years * 12);
  const r = reducingAnnual / 100 / 12;
  const emi = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return ((emi * n - P) / (P * years)) * 100;
}
// The counterpart rate to show on the right, from the entered ROI + lender +
// approved amount/tenure. Null until those are present.
export function roiCounterpart(value: ApprovalDetails): number | null {
  const entered = value.roi == null || value.roi === "" ? null : Number(value.roi);
  if (entered == null || !Number.isFinite(entered)) return null;
  const P = Number(value.approved_loan_amount) || 0;
  const years = Number(value.approved_tenure_years) || 0;
  return roiKind(value.approved_by as string) === "flat"
    ? flatToReducing(entered, P, years)
    : reducingToFlat(entered, P, years);
}

// The editable rows: left = the applied/tentative snapshot, right = what the
// lender actually approved. Add/remove entries here to change the table.
type RowDef = {
  appliedLabel: string;
  appliedKey: keyof ApprovalDetails;
  approvedLabel: string;
  approvedKey: keyof ApprovalDetails;
  money: boolean;
  suffix?: string;
  // Spelled-out form shown under the entered value, so the admin can see at a
  // glance that what they typed is what they meant.
  words: (n: number) => string;
  // Only rows opting in render the spelled-out helper. Kept to the loan amount
  // — "Zero years" / "Zero Rupees Only" under Tenure and EMI added noise.
  showWords?: boolean;
};

const ROWS: RowDef[] = [
  {
    appliedLabel: "Applied Loan Amount",  appliedKey: "applied_loan_amount",
    approvedLabel: "Approved Loan Amount", approvedKey: "approved_loan_amount",
    money: true, words: rupeesInWords, showWords: true,
  },
  {
    appliedLabel: "Applied Tenure",       appliedKey: "applied_tenure_years",
    approvedLabel: "Tenure",              approvedKey: "approved_tenure_years",
    money: false, suffix: "years", words: yearsInWords,
  },
  {
    appliedLabel: "Tentative EMI",        appliedKey: "tentative_emi",
    approvedLabel: "EMI",                 approvedKey: "approved_emi",
    money: true, words: rupeesInWords,
  },
];

function fmt(v: number | null | undefined, money: boolean, suffix?: string): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const base = money ? "₹" + Math.round(n).toLocaleString("en-IN") : String(n);
  return suffix ? `${base} ${suffix}` : base;
}

type Props = {
  value: ApprovalDetails;
  // Omit onChange (or pass readOnly) to render the read-only View version.
  onChange?: (next: ApprovalDetails) => void;
  readOnly?: boolean;
};

export default function ApprovalDetailsTable({ value, onChange, readOnly }: Props) {
  const ro = readOnly || !onChange;
  const lender = value.approved_by ? (LENDER_LABEL[String(value.approved_by)] ?? String(value.approved_by)) : "—";

  function set(key: keyof ApprovalDetails, raw: string) {
    if (!onChange) return;
    const cleaned = raw.replace(/[^\d.]/g, "");
    const n = cleaned.trim() === "" ? null : Number(cleaned);
    onChange({ ...value, [key]: n !== null && Number.isFinite(n) ? n : null });
  }

  const inputCls =
    "w-full border border-[#cdeadd] rounded-[8px] px-3 py-2 text-[14px] " +
    "focus:border-[#185fa5] outline-none bg-white text-right";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px] border-collapse">
        <tbody>
          {/* Approved By — the lender chosen in the confirmation popup. */}
          <tr className="border-b border-[#e0f0e8]">
            <td className="py-5 pr-4 text-[14px] text-[#5a8a76] font-medium w-[26%]">Approved By</td>
            <td className="py-5 px-3 text-[17px] font-bold text-[#178a5c]" colSpan={3}>
              {lender}
            </td>
          </tr>

          {ROWS.map((row) => (
            <tr key={row.approvedKey} className="border-b border-[#e0f0e8]">
              <td className="py-5 pr-4 text-[14px] text-[#5a8a76] font-medium w-[26%]">
                {row.appliedLabel}
              </td>
              <td className="py-5 px-3 text-right text-[15px] font-semibold text-[#0f3d2e] w-[24%]">
                {fmt(value[row.appliedKey] as number | null, row.money, row.suffix)}
              </td>
              <td className="py-5 pl-6 pr-4 text-[14px] text-[#5a8a76] font-medium w-[26%]">
                {row.approvedLabel}
              </td>
              <td className="py-5 px-3 w-[24%]">
                {ro ? (
                  <div className="text-right font-semibold text-[#0f3d2e]">
                    {fmt(value[row.approvedKey] as number | null, row.money, row.suffix)}
                  </div>
                ) : (
                  <input
                    type="text"
                    inputMode="decimal"
                    className={inputCls}
                    placeholder="0"
                    value={value[row.approvedKey] == null ? "" : String(value[row.approvedKey])}
                    onChange={(e) => set(row.approvedKey, e.target.value)}
                  />
                )}
                {/* Spelled out, right under the box — bold + highlighted so
                    it reads as a check on what was typed. */}
                {(() => {
                  if (!row.showWords) return null;
                  const n = value[row.approvedKey];
                  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
                  return (
                    <p className="mt-2 text-right">
                      <span className="inline-block rounded-[6px] bg-[#f0faf5] border border-[#cdeadd] px-2.5 py-1 text-[12px] font-bold text-[#178a5c] leading-snug">
                        {row.words(Number(n))}
                      </span>
                    </p>
                  );
                })()}
              </td>
            </tr>
          ))}

          {/* Date of Approval — the date the lender approved (captured at approval). */}
          <tr className="border-b border-[#e0f0e8]">
            <td className="py-5 pr-4 text-[14px] text-[#5a8a76] font-medium w-[26%]">Date of Approval</td>
            <td className="py-5 px-3" colSpan={3}>
              {ro ? (
                <span className="text-[15px] font-semibold text-[#0f3d2e]">{fmtDate(value.approval_date)}</span>
              ) : (
                <input
                  type="date"
                  value={value.approval_date ?? ""}
                  onChange={(e) => onChange?.({ ...value, approval_date: e.target.value || null })}
                  className="w-48 border border-[#cdeadd] rounded-[8px] px-3 py-2 text-[14px] focus:border-[#185fa5] outline-none bg-white"
                />
              )}
            </td>
          </tr>

          {/* ROI — the lender enters one basis (Flat for Credit Fair, Reducing
              for Solfin/Aerem); the counterpart is auto-calculated on the right. */}
          <tr className="border-b border-[#e0f0e8]">
            <td className="py-5 pr-4 text-[14px] text-[#5a8a76] font-medium w-[26%]">
              {roiKind(value.approved_by as string) === "flat" ? "Flat ROI (%)" : "Reducing Balance ROI (%)"}
            </td>
            <td className="py-5 px-3 w-[24%]">
              {ro ? (
                <div className="text-right font-semibold text-[#0f3d2e]">{value.roi != null && value.roi !== "" ? `${value.roi}%` : "—"}</div>
              ) : (
                <div className="flex items-center justify-end gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={value.roi == null ? "" : String(value.roi)}
                    onChange={(e) => { let c = e.target.value.replace(/[^\d.]/g, ""); const i = c.indexOf("."); if (i !== -1) c = c.slice(0, i + 1) + c.slice(i + 1).replace(/\./g, ""); onChange?.({ ...value, roi: c === "" ? null : c }); }}
                    placeholder="0"
                    className="w-24 border border-[#cdeadd] rounded-[8px] px-3 py-2 text-[14px] text-right focus:border-[#185fa5] outline-none bg-white"
                  />
                  <span className="text-[14px] text-[#5a8a76]">%</span>
                </div>
              )}
            </td>
            <td className="py-5 pl-6 pr-4 text-[14px] text-[#5a8a76] font-medium w-[26%]">
              {roiKind(value.approved_by as string) === "flat" ? "Reducing Balance (%)" : "Flat ROI (%)"}
              <span className="block text-[11px] text-[#93a7b8] font-normal">auto-calculated</span>
            </td>
            <td className="py-5 px-3 w-[24%]">
              <div className="text-right font-semibold text-[#178a5c]">
                {(() => { const c = roiCounterpart(value); return c != null ? `${c.toFixed(2)}%` : "—"; })()}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
