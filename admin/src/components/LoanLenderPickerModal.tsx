"use client";

// Flexible lender picker for the loan View page:
//   - Doc Sent  → pick a lender not yet sent docs, or type-to-add a new one.
//   - Approve   → pick which lender approved (from those already sent docs).
//   - Reject    → pick which lender rejected + capture a reason.

import { useState } from "react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { slugifyLender } from "@/lib/loan-lenders";

export type PickerLender = { key: string; label: string };
const CUSTOM = "__custom__";

export default function LoanLenderPickerModal({
  open, title, subtitle, options, allowAdd, needReason, confirmLabel, tone = "blue", onClose, onConfirm,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  options: PickerLender[];
  allowAdd?: boolean;
  needReason?: boolean;
  confirmLabel?: string;
  tone?: "blue" | "green" | "red";
  onClose: () => void;
  onConfirm: (lender: PickerLender, reason?: string) => void | Promise<void>;
}) {
  const [sel, setSel] = useState("");
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const isCustom = sel === CUSTOM;
  const selectOptions = [
    ...options.map((o) => ({ value: o.key, label: o.label })),
    ...(allowAdd ? [{ value: CUSTOM, label: "+ Add a lender…" }] : []),
  ];
  const canConfirm =
    (isCustom ? custom.trim().length > 0 : !!sel) && (!needReason || reason.trim().length > 0);

  const btnVariant = tone === "red" ? "primary" : tone === "green" ? "grad" : "primary";

  function close() {
    if (busy) return;
    setSel(""); setCustom(""); setReason("");
    onClose();
  }

  async function submit() {
    if (!canConfirm) return;
    setBusy(true);
    try {
      const lender: PickerLender = isCustom
        ? { key: slugifyLender(custom), label: custom.trim() }
        : options.find((o) => o.key === sel) || { key: sel, label: sel };
      await onConfirm(lender, needReason ? reason.trim() : undefined);
      setSel(""); setCustom(""); setReason("");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={close}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-[18px] text-text">{title}</h3>
            {subtitle && <p className="text-[12px] text-text-mid mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="Close"
            className="text-[18px] text-text-muted hover:text-text leading-none disabled:opacity-40">×</button>
        </div>

        {selectOptions.length === 0 && !allowAdd ? (
          <p className="text-[13px] text-text-mid">No lenders available.</p>
        ) : (
          <Select
            label="Lender"
            placeholder="Select a lender…"
            options={selectOptions}
            value={sel}
            onChange={(e) => setSel(e.target.value)}
          />
        )}

        {isCustom && (
          <div className="mt-3">
            <label className="block text-[13px] font-medium text-text mb-1">New lender name</label>
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. HDFC"
              className="w-full rounded-input border border-line bg-white px-3 py-2 text-[14px] text-text focus:outline-none focus:ring-2 focus:ring-[#185fa5]/30"
            />
          </div>
        )}

        {needReason && (
          <div className="mt-4">
            <label className="block text-[13px] font-medium text-text mb-1">
              Reason for rejection <span className="text-red-600">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Record why this lender rejected the application…"
              className="w-full rounded-input border border-line bg-white px-3 py-2 text-[14px] text-text focus:outline-none focus:ring-2 focus:ring-red-200 resize-y"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="button" variant={btnVariant} onClick={submit} disabled={!canConfirm} loading={busy}>
            {confirmLabel || "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}
