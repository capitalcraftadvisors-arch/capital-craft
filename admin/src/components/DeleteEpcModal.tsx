"use client";

// Type-to-confirm modal for permanently deleting an EPC profile.
//
// Displays the target's display_id, contact name, and mobile so the
// admin sees exactly who they're about to nuke. The Delete button is
// disabled until the admin types the exact word "DELETE" (case-sensitive)
// into the confirmation input — matches the GitHub repo-delete pattern.
//
// On confirm, POSTs to /api/admin/delete-epc with the admin's Bearer
// token. Success → onDeleted() (parent typically navigates back to list).
// Error → surfaced inline; modal stays open so admin can retry or cancel.

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { getToken } from "@/lib/auth";

type Props = {
  open: boolean;
  onClose: () => void;
  onDeleted: (payload: { id: string; display_id: string | null; contact_name: string | null }) => void;
  businessId: string;
  displayId: string | null;
  contactName: string | null;
  contactMobile: string | null;
};

const CONFIRM_WORD = "DELETE";

export default function DeleteEpcModal({
  open, onClose, onDeleted,
  businessId, displayId, contactName, contactMobile,
}: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setTyped(""); setError(null); }
  }, [open]);

  if (!open) return null;

  const canDelete = typed === CONFIRM_WORD && !busy;

  async function doDelete() {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch("/api/admin/delete-epc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ businessId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Delete failed (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      onDeleted(data.deleted);
    } catch (e) {
      setError((e as Error)?.message || "Network error.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-white rounded-card w-full max-w-[520px] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — red-tinted to signal destructive action. */}
        <div className="bg-red-50 border-b border-red-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <h2 className="font-display font-bold text-[17px] text-red-700">
              Delete profile permanently
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p className="text-[13px] text-text">
            You&rsquo;re about to permanently delete this EPC and everything
            attached to it. This cannot be undone.
          </p>

          {/* Target identity card */}
          <div className="rounded-input border border-line bg-bg-tint p-4 text-[13px] space-y-1.5">
            <div className="flex gap-3">
              <span className="text-text-muted min-w-[80px]">Display ID</span>
              <span className="font-mono font-semibold">{displayId ?? "—"}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-text-muted min-w-[80px]">Name</span>
              <span className="font-semibold">{contactName || "(no name)"}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-text-muted min-w-[80px]">Mobile</span>
              <span>+91 {contactMobile || "—"}</span>
            </div>
          </div>

          {/* What will be deleted */}
          <div className="text-[12px] text-text-muted">
            <p className="font-semibold text-text mb-1">What gets deleted:</p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li>The EPC business row</li>
              <li>All uploaded documents (business, stakeholders, cheque, GST R3B, office photos)</li>
              <li>All loan applications and their attached documents</li>
              <li>All lender status ticks (CreditFair / Aerem / Solfin)</li>
              <li>All admin comments and activity-log entries</li>
              <li>Storage folder in Google Cloud Storage</li>
            </ul>
          </div>

          {/* Type-to-confirm */}
          <div>
            <label className="block text-[12px] text-text-muted mb-1.5">
              Type <span className="font-mono font-bold text-red-700">{CONFIRM_WORD}</span> to confirm.
            </label>
            <input
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

        {/* Footer */}
        <div className="border-t border-line px-6 py-4 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
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
            {busy ? "Deleting…" : "Delete profile permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
