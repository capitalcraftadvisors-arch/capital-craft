// Task Manager — the screen state kept for this browser tab (view, tabs, filters, search, last case opened).

import { getBusiness } from "@/lib/auth";
import type { CaseSource } from "@/lib/ops-board";

// The Task Manager's screen, kept for this browser tab (sessionStorage — no
// request): coming Back from a case returns to the same view, tabs, filters and
// search, with the case last opened scrolled to and blinking.
type TmState = { view?: "myday" | "board"; src?: CaseSource; stage?: string; colour?: "all" | "red" | "yellow" | "green"; owner?: string; q?: string; last?: string };
const tmKey = () => `cc_tm_state:${getBusiness()?.id ?? ""}`;
export function tmState(): TmState {
  try { return JSON.parse(sessionStorage.getItem(tmKey()) || "{}") as TmState; } catch { return {}; }
}
export function saveTm(patch: Partial<TmState>) {
  try { sessionStorage.setItem(tmKey(), JSON.stringify({ ...tmState(), ...patch })); } catch { /* storage blocked */ }
}
