// Per-tab TTL cache for expensive dashboard/Task-Manager LIST loads.
//
// WHY: these lists were re-fetched from Supabase on every navigation (each tab
// switch, every "back to console"), which — across a team with tabs open all
// day — was a major share of the Free-plan egress. A short-lived cache makes
// rapid back-and-forth reuse the last result instead of re-querying.
//
// SAFETY: sessionStorage only (per-tab, cleared when the tab closes), short
// TTLs, and every data-changing action force-refreshes (bypasses the cache),
// so a user never sees stale data after their OWN action. Worst case is a
// read-only view up to TTL seconds behind a change made in ANOTHER tab/session
// — which self-corrects on the next load.

const PREFIX = "cc.listcache.";

export function getCached<T>(key: string, ttlMs: number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; v: T };
    if (!parsed || typeof parsed.t !== "number") return null;
    if (Date.now() - parsed.t > ttlMs) return null;
    return parsed.v;
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, v: T): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* quota / disabled storage — caching is best-effort */
  }
}

export function invalidate(key: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
