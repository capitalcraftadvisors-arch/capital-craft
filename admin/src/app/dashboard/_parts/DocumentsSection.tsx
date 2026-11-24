"use client";

// Partner dashboard · Document pending (the profiles Capital Craft flagged, loan / insurance tabs).

import { useState } from "react";
import { NAVY } from "@/components/partner/PartnerShell";
import { borrower, type AppRow, type InsRow } from "./rows";

// ── Documents (first pass) ──────────────────────────────────────────────────────
// Document pending — the profiles Capital Craft has flagged (attention open) so
// the EPC can read the message, update the required documents/details and
// re-submit. Two tabs: Loan / Insurance, each with its own count.
export default function DocumentsSection({ loans, insRows, onOpenMessage }: {
  loans: AppRow[]; insRows: InsRow[];
  onOpenMessage: (kind: "loan" | "insurance", id: string) => void;
}) {
  const unseen = (r: { msg_epc_seen_at: string | null; attention_raised_at: string | null }) =>
    !r.msg_epc_seen_at || (!!r.attention_raised_at && r.msg_epc_seen_at < r.attention_raised_at);
  const loanPending = loans.filter((r) => r.attention_status === "open");
  const insPending = insRows.filter((r) => r.attention_status === "open");
  const [tab, setTab] = useState<"loan" | "insurance">(loanPending.length === 0 && insPending.length > 0 ? "insurance" : "loan");

  const items = tab === "loan"
    ? loanPending.map((r) => ({ id: r.id, kind: "loan" as const, name: borrower(r), ref: r.loan_display_id, isNew: unseen(r) }))
    : insPending.map((r) => ({ id: r.id, kind: "insurance" as const, name: r.aadhaar_name || "—", ref: r.insurance_display_id, isNew: unseen(r) }));

  return (
    <div className="max-w-[860px] flex flex-col gap-5">
      <div>
        <h2 className="font-display text-[22px] font-bold text-[#0f3d2e]">Document pending</h2>
      </div>

      {/* Loan / Insurance tabs, each with its pending count */}
      <div className="flex gap-2">
        {([["loan", "Loan", loanPending.length], ["insurance", "Insurance", insPending.length]] as const).map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)}
            className={["px-4 py-2 rounded-xl text-[13px] font-semibold border transition-colors flex items-center gap-2", tab === k ? "text-white border-[#14235c]" : "bg-white text-text-mid border-line hover:border-[#14235c]"].join(" ")}
            style={tab === k ? { background: NAVY } : undefined}>
            {label}
            {n > 0 && <span className={["inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none", tab === k ? "bg-white/20 text-white" : "bg-[#fde8e8] text-[#dc2626]"].join(" ")}>{n}</span>}
          </button>
        ))}
      </div>

      {/* List */}
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-line px-6 py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-[#e6f6ee] grid place-items-center mx-auto mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#178a5c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div className="text-[14px] font-semibold text-[#0f3d2e]">You&apos;re all caught up</div>
          <div className="text-[12.5px] text-text-muted mt-1">No {tab === "loan" ? "loan" : "insurance"} profiles need your attention right now.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((it) => (
            <button key={it.id} onClick={() => onOpenMessage(it.kind, it.id)}
              className="group text-left bg-white rounded-2xl border border-line hover:border-[#1e3a8a]/40 hover:shadow-md transition-all px-5 py-4 flex items-center gap-4">
              <span className="relative w-11 h-11 rounded-xl grid place-items-center shrink-0 bg-[#eef3fc] text-[#1e3a8a]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                {it.isNew && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#dc2626] border-2 border-white" aria-label="New" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-text truncate">{it.name}</div>
                <div className="text-[12px] text-text-muted mt-0.5">
                  {it.ref && <span className="font-mono text-[#185fa5]">{it.ref}</span>}{it.ref ? " · " : ""}
                  Capital Craft sent a message{it.isNew ? <span className="text-[#dc2626] font-semibold"> · New</span> : ""}
                </div>
              </div>
              <span className="shrink-0 flex items-center gap-1 text-[12.5px] font-semibold text-[#1e3a8a] group-hover:gap-2 transition-all">
                Open <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
