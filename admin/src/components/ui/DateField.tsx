"use client";

// Locale-proof date field. The visible box is a read-only TEXT input that always
// shows DD/MM/YYYY — it never inherits the browser's mm/dd/yyyy locale the way a
// bare <input type="date"> does (Chrome ignores the page `lang` for date inputs,
// so dd/mm/yyyy can't be forced that way). A hidden native <input type="date">
// sitting under the box provides the calendar picker. Value in and out is ISO
// "YYYY-MM-DD" (or "") — a drop-in for the admin/portal date inputs.
//
// This mirrors the existing CalField / DatePicker approach so the whole portal
// reads dates the same way.

import { useRef } from "react";

// ISO "YYYY-MM-DD" → "DD/MM/YYYY". Anything else → "".
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

type Props = {
  value: string;                    // ISO "YYYY-MM-DD" or ""
  onChange: (iso: string) => void;  // emits ISO "YYYY-MM-DD" or ""
  className?: string;               // styles the visible box (border / padding / text)
  max?: string;                     // ISO upper bound for the calendar
  min?: string;                     // ISO lower bound for the calendar
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
};

export default function DateField({
  value, onChange, className = "", max, min, disabled, id, ariaLabel, placeholder = "DD/MM/YYYY",
}: Props) {
  const nativeRef = useRef<HTMLInputElement>(null);

  function open() {
    if (disabled) return;
    const el = nativeRef.current;
    if (!el) return;
    const withPicker = el as HTMLInputElement & { showPicker?: () => void };
    try {
      if (typeof withPicker.showPicker === "function") { withPicker.showPicker(); return; }
    } catch { /* older browsers */ }
    el.focus();
    el.click();
  }

  return (
    <span className="relative block w-full">
      <input
        type="text"
        id={id}
        readOnly
        value={isoToDisplay(value)}
        placeholder={placeholder}
        onClick={open}
        onFocus={open}
        disabled={disabled}
        aria-label={ariaLabel}
        className={`w-full cursor-pointer ${className}`}
      />
      {/* Calendar affordance — non-interactive; the whole box opens the picker. */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      {/* Hidden native calendar — the actual picker. */}
      <input
        ref={nativeRef}
        type="date"
        value={value || ""}
        max={max}
        min={min}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
        tabIndex={-1}
        aria-hidden
      />
    </span>
  );
}
