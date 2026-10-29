"use client";
import { fmtDate } from "@/lib/dates";

// Per-application lender list on the loan View page's Lender tab: one row per
// lender — docs-sent date, the decision as a pill (with its date), and the
// rejection reason on one line.

import type { LoanLenderRow } from "@/lib/loan-lenders";

export default function LoanLenderStatusBox({ rows }: { rows: LoanLenderRow[] }) {
  if (!rows.length) return null;
  return (
    <ul className="divide-y divide-[#eef3f1]">
      {rows.map((r) => {
        const pill = r.approved_at
          ? { text: `Approved ${fmtDate(r.approved_at)}`, cls: "bg-[#e6f6ee] text-[#178a5c]" }
          : r.rejected_at
          ? { text: `Rejected ${fmtDate(r.rejected_at)}`, cls: "bg-red-50 text-red-700" }
          : r.docs_sent_at
          ? { text: "Waiting", cls: "bg-[#fef0d6] text-[#854f0b]" }
          : null;
        return (
          <li key={r.id} className="py-2.5">
            <div className="flex items-center gap-3 text-[13px]">
              <span className="flex-1 min-w-0 font-semibold text-[#0f3d2e] truncate">{r.lender_label}</span>
              {r.docs_sent_at && <span className="shrink-0 text-[12px] text-[#5a8a76]">Sent {fmtDate(r.docs_sent_at)}</span>}
              {pill && <span className={["shrink-0 text-[12px] font-semibold px-2 py-0.5 rounded-[6px]", pill.cls].join(" ")}>{pill.text}</span>}
            </div>
            {r.rejected_at && r.rejection_reason && (
              <div className="text-[12px] text-red-700 mt-0.5">{r.rejection_reason}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
