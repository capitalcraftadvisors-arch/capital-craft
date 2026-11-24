"use client";

// Loan View · the "Abort application" pop-up: the reason is required.

import { useId } from "react";
import Modal from "@/components/ui/Modal";

export default function AbortModal({ busy, reason, onReason, onClose, onAbort }: {
  busy: boolean; reason: string; onReason: (v: string) => void; onClose: () => void; onAbort: (reason: string) => void;
}) {
  const titleId = useId();
  const reasonId = useId();
  return (
    <Modal onClose={onClose} busy={busy} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6" aria-labelledby={titleId}>
      <h3 id={titleId} className="font-semibold text-[18px] text-cc-ink">Abort application</h3>
      <p className="text-[12px] text-cc-muted mt-0.5">Cancels this application. It stays on record (not deleted) and can&apos;t be edited afterwards. Record the reason.</p>
      <label htmlFor={reasonId} className="block text-[13px] font-medium text-cc-ink mt-4 mb-1">Reason for abort <span className="text-red-600">*</span></label>
      <textarea
        id={reasonId}
        value={reason}
        onChange={(e) => onReason(e.target.value)}
        rows={3}
        placeholder="Why is this being aborted?"
        className="w-full rounded-input border border-red-200 bg-white px-3 py-2 text-[14px] text-cc-ink focus:outline-none focus:ring-2 focus:ring-red-200 resize-y"
      />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy}
          className="text-[13px] font-semibold px-3 py-2 rounded-[8px] border border-cc-line bg-white text-cc-ink hover:bg-cc-wash disabled:opacity-60">
          Cancel
        </button>
        <button type="button" disabled={busy || !reason.trim()}
          onClick={() => { const r = reason.trim(); if (!r) return; onAbort(r); }}
          className="text-[13px] font-semibold px-3 py-2 rounded-[8px] bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
          Abort application
        </button>
      </div>
    </Modal>
  );
}
