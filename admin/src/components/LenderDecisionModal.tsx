"use client";

// Lender approve / reject popup for a loan application.
//
// Same shell + controls as LenderPickerModal (the EPC ZIP picker), so the two
// popups look and behave identically. Two steps in one dialog, per spec:
//   a. "Which lender has approved/rejected?" — dropdown of the 3 lenders
//   b. "Are you sure you want to approve/reject?" — explicit confirmation
// The confirm button stays disabled until BOTH a lender is chosen and the
// confirmation is ticked.
//
// Approve → the caller routes on to the approval-details screen.
// Reject   → the caller writes the rejection straight away (no table).

import { useState } from "react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import type { LenderKey } from "@/components/LenderPickerModal";

const LENDER_OPTIONS: { value: LenderKey; label: string }[] = [
  { value: "aerem",      label: "Aerem" },
  { value: "solfin",     label: "Solfin" },
  { value: "creditfair", label: "CreditFair" },
];

type Props = {
  open: boolean;
  kind: "approve" | "reject";
  applicantName?: string | null;
  onClose: () => void;
  onConfirm: (lender: LenderKey, reason?: string) => void | Promise<void>;
};

export default function LenderDecisionModal({ open, kind, applicantName, onClose, onConfirm }: Props) {
  const [lender, setLender] = useState<LenderKey | "">("");
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const approve = kind === "approve";
  const needsReason = !approve && !reason.trim();

  function close() {
    if (busy) return;
    setLender("");
    setReason("");
    setSure(false);
    onClose();
  }

  async function submit() {
    if (!lender || !sure || needsReason) return;
    setBusy(true);
    try {
      await onConfirm(lender as LenderKey, approve ? undefined : reason.trim());
      setLender("");
      setReason("");
      setSure(false);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-lg shadow-lg p-6"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-[18px] text-text">
              {approve ? "Approve application" : "Reject application"}
            </h3>
            <p className="text-[12px] text-text-mid mt-0.5">
              {applicantName ? `For ${applicantName}. ` : ""}
              {approve
                ? "Pick the lender that approved, then confirm. You'll fill in the approval details next."
                : "Pick the lender that rejected, then confirm."}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="text-[18px] text-text-muted hover:text-text leading-none disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <Select
          label={approve ? "Which lender has approved?" : "Which lender has rejected?"}
          placeholder="Select a lender…"
          options={LENDER_OPTIONS}
          value={lender}
          onChange={(e) => { setLender(e.target.value as LenderKey | ""); setSure(false); }}
        />

        {/* Rejection reason — required, recorded on the application + log. */}
        {!approve && (
          <div className="mt-4">
            <label className="block text-[13px] font-medium text-text mb-1">
              Reason for rejection <span className="text-red-600">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setSure(false); }}
              rows={3}
              placeholder="Record why the lender rejected this application…"
              className="w-full rounded-input border border-line bg-white px-3 py-2 text-[14px] text-text focus:outline-none focus:ring-2 focus:ring-red-200 resize-y"
            />
          </div>
        )}

        {/* Explicit confirmation — the second half of the popup. */}
        <label
          className={[
            "mt-4 flex items-start gap-2.5 rounded-input border p-3 cursor-pointer select-none",
            approve ? "border-[#cdeadd] bg-[#f0faf5]" : "border-red-200 bg-red-50",
          ].join(" ")}
        >
          <input
            type="checkbox"
            checked={sure}
            disabled={!lender || needsReason}
            onChange={(e) => setSure(e.target.checked)}
            className={["mt-0.5 h-4 w-4 shrink-0", approve ? "accent-[#178a5c]" : "accent-[#dc2626]"].join(" ")}
          />
          <span className={["text-[13px] font-medium", approve ? "text-[#0f3d2e]" : "text-red-800"].join(" ")}>
            {approve ? "Are you sure you want to approve?" : "Are you sure you want to reject?"}
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={submit}
            disabled={!lender || !sure || needsReason}
            loading={busy}
          >
            {approve ? "Yes, continue" : "Yes, reject"}
          </Button>
        </div>
      </div>
    </div>
  );
}
