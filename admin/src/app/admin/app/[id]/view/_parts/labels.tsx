"use client";

// Loan View · the status labels, the loan-ID and approval-amount formatters,
// the header's icons and the status badge. (System / employment labels:
// lib/loan-labels.)

import { fmtRupeesExact } from "@/lib/money";
import { loanDisplayId } from "@/lib/loan-labels";
import type { Loan } from "./loan-docs";

// Loan applications have exactly one status — the lender outcome.
export const LOAN_STATUS_LABEL: Record<string, string> = {
  draft:        "Draft",
  submitted:    "Submitted",
  under_review: "Under Review",
  docs_sent:    "Docs Sent",
  on_hold:      "Hold",
  aborted:      "Aborted",
  approved:     "Approved by lender",
  rfd:          "Ready for Disbursement",
  rejected:     "Rejected by lender",
};

// "Put on hold" / "Resume" — a pause glyph (this page's own, not in ViewKit).
export const PAUSE = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 5v14M14 5v14" />
  </svg>
);
// "Insurance" — a shield.
export const SHIELD = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
// "Message EPC" — a chat bubble with text lines.
export const MSG_EPC = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
    <path d="M8.5 10.5h7M8.5 14h4.5" />
  </svg>
);

export function displayId(loan: Loan): string {
  return loanDisplayId(loan.id, loan.loan_display_id);
}
// Approval-details cell: money → ₹ exact (never rounded), tenure → "<n> years". Numbers only.
export function fmtApproval(v: number | null | undefined, money: boolean, suffix?: string): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const base = money ? fmtRupeesExact(n) : String(n);
  return suffix ? `${base} ${suffix}` : base;
}

// ── Status badge — the lender outcome, coloured. Names the deciding lender
// when we know it ("Approved by Aerem"), else falls back to the generic label.
export function StatusBadge({ status, lender }: { status: string | null | undefined; lender?: string | null }) {
  const s = status ?? "draft";
  const generic = LOAN_STATUS_LABEL[s] ?? s;
  const label =
    lender && s === "approved" ? `Approved by ${lender}` :
    lender && s === "rejected" ? `Rejected by ${lender}` :
    generic;
  const cls =
    s === "approved" ? "bg-[#e6f6ee] text-[#178a5c] border-[#cdeadd]" :
    s === "rejected" ? "bg-red-50 text-red-700 border-red-200" :
    s === "docs_sent" ? "bg-[#dceffb] text-[#185fa5] border-[#bfe0f5]" :
    s === "rfd" ? "bg-[#d6efe3] text-[#0f7a52] border-[#bfe0d3]" :
    s === "on_hold" ? "bg-[#fff2cc] text-[#8a6500] border-[#f3d9a4]" :
    s === "aborted" ? "bg-red-50 text-red-700 border-red-200" :
    s === "under_review" ? "bg-[#fef0d6] text-[#854f0b] border-[#f3d9a4]" :
                       "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={["shrink-0 inline-flex px-2.5 py-0.5 rounded-full border text-[12px] font-medium whitespace-nowrap", cls].join(" ")}>
      {label}
    </span>
  );
}
