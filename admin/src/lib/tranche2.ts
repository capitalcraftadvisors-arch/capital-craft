"use client";

// 2nd-tranche documents the EPC uploaded on its partner portal (0125 stamps
// epc_applications.tranche2_epc_at / tranche2_docs). The bell's red count and
// My Day's "2nd tranche received" list are built from loan rows a page ALREADY
// loads (My Day / Board, the Loans list, the bell when opened) — never a request
// of their own. The latest list is kept in this browser, so the bell shows the
// count on every page without asking the database.

import { getBusiness } from "@/lib/auth";
import { COMPLETION_CATEGORIES } from "@/components/CompletionDocsSection";

/** Add to an epc_applications select (with the 42703 fallback until 0125 is everywhere). */
export const TRANCHE2_COLS = "tranche2_epc_at, tranche2_docs";
export const TRANCHE2_TOTAL = COMPLETION_CATEGORIES.length;

export type Tranche2 = { id: string; name: string; epc: string | null; at: string; docs: number };

/** A loan whose EPC uploaded 2nd-tranche documents and whose 2nd disbursement isn't entered yet. */
export function tranche2Of(r: Record<string, any>, name: string, epc: string | null): Tranche2 | null {
  if (!r.tranche2_epc_at || r.second_disbursement_amount != null) return null;
  return { id: r.id, name, epc, at: r.tranche2_epc_at, docs: Number(r.tranche2_docs) || 0 };
}

export const tranche2Href = (id: string) => `/admin/app/${id}/view?tab=second`;

const EVT = "cc-tranche2";
const key = () => "cc_tranche2:" + (getBusiness()?.id ?? "anon");

export function readTranche2(): Tranche2[] {
  try { return JSON.parse(localStorage.getItem(key()) || "[]") as Tranche2[]; } catch { return []; }
}

/** Save the list a page just loaded and tell the bell (same tab). CC accounts only. */
export function publishTranche2(list: Tranche2[]): void {
  if (getBusiness()?.business_type !== "admin") return;
  const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at));
  try { localStorage.setItem(key(), JSON.stringify(sorted)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent<Tranche2[]>(EVT, { detail: sorted }));
}

export function onTranche2(fn: (list: Tranche2[]) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<Tranche2[]>).detail);
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}
