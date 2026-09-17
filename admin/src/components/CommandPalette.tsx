"use client";

// ⌘K / Ctrl-K command palette for the admin console. Jump to any tab/page, or
// live-search EPC partners and loan applications by name and open them. Built on
// cmdk; brand-green accent, no external calls beyond Supabase reads.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { supabase } from "@/lib/supabase";

type Hit = { id: string; label: string; sub: string; href: string };

// Console tabs are internal state restored from sessionStorage on /admin mount.
function goConsole(router: ReturnType<typeof useRouter>, tab: string) {
  try { sessionStorage.setItem("adminList.tab", tab); } catch { /* ignore */ }
  router.push("/admin");
}

const NAV: { label: string; hint: string; run: (r: ReturnType<typeof useRouter>) => void }[] = [
  { label: "EPC partners", hint: "Console", run: (r) => goConsole(r, "epcs") },
  { label: "Loan applications", hint: "Console", run: (r) => goConsole(r, "apps") },
  { label: "Loan leads", hint: "Console", run: (r) => goConsole(r, "loanleads") },
  { label: "Insurance", hint: "Console", run: (r) => goConsole(r, "insurance") },
  { label: "Leads", hint: "Console", run: (r) => goConsole(r, "leads") },
  { label: "Analytics", hint: "Page", run: (r) => r.push("/admin/analytics" as any) },
  { label: "Task Manager", hint: "Page", run: (r) => r.push("/admin/board" as any) },
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ⌘K / Ctrl-K toggles; Esc closes (handled by cmdk Dialog too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
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
      const out: Hit[] = [];
      for (const b of (e.data ?? []) as any[]) out.push({ id: `epc:${b.id}`, label: b.trade_name || b.legal_name || b.contact_name || "—", sub: `EPC · ${b.epc_display_id ?? ""}`.trim(), href: `/admin/epc/${b.id}/view` });
      for (const a of (l.data ?? []) as any[]) out.push({ id: `loan:${a.id}`, label: a.borrower_name || a.aadhaar_name || "—", sub: `Loan · ${a.loan_display_id ?? ""}`.trim(), href: `/admin/app/${a.id}/view` });
      setHits(out); setSearching(false);
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const run = (fn: () => void) => { setOpen(false); setQ(""); fn(); };
  const navFiltered = useMemo(() => NAV, []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/40" />
      <Command
        shouldFilter={false}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-2xl border border-line bg-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5a8a76" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Search EPCs, loans, or jump to a page…"
            className="flex-1 py-3.5 text-[14px] outline-none bg-transparent placeholder:text-text-muted" />
          <kbd className="text-[10px] text-text-muted border border-line rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <Command.List className="max-h-[52vh] overflow-y-auto p-2">
          <Command.Empty className="py-8 text-center text-[13px] text-text-muted">
            {searching ? "Searching…" : q.trim().length >= 2 ? "No matches." : "Type to search, or pick a destination below."}
          </Command.Empty>

          {hits.length > 0 && (
            <Command.Group heading="Results" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-text-muted">
              {hits.map((h) => (
                <Command.Item key={h.id} value={h.id} onSelect={() => run(() => router.push(h.href as any))}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-[14px] data-[selected=true]:bg-[#f0faf5]">
                  <span className="truncate text-text font-medium">{h.label}</span>
                  <span className="text-[11px] text-text-muted shrink-0">{h.sub}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-text-muted">
            {navFiltered.map((n) => (
              <Command.Item key={n.label} value={`nav ${n.label}`} onSelect={() => run(() => n.run(router))}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-[14px] data-[selected=true]:bg-[#f0faf5]">
                <span className="inline-flex items-center gap-2.5 text-text">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#178a5c]" />{n.label}
                </span>
                <span className="text-[11px] text-text-muted shrink-0">{n.hint}</span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
