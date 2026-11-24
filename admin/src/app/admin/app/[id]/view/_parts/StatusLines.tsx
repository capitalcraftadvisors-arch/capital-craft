"use client";

// Loan View · the header's status lines: the last action, an abort, or ONE
// rejection reason (per-lender reasons de-duplicated; hidden once a lender approves).

import type { LoanLenderRow } from "@/lib/loan-lenders";
import type { Loan } from "./loan-docs";

export default function StatusLines({ statusMsg, rejected, aborted, loan, lenderRows }: {
  statusMsg: string | null; rejected: boolean; aborted: boolean; loan: Loan; lenderRows: LoanLenderRow[];
}) {
  const lines: Array<{ key: string; text: string; red?: boolean }> = [];
  if (statusMsg && !rejected) lines.push({ key: "msg", text: statusMsg });
  if (aborted && loan.abort_reason) lines.push({ key: "abort", text: `Aborted — ${loan.abort_reason}`, red: true });
  const lenderRej = loan.status !== "approved"
    ? lenderRows.filter((r) => r.rejected_at && (r.rejection_reason ?? "").trim())
    : [];
  if (lenderRej.length > 0) {
    const seen = new Set<string>();
    lenderRej.forEach((r) => {
      const k = (r.rejection_reason ?? "").trim().toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      lines.push({ key: r.id, text: `Rejection reason${r.lender_label ? ` (${r.lender_label})` : ""}: ${r.rejection_reason}`, red: true });
    });
  } else if (rejected && loan.rejection_reason) {
    lines.push({ key: "rej", text: `Rejection reason: ${loan.rejection_reason}`, red: true });
  }
  if (!lines.length) return null;
  return (
    <div className="w-full px-5 sm:px-8 pb-3 -mt-1 space-y-0.5">
      {lines.map((l) => (
        <div key={l.key} className={["text-[12.5px]", l.red ? "font-medium text-red-700" : "text-[#7a958a]"].join(" ")}>{l.text}</div>
      ))}
    </div>
  );
}
