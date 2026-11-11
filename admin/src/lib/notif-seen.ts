// "Read up to" time of the signed-in user's notifications in this browser —
// shared by the bell and My Day's admin decisions, so marking them read in one
// clears the other too.

const KEY = "cc_notif_seen";
const EVT = "cc-notif-seen";

export function notifSeen(): number {
  try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; }
}

export function markNotifSeen(): number {
  const now = Date.now();
  try { localStorage.setItem(KEY, String(now)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent<number>(EVT, { detail: now }));
  return now;
}

export function onNotifSeen(fn: (at: number) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<number>).detail);
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}
