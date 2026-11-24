"use client";

// EPC View · the lender list on the Docs Sent / Lender approval stages: one row
// per lender with its name, when, and state.

import { fmtDate, fmtDateTime } from "@/lib/dates";

export type LenderRow = {
  lender: string; docs_given: boolean; approved: boolean; rejected?: boolean;
  docs_given_at?: string | null; approved_at?: string | null; rejected_at?: string | null;
};

export default function LenderLines({ keys, lender, lenderLabel }: { keys: string[]; lender: LenderRow[]; lenderLabel: (k: string) => string }) {
  const lenderStateOf = (key: string) => {
    const l = lender.find((x) => x.lender === key);
    return l ? (l.rejected ? "rejected" : l.approved ? "approved" : l.docs_given ? "docs" : "none") : "none";
  };
  return (
    <ul className="divide-y divide-[#f1f5f3] max-w-[640px]">
      {keys.map((key) => {
        const l = lender.find((x) => x.lender === key);
        const when = l?.approved ? (l.approved_at ? fmtDate(l.approved_at) : null)
          : l?.rejected ? (l.rejected_at ? fmtDateTime(l.rejected_at) : null)
          : l?.docs_given && l.docs_given_at ? fmtDateTime(l.docs_given_at) : null;
        return (
          <li key={key} className="py-2.5 flex items-center gap-3 text-[14px]">
            <span className="flex-1 min-w-0 font-semibold text-[#0f3d2e] truncate">{lenderLabel(key)}</span>
            {when && <span className="text-[12px] text-[#7a958a] whitespace-nowrap">{when}</span>}
            <LenderStatePill state={lenderStateOf(key)} />
          </li>
        );
      })}
    </ul>
  );
}

function LenderStatePill({ state }: { state: "approved" | "docs" | "none" | "rejected" }) {
  if (state === "rejected") {
    return <span className="text-[13px] text-[#dc2626] font-semibold inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#dc2626]" /> rejected
    </span>;
  }
  if (state === "approved") {
    return <span className="text-[13px] text-[#178a5c] font-semibold inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#178a5c]" /> approved
    </span>;
  }
  if (state === "docs") {
    return <span className="text-[13px] text-[#854f0b] font-medium inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#ef9f27]" /> docs sent
    </span>;
  }
  return <span className="text-[13px] text-[#8ab3a1]">not sent</span>;
}
