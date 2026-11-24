"use client";

// Task Manager — the loan lender / decision pop-up shown on the board (docs sent, approve, reject), same modal the loan page uses.

import LoanLenderPickerModal, { type PickerLender } from "@/components/LoanLenderPickerModal";
import type { OpsCase } from "@/lib/ops-board";
import { lendersWithDocs, type LoanLenderRow } from "@/lib/loan-lenders";

export default function LenderPickerPopup({ picker, lenders, onClose, onDocsSent, onApprove, onReject }: {
  picker: { c: OpsCase; mode: "docsent" | "approve" | "reject"; rows: LoanLenderRow[] };
  lenders: PickerLender[];
  onClose: () => void;
  onDocsSent: (l: PickerLender) => Promise<void>;
  onApprove: (l: PickerLender) => void;
  onReject: (l: PickerLender, reason?: string, date?: string) => Promise<void>;
}) {
  const rows = picker.rows;
  const available: PickerLender[] = [
    ...lenders,
    ...rows.filter((r) => !lenders.some((d) => d.key === r.lender_key)).map((r) => ({ key: r.lender_key, label: r.lender_label })),
  ].filter((l) => !rows.some((r) => r.lender_key === l.key && r.docs_sent_at));
  const withDocsOpts: PickerLender[] = lendersWithDocs(rows).map((r) => ({ key: r.lender_key, label: r.lender_label }));
  const m = picker.mode;
  return (
    <LoanLenderPickerModal
      open
      title={m === "docsent" ? "Send documents to a lender" : m === "approve" ? "Approve application" : "Reject application"}
      subtitle={m === "docsent" ? `For ${picker.c.name}. Pick the lender you’re sending the documents to.` : m === "approve" ? `For ${picker.c.name}. Which lender approved? You’ll fill in the approval details next.` : `For ${picker.c.name}. Which lender rejected?`}
      options={m === "docsent" ? available : withDocsOpts}
      allowAdd={m === "docsent"}
      needReason={m === "reject"}
      needDate={m === "reject"}
      confirmLabel={m === "docsent" ? "Mark docs sent" : m === "approve" ? "Continue to details" : "Mark rejected"}
      tone={m === "docsent" ? "blue" : m === "approve" ? "green" : "red"}
      onClose={onClose}
      onConfirm={(l, reason, date) => (m === "docsent" ? onDocsSent(l) : m === "approve" ? onApprove(l) : onReject(l, reason, date))}
    />
  );
}
