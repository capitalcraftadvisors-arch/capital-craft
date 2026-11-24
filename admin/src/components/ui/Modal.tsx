"use client";

// The one pop-up shell: a full-screen overlay with one panel in it. It draws the
// overlay + panel and handles closing; everything inside is the caller's. Each
// pop-up keeps its own look by passing its exact classes:
//
//   <Modal onClose={close} busy={busy} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6"
//          aria-labelledby="my-title">
//     <h3 id="my-title">…</h3> …
//   </Modal>
//
// Closing rules (match what the pop-up did before — don't add new ones):
//   closeOnBackdrop  "click" (default) — a click on the overlay closes; the panel
//                    stops clicks so they never reach the overlay (or anything
//                    behind the pop-up).
//                    "mousedown" — closes only when the press starts on the
//                    overlay itself; the panel has no handler.
//                    false — the overlay never closes it (close buttons only).
//   closeOnEscape    Escape closes it (default off — only pop-ups that had it).
//   busy             blocks both while something is saving.
//
// Keyboard / screen readers (nothing visible):
//   - The panel is role="dialog" aria-modal="true". Name it with
//     aria-labelledby (the id of its heading) or aria-label; aria-describedby
//     (the id of its text) is read out after the name.
//   - When it opens, focus moves to the panel itself (tabIndex=-1, no outline) —
//     not to the first field, so phones don't pop the keyboard up — unless
//     something inside already took focus (autoFocus).
//   - Tab / Shift+Tab stay inside the top-most open pop-up.
//   - When it closes, focus goes back to whatever had it before (the button
//     that opened it — noted on the first render, before an autoFocus field
//     inside takes focus), unless something else has taken focus meanwhile.
//
// It is always shown: hide it with `{x && <Modal …>}` (or the caller's own
// `if (!open) return null`).
//
// Nothing else on purpose: no portal (it renders where it is placed), no scroll
// lock, no animation.

import { useEffect, useRef, type ReactNode } from "react";

/** The overlay classes in use. Default: OVERLAY.center. Anything else → pass the exact string. */
export const OVERLAY = {
  center: "fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4",
  grid: "fixed inset-0 z-50 bg-black/40 grid place-items-center px-4",
  soft: "fixed inset-0 z-50 bg-black/30 grid place-items-center p-4",     // partner portal / gozerobils
  softTop: "fixed inset-0 z-[60] bg-black/30 grid place-items-center p-4", // soft, opened over another pop-up
  layered: "fixed inset-0 z-50 flex items-center justify-center p-4",     // tint drawn by backdropClassName
  scroll: "fixed inset-0 z-50 bg-black/40 overflow-y-auto",               // tall forms: the overlay scrolls
} as const;

/** The tint layer for OVERLAY.layered (pass as backdropClassName). */
export const BACKDROP = "absolute inset-0 bg-black/40";

type Props = {
  onClose: () => void;
  closeOnBackdrop?: "click" | "mousedown" | false;
  closeOnEscape?: boolean;
  busy?: boolean;
  overlayClassName?: string;
  /** A separate tint layer drawn under the panel (usually BACKDROP). */
  backdropClassName?: string;
  /** The panel's element — "aside" for side drawers. */
  as?: "div" | "aside";
  /** The panel's classes (width, radius, shadow, padding, max height, scroll). */
  className: string;
  /** The id of the pop-up's heading — its name for screen readers. */
  "aria-labelledby"?: string;
  /** Or a name written out, when there is no heading to point at. */
  "aria-label"?: string;
  /** The id of the pop-up's main text, read out after its name. */
  "aria-describedby"?: string;
  children: ReactNode;
};

// The pop-ups open right now, oldest first — only the last one keeps Tab.
const openPanels: HTMLElement[] = [];

const FOCUSABLE = [
  "a[href]", "area[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])", "textarea:not([disabled])", "iframe", "summary",
  "[contenteditable=''], [contenteditable='true']", "[tabindex]:not([tabindex='-1'])",
].join(", ");

/** What Tab can reach inside `panel`, in order (visible ones only). */
function tabStops(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
}

export default function Modal({
  onClose, closeOnBackdrop = "click", closeOnEscape = false, busy = false,
  overlayClassName = OVERLAY.center, backdropClassName, as: Panel = "div", className,
  "aria-labelledby": labelledBy, "aria-label": label, "aria-describedby": describedBy, children,
}: Props) {
  const panelRef = useRef<HTMLElement | null>(null);
  // Who had focus when the pop-up opened. Read on the first render: by the time
  // the effect below runs, an autoFocus field inside has already taken focus.
  const openerRef = useRef<Element | null | undefined>(undefined);
  if (openerRef.current === undefined) openerRef.current = typeof document === "undefined" ? null : document.activeElement;

  useEffect(() => {
    if (!closeOnEscape || busy) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEscape, busy, onClose]);

  // Focus in on open, Tab kept inside, focus back on close.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // The opener — or, when it has gone from the page meanwhile, whatever has focus now.
    const opener = openerRef.current;
    const before = (opener && opener.isConnected && !panel.contains(opener) ? opener : document.activeElement) as HTMLElement | null;
    if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    openPanels.push(panel);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || openPanels[openPanels.length - 1] !== panel) return;
      const stops = tabStops(panel);
      const active = document.activeElement;
      if (!stops.length) { e.preventDefault(); panel.focus({ preventScroll: true }); return; }
      const first = stops[0], last = stops[stops.length - 1];
      if (!panel.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      const i = openPanels.indexOf(panel);
      if (i >= 0) openPanels.splice(i, 1);
      // Still on the page = not really closed (React's dev double-run of effects): keep focus where it is.
      if (panel.isConnected) return;
      // Give focus back only if it was left inside the closed pop-up (or dropped to <body>).
      const now = document.activeElement;
      if (before && before !== document.body && before.isConnected && (!now || now === document.body || panel.contains(now))) {
        before.focus({ preventScroll: true });
      }
    };
  }, []);

  const close = busy ? false : closeOnBackdrop;
  return (
    <div
      className={overlayClassName}
      onClick={close === "click" ? () => onClose() : undefined}
      onMouseDown={close === "mousedown" ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      {backdropClassName && <div className={backdropClassName} />}
      <Panel
        ref={(el: HTMLElement | null) => { panelRef.current = el; }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={className + " outline-none"}
        onClick={closeOnBackdrop === "click" ? (e) => e.stopPropagation() : undefined}
      >
        {children}
      </Panel>
    </div>
  );
}
