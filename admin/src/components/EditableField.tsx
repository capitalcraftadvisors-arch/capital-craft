"use client";

// Inline-edit field for the admin EPC detail page.
//
//   - Static mode: shows value as text. Click "Edit" → switches to input.
//   - Edit mode: text input or select with Save / Cancel buttons.
//   - On Save: calls onSave(newValue). Caller is responsible for the
//     supabase update + audit log write. We just collect + dispatch.
//   - readOnly={true} renders value-only with no edit affordance.
//
// Variants: text (default), select (when options provided).

import { useState } from "react";

type Option = { value: string; label: string };

type Props = {
  label: string;
  value: string | null | undefined;
  // Display transform for the static label (e.g. capitalize an enum).
  display?: (v: string | null | undefined) => string;
  // Inline edit input type.
  type?: "text" | "email" | "tel" | "number";
  options?: Option[];                                   // makes it a select
  // Validation: return error string or null for OK.
  validate?: (v: string) => string | null;
  // Called when user clicks Save. Resolve = success, reject = stays editing.
  onSave: (next: string) => Promise<void>;
  readOnly?: boolean;
  placeholder?: string;
  hint?: string;
};

export default function EditableField({
  label, value, display, type = "text", options,
  validate, onSave, readOnly, placeholder, hint,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setVal(value ?? "");
    setError(null);
    setEditing(true);
  }
  function cancel() {
    setError(null);
    setEditing(false);
  }
  async function save() {
    const trimmed = val.trim();
    if (validate) {
      const msg = validate(trimmed);
      if (msg) { setError(msg); return; }
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (e) {
      setError((e as Error)?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const shown = display ? display(value) : (value ?? "");

  if (!editing) {
    return (
      <div className="flex items-start gap-4 text-[13px] py-1.5">
        <dt className="text-text-muted min-w-[140px] shrink-0">{label}</dt>
        <dd className="text-text break-words flex-1">
          {shown || <span className="text-text-muted">—</span>}
        </dd>
        {!readOnly && (
          <button
            type="button"
            onClick={start}
            className="text-[12px] text-blue hover:underline shrink-0"
          >
            Edit
          </button>
        )}
        {readOnly && (
          <span
            className="text-[11px] text-text-muted shrink-0"
            title="Read-only field"
          >
            (read-only)
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="py-2 text-[13px]">
      <p className="text-text-muted mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2 items-start">
        {options ? (
          <select
            value={val}
            onChange={(e) => setVal(e.target.value)}
            disabled={saving}
            className="flex-1 min-w-[160px] border border-line rounded px-2 py-1.5 text-[13px] focus:border-blue outline-none bg-white"
          >
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <input
            type={type}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={placeholder}
            disabled={saving}
            className="flex-1 min-w-[160px] border border-line rounded px-2 py-1.5 text-[13px] focus:border-blue outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") cancel();
            }}
          />
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 bg-blue text-white rounded text-[12px] font-semibold hover:bg-blue-dark disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="px-3 py-1.5 border border-line rounded text-[12px] hover:border-blue"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}
      {!error && hint && <p className="mt-1.5 text-[12px] text-text-muted">{hint}</p>}
    </div>
  );
}
