"use client";

// The one pop-up shell: a full-screen overlay with one panel in it. It draws the
// overlay + panel and handles closing; everything inside is the caller's. Each
// pop-up keeps its own look by passing its exact classes:
//
//   <Modal onClose={close} busy={busy} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
//     …
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
// It is always shown: hide it with `{x && <Modal …>}` (or the caller's own
// `if (!open) return null`).
//
// Nothing else on purpose: no portal (it renders where it is placed), no focus
// trap, no scroll lock, no animation.

import { useEffect, type ReactNode } from "react";

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
  children: ReactNode;
};

export default function Modal({
  onClose, closeOnBackdrop = "click", closeOnEscape = false, busy = false,
  overlayClassName = OVERLAY.center, backdropClassName, as: Panel = "div", className, children,
}: Props) {
  useEffect(() => {
    if (!closeOnEscape || busy) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEscape, busy, onClose]);

  const close = busy ? false : closeOnBackdrop;
  return (
    <div
      className={overlayClassName}
      onClick={close === "click" ? () => onClose() : undefined}
      onMouseDown={close === "mousedown" ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      {backdropClassName && <div className={backdropClassName} />}
      <Panel className={className} onClick={closeOnBackdrop === "click" ? (e) => e.stopPropagation() : undefined}>
        {children}
      </Panel>
    </div>
  );
}
