"use client";

// EPC View · the "Reject this EPC" pop-up: pick a reason (or type one) before rejecting.

import Modal from "@/components/ui/Modal";

// Reasons offered when an admin rejects an EPC (last option = free text).
const EPC_REJECT_REASONS = [
  "Incomplete documents",
  "Poor / unreadable document quality",
  "Invalid or mismatched GST details",
  "Ineligible business / outside service area",
  "Duplicate registration",
  "Failed verification",
  "Unresponsive / no follow-up",
  "Other",
];

export default function RejectEpcModal({ busy, reason, onReason, other, onOther, onClose, onReject }: {
  busy: boolean; reason: string; onReason: (v: string) => void; other: string; onOther: (v: string) => void;
  onClose: () => void; onReject: (reason: string) => void;
}) {
  return (
    <Modal onClose={onClose} busy={busy} className="w-full max-w-md bg-white rounded-[12px] shadow-lg p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-[17px] font-bold text-[#0f3d2e]">Reject this EPC</h3>
        <button type="button" onClick={onClose} disabled={busy} className="text-[18px] text-text-muted hover:text-text leading-none p-1 disabled:opacity-60">✕</button>
      </div>
      <label className="block text-[13px] font-medium text-text-mid">Reason for rejection
        <select value={reason} onChange={(e) => onReason(e.target.value)}
          className="mt-1 w-full rounded-input border border-line bg-white px-3 py-2.5 text-[14px] outline-none focus:border-blue">
          <option value="">Select a reason…</option>
          {EPC_REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      {reason === "Other" && (
        <textarea value={other} onChange={(e) => onOther(e.target.value)} rows={3} autoFocus placeholder="Type the reason…"
          className="mt-2 w-full rounded-input border border-line px-3 py-2 text-[13px] outline-none focus:border-blue resize-none" />
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg border border-line text-[13px] text-text-mid disabled:opacity-60">Cancel</button>
        <button type="button" disabled={busy || !reason || (reason === "Other" && !other.trim())}
          onClick={() => onReject(reason === "Other" ? other.trim() : reason)}
          className="px-5 py-2 rounded-lg bg-red-600 text-white text-[13px] font-semibold hover:bg-red-700 disabled:opacity-60">{busy ? "Rejecting…" : "Reject EPC"}</button>
      </div>
    </Modal>
  );
}
