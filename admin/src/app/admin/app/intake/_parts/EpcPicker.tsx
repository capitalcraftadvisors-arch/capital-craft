"use client";

// Intake chat — the first turn's dock: the approved-EPC drop-up list with search (a new name becomes a lead), composer locked.

import type { Dispatch, SetStateAction } from "react";
import type { Choice } from "@/components/chat/types";

export default function EpcPicker({ epcs, filteredEpcs, epcSearch, setEpcSearch, epcOpen, setEpcOpen, onPick, onNewLead }: {
  epcs: Choice[]; filteredEpcs: Choice[]; epcSearch: string; setEpcSearch: (v: string) => void;
  epcOpen: boolean; setEpcOpen: Dispatch<SetStateAction<boolean>>; onPick: (e: Choice) => void; onNewLead: (name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* The list is hidden behind the "EPCs list" button and opens
          UPWARD (dropup). Inside: a search that also lets you type a
          brand-new EPC name (→ captured as a lead). */}
      {epcOpen && (
        <div className="rounded-2xl border border-line bg-white shadow-lg overflow-hidden">
          <div className="p-2 border-b border-line">
            <input autoFocus value={epcSearch} onChange={(e) => setEpcSearch(e.target.value)} placeholder="Search, or type a new EPC name…" className="w-full border border-line rounded-lg px-3 py-2 text-[14px] bg-white focus:outline-none focus:border-[#178a5c]" />
          </div>
          <div className="max-h-[38vh] overflow-y-auto flex flex-col">
            {epcs.length === 0 ? (
              <div className="text-[13px] text-text-muted px-3 py-3">Loading partners…</div>
            ) : filteredEpcs.length === 0 ? (
              <div className="text-[13px] text-text-muted px-3 py-3">No approved EPC matches “{epcSearch.trim()}”.</div>
            ) : filteredEpcs.map((e) => (
              <button key={e.value} onClick={() => onPick(e)} className="text-left px-4 py-2.5 border-b border-line/60 last:border-0 hover:bg-[#f7fcf9] transition">
                <div className="text-[14px] font-semibold text-text">{e.label}</div>{e.sub && <div className="text-[12px] text-text-muted font-mono">{e.sub}</div>}
              </button>
            ))}
            {epcSearch.trim() && (
              <button onClick={() => onNewLead(epcSearch.trim())} className="text-left px-4 py-2.5 bg-[#f7fcf9] hover:bg-[#eef8f2] transition border-t border-line">
                <span className="text-[13px] font-semibold text-[#0f3d2e]">+ Use “{epcSearch.trim()}”</span>
                <span className="block text-[11px] text-text-muted">Not a registered partner — saved to your Leads to convert later.</span>
              </button>
            )}
          </div>
        </div>
      )}
      {/* Dropup trigger */}
      <button onClick={() => setEpcOpen((o) => !o)} className="flex items-center justify-between px-4 py-3 rounded-full border border-[#178a5c] bg-white text-[14px] font-semibold text-[#0f3d2e] hover:bg-[#f7fcf9] transition">
        <span>EPCs list</span>
        <span className="text-[12px] text-[#178a5c]">{epcOpen ? "▾" : "▴"}</span>
      </button>
      {/* Locked composer — the chat opens only after an EPC is chosen. */}
      <div className="rounded-full border border-line bg-bg-soft px-4 py-2.5 text-[13px] text-text-muted select-none">Please select an EPC first</div>
    </div>
  );
}
