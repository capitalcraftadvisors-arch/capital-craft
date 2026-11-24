"use client";

// View kit · hooks shared by the two profile pages (admin/app/[id]/view and
// admin/epc/[id]/view).

import { useEffect, useState } from "react";

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
