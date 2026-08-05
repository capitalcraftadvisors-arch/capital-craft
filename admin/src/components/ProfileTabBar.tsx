"use client";

// Shared profile tab/action row — placed between a profile's heading bar and
// its progress tracker on ALL FOUR profile types (loan, EPC, insurance,
// non-EPC lead). It's a pure layout shell: the LEFT side holds the navigation
// tabs (Application · Edit · Activity Log · Download) and the RIGHT side holds
// the stage-dependent action buttons. Each profile passes its OWN existing
// handlers/buttons — this component never owns business logic.

import { useEffect, useRef, useState, type ReactNode } from "react";

export function TabButton({
  label, icon, onClick, href, active, disabled, title,
}: {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const cls = [
    "inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-semibold transition-colors whitespace-nowrap",
    active
      ? "bg-[#0f3d2e] text-white"
      : "text-[#0f3d2e] hover:bg-[#eef6f1]",
    disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "",
  ].join(" ");
  if (href && !disabled) {
    return (
      <a href={href} className={cls} title={title}>
        {icon && <span className="shrink-0 inline-flex">{icon}</span>}
        {label}
      </a>
    );
  }
  return (
    <button type="button" disabled={disabled} title={title} onClick={onClick} className={cls}>
      {icon && <span className="shrink-0 inline-flex">{icon}</span>}
      {label}
    </button>
  );
}

// A Download control that opens a small menu. Pass the list of items to show;
// callers filter out tranches that don't exist so the menu only lists what's
// downloadable. When there's a single item it still renders as a menu for a
// consistent look across profiles.
export function DownloadMenu({
  items, icon, disabled, busyLabel, label = "Download",
}: {
  items: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  icon?: ReactNode;
  disabled?: boolean;
  busyLabel?: string | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-semibold text-[#0f3d2e] hover:bg-[#eef6f1] transition-colors whitespace-nowrap disabled:opacity-50"
      >
        {icon && <span className="shrink-0 inline-flex">{icon}</span>}
        {busyLabel ?? label}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 min-w-[190px] rounded-[10px] border border-[#cdeadd] bg-white shadow-lg py-1">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}
              className="w-full text-left px-3.5 py-2 text-[13px] font-medium text-[#0f3d2e] hover:bg-[#f0faf5] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProfileTabBar({
  left, right,
}: {
  left: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="rounded-[12px] border border-[#cdeadd] bg-white px-2.5 py-2 mb-4 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-1 flex-wrap min-w-0">{left}</div>
      {right && <div className="flex items-center gap-2 flex-wrap justify-end">{right}</div>}
    </div>
  );
}
