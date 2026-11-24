"use client";

// View kit · hooks shared by the profile pages (admin/app/[id]/view,
// admin/epc/[id]/view; the Back return path also insurance + lead views).

import { useEffect, useState } from "react";

// Where a case profile's Back goes. The Task Manager stashes
// { to: "/admin/board", href } in sessionStorage ("ccReturnTo") when it opens a
// case; it only counts for THAT case (href under the profile's own base path),
// so a key left behind never sends another profile's Back to the board.
// Blocked storage just means Back goes to its usual place.
const RETURN_KEY = "ccReturnTo";
export function rememberReturn(to: string, href: string) {
  try { sessionStorage.setItem(RETURN_KEY, JSON.stringify({ to, href })); } catch { /* storage blocked */ }
}
/** The stashed return path when it was set for a case under `base` (e.g. "/admin/epc/<id>/"). */
export function returnFor(base: string): string | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(RETURN_KEY) || "null");
    return typeof v?.href === "string" && typeof v.to === "string" && v.href.startsWith(base) ? v.to : null;
  } catch { return null; }
}
export function clearReturn() {
  try { sessionStorage.removeItem(RETURN_KEY); } catch { /* storage blocked */ }
}
/** returnFor + clear — for the Back click itself. */
export function takeReturn(base: string): string | null {
  const to = returnFor(base);
  clearReturn();
  return to;
}

/** True under xl, where the Submitted cards stack ABOVE Documents — their
 *  details then open in place (pushing Documents down) instead of floating over it. */
export function useStacked(): boolean {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const on = () => setStacked(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return stacked;
}
