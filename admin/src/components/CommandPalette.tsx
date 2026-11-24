"use client";

// ⌘K / Ctrl-K command palette for the admin console. Jump to any tab/page, or
// live-search EPC partners and loan applications by name and open them. Built on
// cmdk; brand-green accent, no external calls beyond Supabase reads.
//
// This file holds the state (open, the search, its results); the box itself is
// drawn by CommandPaletteBox.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ACCENTS, SECTION_ROUTE, sidebarNavKeys } from "@/components/AdminSidebar";
import CommandPaletteBox, { type PaletteHit, type PaletteNav } from "@/components/CommandPaletteBox";

// The columns the live search reads.
type EpcRow = { id: string; trade_name: string | null; legal_name: string | null; contact_name: string | null; epc_display_id: string | null };
type LoanRow = { id: string; borrower_name: string | null; aadhaar_name: string | null; loan_display_id: string | null };

// Console tabs are internal state restored from sessionStorage on /admin mount.
function goConsole(router: ReturnType<typeof useRouter>, tab: string) {
  try { sessionStorage.setItem("adminList.tab", tab); } catch { /* ignore */ }
  window.dispatchEvent(new Event("adminList.tab")); // already on /admin → switch now
  router.push("/admin");
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PaletteHit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ⌘K / Ctrl-K toggles; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Debounced live search of EPCs + loan applications by name.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) { setHits([]); setSearching(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const db = supabase();
      const like = `%${term}%`;
      const [e, l] = await Promise.all([
        db.from("epc_business").select("id, trade_name, legal_name, contact_name, epc_display_id").neq("business_type", "admin").or(`trade_name.ilike.${like},legal_name.ilike.${like},contact_name.ilike.${like},epc_display_id.ilike.${like}`).limit(6),
        db.from("epc_applications").select("id, borrower_name, aadhaar_name, loan_display_id").or(`borrower_name.ilike.${like},aadhaar_name.ilike.${like},loan_display_id.ilike.${like}`).limit(6),
      ]);
      const out: PaletteHit[] = [];
      for (const b of (e.data ?? []) as EpcRow[]) out.push({ id: `epc:${b.id}`, label: b.trade_name || b.legal_name || b.contact_name || "—", sub: `EPC · ${b.epc_display_id ?? ""}`.trim(), href: `/admin/epc/${b.id}/view` });
      for (const a of (l.data ?? []) as LoanRow[]) out.push({ id: `loan:${a.id}`, label: a.borrower_name || a.aadhaar_name || "—", sub: `Loan · ${a.loan_display_id ?? ""}`.trim(), href: `/admin/app/${a.id}/view` });
      setHits(out); setSearching(false);
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  if (!open) return null;

  const run = (fn: () => void) => { setOpen(false); setQ(""); fn(); };
  // Destinations = the user's own sidebar sections, under the sidebar's names
  // (read while open — the signed-in business is known by then).
  const term = q.trim().toLowerCase();
  const nav: PaletteNav[] = sidebarNavKeys()
    .map((key) => {
      const route = SECTION_ROUTE[key];
      return { key, label: ACCENTS[key].label, run: () => (route ? router.push(route as never) : goConsole(router, key)) };
    })
    .filter((n) => !term || n.label.toLowerCase().includes(term));

  return (
    <CommandPaletteBox
      q={q}
      onQ={setQ}
      searching={searching}
      hits={hits}
      nav={nav}
      onClose={() => setOpen(false)}
      onHit={(h) => run(() => router.push(h.href))}
      onNav={(n) => run(n.run)}
    />
  );
}
