"use client";

// The lender registry in the browser: read once per page session and shared
// by every screen (pickers, filters, labels). Adding a lender — Stakeholders →
// Partners, an EPC profile or the loan picker's "+ Add a lender" — goes through
// addLender(), so it's in the one list everything reads.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DEFAULT_LOAN_LENDERS, fetchLenders, lenderLabelIn, slugifyLender, type Lender } from "@/lib/loan-lenders";

let cache: Promise<Lender[]> | null = null;
let known: Lender[] = DEFAULT_LOAN_LENDERS;
// Mounted lists — told when a re-read brings a new lender.
const listeners = new Set<(l: Lender[]) => void>();

/** After a lender is added or renamed — the next read gets the new list. */
export function invalidateLenders() { cache = null; }

export function loadLenders(): Promise<Lender[]> {
  if (!cache) cache = fetchLenders(supabase()).then((l) => { known = l; listeners.forEach((f) => f(l)); return l; });
  return cache;
}

/** The lender list for a component — re-renders once the registry arrives. */
export function useLenders(): Lender[] {
  const [list, setList] = useState<Lender[]>(known);
  useEffect(() => {
    listeners.add(setList);
    void loadLenders().then(setList);
    return () => { listeners.delete(setList); };
  }, []);
  return list;
}

/** A lender key's name (from the registry once loaded). */
export function lenderName(key: string | null | undefined): string {
  return lenderLabelIn(known, key);
}

/** Registers a lender (its key from the name); an existing key is reused. */
export async function addLender(label: string): Promise<{ lender?: Lender; existed?: boolean; error?: string }> {
  const name = label.trim();
  const key = slugifyLender(name);
  if (!key) return { error: "Enter the lender's name." };
  const all = await loadLenders();
  const hit = all.find((l) => l.key === key);
  if (hit) return { lender: hit, existed: true };
  const sort_order = (all.length + 1) * 10;
  const { error } = await supabase().from("lenders").upsert({ key, label: name, sort_order }, { onConflict: "key", ignoreDuplicates: true });
  if (error) return { error: error.message };
  invalidateLenders();
  void loadLenders(); // every mounted list picks it up
  return { lender: { key, label: name } };
}
