"use client";

// Partner dashboard · the search box + filter chips (each with its count) over
// the Loans and Insurance tables.

import { NAVY_ACCENT } from "@/components/partner/PartnerShell";

export default function SearchChips<K extends string>({ q, onQ, placeholder, chips, active, onPick, count }: {
  q: string; onQ: (q: string) => void; placeholder: string;
  chips: { key: K; label: string }[]; active: K; onPick: (k: K) => void; count: (k: K) => number;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-[420px] bg-white border border-line rounded-xl px-3.5 h-11 focus-within:border-[#1e3a8a] focus-within:ring-2 focus-within:ring-[#1e3a8a]/15 transition">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder} className="flex-1 min-w-0 bg-transparent text-[14px] text-text outline-none placeholder:text-text-muted" />
        {q && <button onClick={() => onQ("")} className="text-text-muted hover:text-text text-[15px] leading-none" aria-label="Clear">✕</button>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {chips.map((c) => {
          const on = active === c.key;
          return (
            <button key={c.key} onClick={() => onPick(c.key)}
              className={["px-3.5 py-2 rounded-full text-[12.5px] font-semibold border transition-colors inline-flex items-center gap-1.5", on ? "text-white border-transparent" : "bg-white border-line text-text-mid hover:border-[#1e3a8a]"].join(" ")}
              style={on ? { background: NAVY_ACCENT } : undefined}>
              {c.label}
              <span className={["text-[10.5px] px-1.5 rounded-full", on ? "bg-white/25 text-white" : "bg-bg-soft text-text-muted"].join(" ")}>{count(c.key)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
