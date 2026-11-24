"use client";

// Type-to-confirm pop-up for permanently deleting a record (EPC, loan
// application, insurance application, lead). It shows who/what is about to go,
// and the Delete button stays disabled until the admin types "DELETE" exactly
// (case-sensitive) — the GitHub repo-delete pattern. Every delete asks first.
//
// On confirm it POSTs `body` to the admin-only `endpoint` with the admin's
// Bearer token. Success → onDeleted(data.deleted) (the parent usually leaves
// the page). Error → shown inline; the pop-up stays open to retry or cancel.
// Closing is blocked while the delete runs.

import { useEffect, useId, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { authHeaders } from "@/lib/auth";

const CONFIRM_WORD = "DELETE";

type Props<T> = {
  open: boolean;
  onClose: () => void;
  onDeleted: (payload: T) => void;
  /** The admin delete route (e.g. "/api/admin/delete-epc") and the JSON it takes. */
  endpoint: string;
  body: Record<string, unknown>;
  /** Red header, and the button label (busy → "Deleting…"). */
  title: string;
  confirmLabel: string;
  /** The warning line under the header. */
  message: string;
  /** The record, as label → value rows (value classes e.g. "font-mono font-semibold"). */
  rows: { label: string; value: ReactNode; className?: string }[];
  /** The "What gets deleted:" list — left out → no list. */
  deletes?: string[];
  /** Opens above another pop-up (z-[60]). */
  stacked?: boolean;
  /** Narrower box (480px) and row labels (70px). */
  narrow?: boolean;
};

export default function ConfirmDeleteModal<T = { id: string }>({
  open, onClose, onDeleted, endpoint, body,
  title, confirmLabel, message, rows, deletes, stacked, narrow,
}: Props<T>) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId(); // ids that tie the heading and label to the pop-up and its field

  useEffect(() => {
    if (open) { setTyped(""); setError(null); }
    else setBusy(false); // ready again for the next open
  }, [open]);

  if (!open) return null;

  const canDelete = typed === CONFIRM_WORD && !busy;

  async function doDelete() {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Delete failed (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      // busy stays on (no second Delete while the parent leaves the page); it resets once closed.
      onDeleted(data.deleted);
    } catch (e) {
      setError((e as Error)?.message || "Network error.");
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      busy={busy}
      overlayClassName={stacked ? "fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" : undefined}
      className={"bg-white rounded-card w-full " + (narrow ? "max-w-[480px]" : "max-w-[520px]") + " shadow-2xl overflow-hidden"}
      aria-labelledby={`${uid}-title`}
    >
      {/* Header — red-tinted to signal a destructive action. */}
      <div className="bg-red-50 border-b border-red-100 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <h2 id={`${uid}-title`} className="font-display font-bold text-[17px] text-red-700">{title}</h2>
        </div>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-[13px] text-text">{message}</p>

        {/* Target identity card */}
        <div className="rounded-input border border-line bg-bg-tint p-4 text-[13px] space-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-3">
              <span className={"text-text-muted " + (narrow ? "min-w-[70px]" : "min-w-[80px]")}>{r.label}</span>
              <span className={r.className}>{r.value}</span>
            </div>
          ))}
        </div>

        {deletes && (
          <div className="text-[12px] text-text-muted">
            <p className="font-semibold text-text mb-1">What gets deleted:</p>
            <ul className="list-disc pl-5 space-y-0.5">
              {deletes.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </div>
        )}

        {/* Type-to-confirm */}
        <div>
          <label htmlFor={`${uid}-typed`} className="block text-[12px] text-text-muted mb-1.5">
            Type <span className="font-mono font-bold text-red-700">{CONFIRM_WORD}</span> to confirm.
          </label>
          <input
            id={`${uid}-typed`}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full border border-line rounded-input px-3.5 py-2.5 text-[14px] font-mono focus:border-red-500 outline-none bg-white"
            placeholder={CONFIRM_WORD}
          />
        </div>

        {error && (
          <div className="rounded-input border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-line px-6 py-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <button
          type="button"
          onClick={doDelete}
          disabled={!canDelete}
          className={[
            "px-4 py-2 rounded text-[13px] font-semibold transition-colors",
            canDelete
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-red-100 text-red-300 cursor-not-allowed",
          ].join(" ")}
        >
          {busy ? "Deleting…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
