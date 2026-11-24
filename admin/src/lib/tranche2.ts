"use client";

// 2nd-tranche documents from the EPC's partner portal: 0125 stamps
// epc_applications.tranche2_epc_at / tranche2_docs on its uploads, 0138
// tranche2_submitted_at when it presses Send. The bell's red count and My Day's
// "2nd tranche received" list are built from loan rows a page ALREADY loads
// (My Day / Board, the Loans list, the bell when opened) — never a request of
// their own. The latest list is kept in this browser, so the bell shows the
// count on every page without asking the database.
//
// "Mark read" is per person (the user, 25/11) and kept in this browser: the case
// leaves that person's list and bell until the EPC uploads or sends again.

import { useEffect, useMemo, useState } from "react";
import { getBusiness } from "@/lib/auth";
import { COMPLETION_CATEGORIES } from "@/lib/disbursement";

/** Add to an epc_applications select (with the 42703 fallback until 0125 / 0138 are everywhere). */
export const TRANCHE2_COLS = "tranche2_epc_at, tranche2_docs, tranche2_submitted_at";
export const TRANCHE2_TOTAL = COMPLETION_CATEGORIES.length;

/** `at` = the EPC's latest upload or Send. `lender` = the approving lender (the email). */
export type Tranche2 = { id: string; name: string; epc: string | null; lender: string | null; at: string; docs: number };

/** A loan whose EPC uploaded or sent 2nd-tranche documents and whose 2nd disbursement isn't entered yet. */
export function tranche2Of(r: Record<string, any>, name: string, epc: string | null): Tranche2 | null {
  const at = [r.tranche2_epc_at, r.tranche2_submitted_at].filter(Boolean).sort().pop() as string | undefined;
  if (!at || r.second_disbursement_amount != null) return null;
  return { id: r.id, name, epc, lender: r.approved_lender ?? null, at, docs: Number(r.tranche2_docs) || 0 };
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

// ── Mark read (this person, this browser) ──
type Marks = Record<string, string>; // loan id → when it was marked read (ISO)
const READ_EVT = "cc-tranche2-read";
const readKey = () => "cc_tranche2_read:" + (getBusiness()?.id ?? "anon");

function readMarks(): Marks {
  try { return JSON.parse(localStorage.getItem(readKey()) || "{}") as Marks; } catch { return {}; }
}

/** Marks these cases read — they leave this person's list and bell. */
export function markTranche2Read(ids: string[]): void {
  const marks = readMarks();
  const now = new Date().toISOString();
  for (const id of ids) marks[id] = now;
  try { localStorage.setItem(readKey(), JSON.stringify(marks)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(READ_EVT));
}

/** The cases not marked read since the EPC's latest upload / Send — live across the list and the bell. */
export function useUnreadTranche2(list: Tranche2[]): Tranche2[] {
  const [marks, setMarks] = useState<Marks>(() => (typeof window === "undefined" ? {} : readMarks()));
  useEffect(() => {
    const load = () => setMarks(readMarks());
    window.addEventListener(READ_EVT, load);
    return () => window.removeEventListener(READ_EVT, load);
  }, []);
  return useMemo(() => list.filter((t) => !marks[t.id] || marks[t.id] < t.at), [list, marks]);
}
