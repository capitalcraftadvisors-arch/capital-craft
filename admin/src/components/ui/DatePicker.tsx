"use client";

// Reusable date picker for the loan-app flow.
//
// Uses the browser's native <input type="date"> for the calendar UX
// (universal, keyboard-friendly, no dependency). Stores value in the
// spec'd DD/MM/YYYY string format so downstream (aadhaar_dob,
// coapp_dob) can keep their text columns. No date restrictions — any
// year is selectable, past or future.
//
// External API:
//   value:    string   — display value in "DD/MM/YYYY" (or "" if empty)
//   onChange: (v)      — receives "DD/MM/YYYY" or "" on clear
//
// The component internally converts to/from ISO "YYYY-MM-DD" that the
// native input requires.

import { useMemo, useRef } from "react";

type Props = {
  label?: string;
  value: string;                     // "DD/MM/YYYY" or ""
  onChange: (v: string) => void;     // emits "DD/MM/YYYY" or ""
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  id?: string;
};

// Loose DD/MM/YYYY parser accepting "-" or "." separators too. Returns
// "YYYY-MM-DD" on success or "" on failure.
function toIso(display: string): string {
  if (!display) return "";
  const m = display.match(/^([0-3]?\d)[\/\-.]([01]?\d)[\/\-.](\d{4})$/);
  if (!m) return "";
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

// "YYYY-MM-DD" → "DD/MM/YYYY". Empty passes through.
function toDisplay(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export default function DatePicker({
  label, value, onChange, placeholder = "DD/MM/YYYY",
  hint, error, disabled, id,
}: Props) {
  const nativeRef = useRef<HTMLInputElement>(null);
  const iso = useMemo(() => toIso(value), [value]);
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  function open() {
    if (disabled) return;
    const el = nativeRef.current;
    if (!el) return;
    // showPicker() is the standard way to open the native calendar
    // programmatically. Fallback: focus + click.
    try {
      const withPicker = el as HTMLInputElement & { showPicker?: () => void };
      if (typeof withPicker.showPicker === "function") {
        withPicker.showPicker();
        return;
      }
    } catch { /* older browsers */ }
    el.focus();
    el.click();
  }

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block mb-1.5 text-[13px] font-medium text-text-mid">
          {label}
        </label>
      )}
      <div className="relative">
        {/* Display input — read-only textual view of the DD/MM/YYYY value.
            Click anywhere on it to open the native calendar picker. */}
        <input
          type="text"
          id={inputId}
          readOnly
          value={value}
          placeholder={placeholder}
          onClick={open}
          onFocus={open}
          disabled={disabled}
          className={[
            "w-full rounded-input border bg-white py-3 pr-11 pl-3.5 text-[15px] text-text",
            "outline-none transition-colors duration-250 cursor-pointer",
            error ? "border-red-500 focus:border-red-500" : "border-line focus:border-blue",
            disabled ? "opacity-60 cursor-not-allowed" : "",
          ].join(" ")}
        />
        {/* Calendar icon (also clickable) */}
        <button
          type="button"
          onClick={open}
          disabled={disabled}
          aria-label="Open calendar"
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-text-muted hover:text-[#185fa5] disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>

        {/* Hidden native date input — the actual calendar. Positioned
            absolutely under the display input so its dropdown anchor
            lines up with the visible field. */}
        <input
          ref={nativeRef}
          type="date"
          value={iso}
          onChange={(e) => onChange(toDisplay(e.target.value))}
          disabled={disabled}
          // No min / max — no restriction on selectable dates.
          className="absolute inset-0 opacity-0 pointer-events-none"
          tabIndex={-1}
          aria-hidden
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-[12px] text-red-500">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
