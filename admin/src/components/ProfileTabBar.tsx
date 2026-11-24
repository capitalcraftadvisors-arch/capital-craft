"use client";

// Shared profile tab/action row — placed between a profile's heading bar and
// its progress tracker on ALL FOUR profile types (loan, EPC, insurance,
// non-EPC lead). It's a pure layout shell: the LEFT side holds the navigation
// tabs (Application · Edit · Activity Log · Download) and the RIGHT side holds
// the stage-dependent action buttons. Each profile passes its OWN existing
// handlers/buttons — this component never owns business logic.

import { useRef, useState, type ReactNode } from "react";
import { useCloseOnOutsideClick } from "@/lib/use-close-on-outside-click";

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
  const inner = (
    <>
      {icon && <span className="shrink-0 inline-flex">{icon}</span>}
      <span>{label}</span>
    </>
  );
  if (href && !disabled) {
    return <a href={href} className={cls} title={title ?? label}>{inner}</a>;
  }
  return (
    <button type="button" disabled={disabled} title={title ?? label} onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

// A Download control that opens a small menu. Pass the list of items to show;
// callers filter out tranches that don't exist so the menu only lists what's
// downloadable. When there's a single item it still renders as a menu for a
// consistent look across profiles.
export function DownloadMenu({
  items, icon, disabled, busyLabel, label = "Download", primary, outline,
}: {
  items: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  icon?: ReactNode;
  disabled?: boolean;
  busyLabel?: string | null;
  label?: string;
  primary?: boolean;   // filled green button (a page's main action); menu opens right-aligned
  outline?: boolean;   // bordered button for a header action row; menu opens right-aligned
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(ref, open, setOpen);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={
          "inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-semibold transition-colors whitespace-nowrap disabled:opacity-50 " +
          (primary ? "bg-[#178a5c] text-white border border-[#178a5c] hover:bg-[#12734c]"
            : outline ? "bg-white text-[#0f3d2e] border border-[#cdeadd] hover:bg-[#f0faf5]"
            : "text-[#0f3d2e] hover:bg-[#eef6f1]")
        }
      >
        {icon && <span className="shrink-0 inline-flex">{icon}</span>}
        <span className="inline-flex items-center gap-1.5">
          {busyLabel ?? label}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </button>
      {open && (
        <div className={[(primary || outline) ? "right-0" : "left-0", "absolute top-full mt-1 z-40 min-w-[190px] rounded-[10px] border border-[#cdeadd] bg-white shadow-lg py-1"].join(" ")}>
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

// A compact three-dot (⋯) overflow menu — used on profiles to hold secondary
// actions (e.g. Change review / Delete) instead of a bare trash button.
export function KebabMenu({
  items, ghost,
}: {
  items: Array<{ label: string; icon?: ReactNode; onClick: () => void; danger?: boolean }>;
  ghost?: boolean; // borderless (a clean header row)
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(ref, open, setOpen);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="More actions"
        aria-label="More actions"
        className={[
          "inline-flex items-center justify-center w-9 h-9 rounded-[8px] text-[#0f3d2e] transition-colors shrink-0",
          ghost ? "hover:bg-[#eef6f1]" : "border border-[#cdeadd] bg-white hover:bg-[#f0faf5]",
        ].join(" ")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 min-w-[190px] rounded-[10px] border border-[#cdeadd] bg-white shadow-lg py-1">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setOpen(false); it.onClick(); }}
              className={[
                "w-full text-left px-3.5 py-2 text-[13px] font-medium inline-flex items-center gap-2 transition-colors",
                it.danger ? "text-red-700 hover:bg-red-50" : "text-[#0f3d2e] hover:bg-[#f0faf5]",
              ].join(" ")}
            >
              {it.icon && <span className="shrink-0 inline-flex">{it.icon}</span>}
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
