"use client";

// Shared profile tab/action row — placed between a profile's heading bar and
// its progress tracker on ALL FOUR profile types (loan, EPC, insurance,
// non-EPC lead). It's a pure layout shell: the LEFT side holds the navigation
// tabs (Application · Edit · Activity Log · Download) and the RIGHT side holds
// the stage-dependent action buttons. Each profile passes its OWN existing
// handlers/buttons — this component never owns business logic.

import { useEffect, useRef, useState, type ReactNode } from "react";

// Label visibility inside a collapsing ProfileRail: shown on mobile (static
// expanded rail) and, on lg+, only while the rail is hovered (group/rail).
const RAIL_LABEL = "truncate inline lg:hidden lg:group-hover/rail:inline";
const RAIL_JUSTIFY = "w-full justify-start lg:justify-center lg:group-hover/rail:justify-start";

export function TabButton({
  label, icon, onClick, href, active, disabled, title, fullWidth, rail,
}: {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  fullWidth?: boolean; // vertical rail: full-width, left-aligned
  rail?: boolean;      // collapsing rail: icon-only until hover
}) {
  const cls = [
    "inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-semibold transition-colors whitespace-nowrap",
    rail ? RAIL_JUSTIFY : fullWidth ? "w-full justify-start" : "",
    active
      ? "bg-[#0f3d2e] text-white"
      : "text-[#0f3d2e] hover:bg-[#eef6f1]",
    disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "",
  ].join(" ");
  const inner = (
    <>
      {icon && <span className="shrink-0 inline-flex">{icon}</span>}
      <span className={rail ? RAIL_LABEL : undefined}>{label}</span>
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

// Collapsing left rail for the profile pages — a slim icon strip (56px) that
// expands into a labelled panel on hover (overlaying the content, which keeps
// the full window width), mirroring the main-console AdminSidebar. On mobile
// it's a normal full-width block with labels always shown. Pass rail-mode
// TabButton / DownloadMenu children.
export function ProfileRail({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 mb-4 lg:mb-0 lg:w-[56px]">
      <div className="group/rail lg:sticky lg:top-[70px] w-full lg:w-[56px] lg:hover:w-[220px] transition-[width] duration-200 ease-out rounded-[12px] border border-[#cdeadd] bg-white p-2 flex flex-col gap-1 lg:z-30 lg:shadow-sm">
        {children}
      </div>
    </div>
  );
}

// A Download control that opens a small menu. Pass the list of items to show;
// callers filter out tranches that don't exist so the menu only lists what's
// downloadable. When there's a single item it still renders as a menu for a
// consistent look across profiles.
export function DownloadMenu({
  items, icon, disabled, busyLabel, label = "Download", fullWidth, rail,
}: {
  items: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  icon?: ReactNode;
  disabled?: boolean;
  busyLabel?: string | null;
  label?: string;
  fullWidth?: boolean; // vertical rail: full-width, left-aligned
  rail?: boolean;      // collapsing rail: icon-only until hover
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
    <div className={"relative" + (rail || fullWidth ? " w-full" : "")} ref={ref} title={rail ? (busyLabel ?? label) : undefined}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={"inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-semibold text-[#0f3d2e] hover:bg-[#eef6f1] transition-colors whitespace-nowrap disabled:opacity-50" + (rail ? " " + RAIL_JUSTIFY : fullWidth ? " w-full justify-start" : "")}
      >
        {icon && <span className="shrink-0 inline-flex">{icon}</span>}
        <span className={rail ? RAIL_LABEL + " inline-flex items-center gap-1.5" : "inline-flex items-center gap-1.5"}>
          {busyLabel ?? label}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </span>
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

// A compact three-dot (⋯) overflow menu — used on profiles to hold secondary
// actions (e.g. Change review / Delete) instead of a bare trash button.
export function KebabMenu({
  items,
}: {
  items: Array<{ label: string; icon?: ReactNode; onClick: () => void; danger?: boolean }>;
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
        onClick={() => setOpen((v) => !v)}
        title="More actions"
        aria-label="More actions"
        className="inline-flex items-center justify-center w-9 h-9 rounded-[8px] border border-[#cdeadd] bg-white text-[#0f3d2e] hover:bg-[#f0faf5] transition-colors shrink-0"
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
