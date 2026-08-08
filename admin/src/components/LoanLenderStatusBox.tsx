"use client";

// Per-application lender status box on the loan View page: one row per lender,
// columns Docs sent / Approved / Rejected, each with its own timestamp. Mirrors
// the design of the EPC lender-status box.

import type { LoanLenderRow } from "@/lib/loan-lenders";

function fmt(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return (
    d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) +
    " " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
  );
}

function Cell({ at, color }: { at: string | null; color: string }) {
  return (
    <td className="text-center px-3 py-2.5 align-top">
      {at ? (
        <div>
          <span style={{ color }} className="font-bold">✓</span>
          <div className="text-[10px] text-[#5a8a76] mt-0.5">{fmt(at)}</div>
        </div>
      ) : (
        <span className="text-[#c7ddd2]">—</span>
      )}
    </td>
  );
}

export default function LoanLenderStatusBox({ rows }: { rows: LoanLenderRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-[12px] border border-[#cdeadd] bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#e0f0e8] bg-[#f0faf5] text-[13px] font-bold text-[#0f3d2e]">
        Lender status
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-[11px] uppercase tracking-wide text-[#5a8a76] border-b border-[#eef1f4]">
            <tr>
              <th className="text-left font-medium px-4 py-2">Lender</th>
              <th className="text-center font-medium px-3 py-2">Docs sent</th>
              <th className="text-center font-medium px-3 py-2">Approved</th>
              <th className="text-center font-medium px-3 py-2">Rejected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[#f0f4f2] last:border-0">
                <td className="text-left px-4 py-2.5 font-semibold text-[#0f3d2e]">{r.lender_label}</td>
                <Cell at={r.docs_sent_at} color="#185fa5" />
                <Cell at={r.approved_at} color="#0f7a52" />
                <Cell at={r.rejected_at} color="#9f1239" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
