"use client";

// The box of the ⌘K command palette (CommandPalette.tsx): the search field, the
// live results and the "Go to" pages, drawn with cmdk. All the state stays in
// CommandPalette; this file only draws it.

import { Command } from "cmdk";

/** A live search result: an EPC or a loan application. */
export type PaletteHit = { id: string; label: string; sub: string; href: string };
/** One of the person's sidebar sections. */
export type PaletteNav = { key: string; label: string; run: () => void };

type Props = {
  q: string;
  onQ: (q: string) => void;
  searching: boolean;
  hits: PaletteHit[];
  /** The sidebar sections that match the search. */
  nav: PaletteNav[];
  /** A click outside the box. */
  onClose: () => void;
  onHit: (h: PaletteHit) => void;
  onNav: (n: PaletteNav) => void;
};

const GROUP = "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-text-muted";
const ITEM = "flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-[14px] data-[selected=true]:bg-cc-wash";

export default function CommandPaletteBox({ q, onQ, searching, hits, nav, onClose, onHit, onNav }: Props) {
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <Command
        shouldFilter={false}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-2xl border border-line bg-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5a8a76" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <Command.Input autoFocus value={q} onValueChange={onQ} placeholder="Search EPCs, loans, or jump to a page…"
            className="flex-1 py-3.5 text-[14px] outline-none bg-transparent placeholder:text-text-muted" />
          <kbd className="text-[10px] text-text-muted border border-line rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <Command.List className="max-h-[52vh] overflow-y-auto p-2">
          <Command.Empty className="py-8 text-center text-[13px] text-text-muted">
            {searching ? "Searching…" : "No matches."}
          </Command.Empty>

          {hits.length > 0 && (
            <Command.Group heading="Results" className={GROUP}>
              {hits.map((h) => (
                <Command.Item key={h.id} value={h.id} onSelect={() => onHit(h)} className={ITEM}>
                  <span className="truncate text-text font-medium">{h.label}</span>
                  <span className="text-[11px] text-text-muted shrink-0">{h.sub}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {nav.length > 0 && (
            <Command.Group heading="Go to" className={GROUP}>
              {nav.map((n) => (
                <Command.Item key={n.key} value={`nav ${n.key}`} onSelect={() => onNav(n)} className={ITEM}>
                  <span className="inline-flex items-center gap-2.5 text-text">
                    <span className="w-1.5 h-1.5 rounded-full bg-cc-green" />{n.label}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
