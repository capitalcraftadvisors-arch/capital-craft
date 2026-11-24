"use client";

// The menus' and pop-overs' "click anywhere else closes it".

import { useEffect, type RefObject } from "react";

/** While `open`, a mouse press outside `ref`'s element calls setOpen(false). */
export function useCloseOnOutsideClick(ref: RefObject<HTMLElement>, open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, open, setOpen]);
}
