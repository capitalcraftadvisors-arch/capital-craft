"use client";

// Auto-logout after 1 hour of INACTIVITY. This is an egress precaution: an
// abandoned tab left signed in keeps making background requests; logging it out
// stops them entirely. It is idle-based (not a hard 1-hour cap) so an actively
// working RM is never kicked out mid-task.
//
// Cross-tab safe: the "last activity" time lives in localStorage, so ANY open
// tab's activity keeps ALL of them alive. Only when every tab has been idle for
// an hour does the session end.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { logout, getToken } from "@/lib/auth";

const IDLE_MS = 60 * 60 * 1000; // 1 hour
const KEY = "cc.lastActivity";

export function useIdleLogout() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const touch = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } };
    touch(); // seed on mount (this page load counts as activity)

    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last > 15000) { last = now; touch(); } // throttle writes to ~every 15s
    };
    const events: (keyof WindowEventMap)[] = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const onVis = () => { if (document.visibilityState === "visible") onActivity(); };
    document.addEventListener("visibilitychange", onVis);

    const check = () => {
      if (!getToken()) return; // already signed out
      let ts = 0;
      try { ts = Number(localStorage.getItem(KEY)) || 0; } catch { /* ignore */ }
      if (ts && Date.now() - ts > IDLE_MS) {
        logout();
        router.replace("/login");
      }
    };
    const t = setInterval(check, 60000); // re-check every minute

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
    };
  }, [router]);
}
