"use client";

// Admin EPC page · the bits the Members and References editors share: the row
// text box style, the open / saving / error state with its Save, and the
// Save / Cancel row.

import { useState } from "react";

// ── Shared by the Members + References editors ───────────────────────────
// A text box inside an editor row.
export const FIELD = "border border-line rounded px-2 py-1.5 text-[13px] focus:border-blue outline-none bg-white";

// The editor's open / saving / error state, and its Save: on success the
// editor closes; on failure the error shows under it.
export function useSectionSave() {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function commit(write: () => Promise<void>) {
    setSaving(true);
    try {
      await write();
      setEditing(false);
      setError(null);
    } catch (e) {
      setError((e as Error)?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }
  return { editing, setEditing, saving, error, setError, commit };
}

// The error line + Save / Cancel under an editor.
export function SaveCancel({ label, saving, error, onSave, onCancel }: {
  label: string; saving: boolean; error: string | null; onSave: () => void; onCancel: () => void;
}) {
  return (
    <>
      {error && <p className="text-[12px] text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-3 py-1.5 bg-blue text-white rounded text-[12px] font-semibold hover:bg-blue-dark disabled:opacity-60"
        >
          {saving ? "Saving…" : label}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 border border-line rounded text-[12px] hover:border-blue"
        >
          Cancel
        </button>
      </div>
    </>
  );
}
