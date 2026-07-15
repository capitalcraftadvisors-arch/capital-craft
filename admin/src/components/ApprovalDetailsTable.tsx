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

export const LENDER_LABEL: Record<string, string> = {
  creditfair: "CreditFair",
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
};

// The editable rows: left = the applied/tentative snapshot, right = what the
// lender actually approved. Add/remove entries here to change the table.
type RowDef = {
  appliedLabel: string;
  appliedKey: keyof ApprovalDetails;
  approvedLabel: string;
  approvedKey: keyof ApprovalDetails;
  money: boolean;
  suffix?: string;
};

const ROWS: RowDef[] = [
  {
    appliedLabel: "Applied Loan Amount",  appliedKey: "applied_loan_amount",
    approvedLabel: "Approved Loan Amount", approvedKey: "approved_loan_amount",
    money: true,
  },
  {
    appliedLabel: "Applied Tenure",       appliedKey: "applied_tenure_years",
    approvedLabel: "Tenure",              approvedKey: "approved_tenure_years",
    money: false, suffix: "years",
  },
  {
    appliedLabel: "Tentative EMI",        appliedKey: "tentative_emi",
    approvedLabel: "EMI",                 approvedKey: "approved_emi",
    money: true,
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
            <td className="py-2.5 pr-3 text-[13px] text-[#5a8a76] font-medium w-[26%]">Approved By</td>
            <td className="py-2.5 px-2 text-[15px] font-semibold text-[#178a5c]" colSpan={3}>
              {lender}
            </td>
          </tr>

          {ROWS.map((row) => (
            <tr key={row.approvedKey} className="border-b border-[#e0f0e8]">
              <td className="py-2.5 pr-3 text-[13px] text-[#5a8a76] font-medium w-[26%]">
                {row.appliedLabel}
              </td>
              <td className="py-2.5 px-2 text-right font-medium text-[#0f3d2e] w-[24%]">
                {fmt(value[row.appliedKey] as number | null, row.money, row.suffix)}
              </td>
              <td className="py-2.5 pl-4 pr-3 text-[13px] text-[#5a8a76] font-medium w-[26%]">
                {row.approvedLabel}
              </td>
              <td className="py-2.5 px-2 w-[24%]">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
