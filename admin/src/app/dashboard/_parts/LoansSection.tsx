"use client";

// Partner dashboard · the Loans section (search, filter chips, the 9-column table).

import { useState } from "react";
import { NAVY_ACCENT } from "@/components/partner/PartnerShell";
import { deadlineState, DEADLINE_PILL } from "@/lib/disbursement";
import { fmtDate } from "@/lib/dates";
import { fmtRupees } from "@/lib/money";
import { STAGE4_LABEL, STAGE4_PILL, appliedAmount, borrower, canEpcEdit, capacity, fmtDateTimeOrBlank, stage4, statusChangedAt, type AppRow, type FilterKey } from "./rows";
import SearchChips from "./SearchChips";

// ── Loans ─────────────────────────────────────────────────────────────────────
export default function LoansSection({ loans, loading, canLoan, readOnly, initial = "all", onOpenCase, onApply, onEdit, onTranche }: {
  loans: AppRow[]; loading: boolean; canLoan: boolean; readOnly: boolean; initial?: FilterKey;
  onOpenCase: (r: AppRow) => void; onApply: () => void; onEdit: (r: AppRow) => void; onTranche: (r: AppRow) => void;
}) {
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<FilterKey>(initial);
  // Approved file with the 1st tranche released but the 2nd still pending.
  const isTranchePending = (r: AppRow) => stage4(r) === "approved" && r.first_disbursement_amount != null && r.second_disbursement_amount == null;
  const matchesFilter = (r: AppRow) => sf === "all" ? true : sf === "tranche_pending" ? isTranchePending(r) : stage4(r) === sf;
  const count = (k: FilterKey) => (k === "all" ? loans.length : k === "tranche_pending" ? loans.filter(isTranchePending).length : loans.filter((r) => stage4(r) === k).length);
  const needle = q.trim().toLowerCase();
  const filtered = loans.filter((r) => {
    if (!matchesFilter(r)) return false;
    if (needle && !(borrower(r).toLowerCase().includes(needle) || (r.loan_display_id || "").toLowerCase().includes(needle))) return false;
    return true;
  });
  const CHIPS: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" }, { key: "under_review", label: "Under review" },
    { key: "updated", label: "Updated" }, { key: "approved", label: "Approved" },
    { key: "tranche_pending", label: "2nd tranche pending" }, { key: "rejected", label: "Rejected" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="font-display text-[20px] font-bold text-[#0f3d2e]">Your loan applications</h2></div>
        {canLoan && <button onClick={onApply} className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY_ACCENT }}>Apply for loan</button>}
      </div>

      {/* Search + status filters */}
      <SearchChips q={q} onQ={setQ} placeholder="Search by borrower or loan ID…" chips={CHIPS} active={sf} onPick={setSf} count={count} />

      <div className="bg-white rounded-2xl border border-line overflow-x-auto">
        <table className="w-full text-[13.5px] min-w-[820px]">
          <thead className="bg-bg-soft border-b border-line">
            <tr className="text-left text-text-muted text-[12px]">
              <th className="px-4 py-3 font-medium">Borrower</th><th className="px-3 py-3 font-medium">Plant capacity</th><th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Loan amount</th><th className="px-3 py-3 font-medium">Loan approved</th><th className="px-3 py-3 font-medium">1st tranche</th>
              <th className="px-3 py-3 font-medium">2nd tranche</th><th className="px-3 py-3 font-medium">Days remaining</th><th className="px-3 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={9} className="px-5 py-8 text-center text-text-muted">Loading…</td></tr>
              : loans.length === 0 ? <tr><td colSpan={9} className="px-5 py-12 text-center text-text-muted">No applications yet. Click <span className="text-text font-semibold">Apply for loan</span> to start one.</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={9} className="px-5 py-12 text-center text-text-muted">No applications match your search or filter.</td></tr>
              : filtered.map((r) => {
                const stg = stage4(r); const approved = stg === "approved"; const rejected = stg === "rejected"; const changedAt = statusChangedAt(r);
                return (
                  <tr key={r.id} onClick={() => onOpenCase(r)} className="border-b border-line hover:bg-[#f0faf5] cursor-pointer">
                    <td className="px-4 py-3.5 align-top">
                      <div className="flex items-center gap-1.5">{r.attention_status === "open" && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title="Capital Craft messaged you" />}<span className="font-semibold text-text">{borrower(r)}</span></div>
                      {r.loan_display_id && <div className="text-[11px] font-mono text-[#185fa5] mt-0.5">{r.loan_display_id}</div>}
                      <div className="text-[10.5px] text-text-muted mt-0.5">Created {fmtDateTimeOrBlank(r.created_at)}</div>
                    </td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">{capacity(r)}</td>
                    <td className="px-3 py-3.5 align-top"><span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold ${STAGE4_PILL[stg]}`}>{STAGE4_LABEL[stg]}</span>{changedAt && <div className="text-[10.5px] text-text-muted mt-1 whitespace-nowrap">{fmtDateTimeOrBlank(changedAt)}</div>}</td>
                    <td className="px-3 py-3.5 align-top font-semibold text-[#0f3d2e] whitespace-nowrap">{appliedAmount(r)}</td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">{approved && r.sanctioned_amount != null ? <span className="font-semibold text-[#178a5c]">{fmtRupees(r.sanctioned_amount)}</span> : <span className="text-text-muted">—</span>}</td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">{r.first_disbursement_amount != null ? <><div className="font-semibold text-[#0f3d2e]">{fmtRupees(r.first_disbursement_amount)}</div><div className="text-[10.5px] text-text-muted">{fmtDate(r.first_disbursement_date)}</div></> : <span className="text-text-muted">—</span>}</td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">{r.second_disbursement_amount != null ? <><div className="font-semibold text-[#0f3d2e]">{fmtRupees(r.second_disbursement_amount)}</div><div className="text-[10.5px] text-text-muted">{fmtDate(r.second_disbursement_date)}</div></> : approved && r.first_disbursement_amount != null ? <span className="text-[11px] font-semibold text-amber-700">Pending</span> : <span className="text-text-muted">—</span>}</td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">{!approved ? <span className="text-text-muted">—</span> : (() => { const dl = deadlineState(r.first_disbursement_date, r.second_disbursement_amount != null); return <span className={["inline-block px-2 py-1 rounded-[6px] text-[11px] font-semibold whitespace-nowrap", DEADLINE_PILL[dl.tone]].join(" ")}>{dl.label}</span>; })()}</td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">
                      {approved && !readOnly ? <button onClick={(e) => { e.stopPropagation(); onTranche(r); }} className="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold" style={{ background: NAVY_ACCENT }}>2nd tranche</button>
                        : rejected || readOnly ? <button onClick={(e) => { e.stopPropagation(); onOpenCase(r); }} className="px-3 py-1.5 rounded-lg border border-line text-[12px] font-semibold text-text-mid">View</button>
                        : canEpcEdit(r) ? <button onClick={(e) => { e.stopPropagation(); onEdit(r); }} className="px-4 py-1.5 rounded-lg border border-[#1e3a8a] text-[#1e3a8a] text-[12px] font-semibold hover:bg-[#1e3a8a]/[0.06]">Edit</button>
                        : <span className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg border border-line text-text-muted text-[12px] font-semibold cursor-not-allowed select-none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>Edit</span>}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
