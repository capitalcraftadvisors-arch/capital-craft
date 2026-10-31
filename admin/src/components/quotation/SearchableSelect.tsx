"use client";

// Searchable dropdown with "add custom". Type to filter; pick an option; or type
// a new value and click "Add" — if `field` is set the custom value is persisted
// (POST /api/epc/quotation/brands) so it's in the list forever, for everyone.

import { useEffect, useRef, useState } from "react";
import { getToken } from "@/lib/auth";
import { rememberBrandOption } from "./form-kit";

export default function SearchableSelect({
  label, value, options, onChange, field, placeholder = "Search or type…", required, clearable, triggerClass,
}: {
  label: string;             // "" → no label (the page draws its own)
  value: string;
  options: string[];
  onChange: (v: string) => void;
  field?: string;            // persist custom values under this field key
  placeholder?: string;
  required?: boolean;
  clearable?: boolean;       // × to empty an optional field
  triggerClass?: string;     // the closed box's look, to match the page's inputs
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<string[]>(options);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setOpts(options); }, [options]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const needle = q.trim().toLowerCase();
  const filtered = needle ? opts.filter((o) => o.toLowerCase().includes(needle)) : opts;
  const exact = opts.some((o) => o.toLowerCase() === needle);

  function pick(v: string) {
    onChange(v); setQ(""); setOpen(false);
    setTimeout(() => btnRef.current?.focus(), 0);
  }
  async function addCustom() {
    const v = q.trim();
    if (!v) return;
    setBusy(true);
    try {
      if (field) {
        await fetch("/api/epc/quotation/brands", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
          body: JSON.stringify({ field, value: v }),
        }).catch(() => {});
        rememberBrandOption(field, v);
      }
      setOpts((o) => (o.includes(v) ? o : [...o, v]));
      pick(v);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-1" ref={boxRef}>
      {label && <label className="text-[12.5px] font-medium text-text-mid">{label}{required && <span className="text-red-500"> *</span>}</label>}
      <div className="relative">
        <button type="button" ref={btnRef} data-qnav onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
          className={(triggerClass ?? "border border-line rounded-xl px-3 py-2 text-[13.5px] bg-white hover:border-[#1e3a8a] focus:outline-none focus:border-[#1e3a8a]") + " w-full text-left flex items-center justify-between gap-2"}>
          <span className={value ? "text-text" : "text-text-muted"}>{value || placeholder}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a8a76" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {clearable && value && (
          <button type="button" onClick={() => onChange("")} aria-label={`Clear ${label}`}
            className="absolute right-8 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-md text-text-muted hover:text-text text-[15px] leading-none">×</button>
        )}
        {open && (
          <div className="absolute z-30 mt-1 w-full bg-white border border-line rounded-xl shadow-lg max-h-[260px] overflow-hidden flex flex-col">
            <div className="p-2 border-b border-line">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or type a new one…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); if (filtered.length) pick(filtered[0]); else if (q.trim()) void addCustom(); }
                  else if (e.key === "Escape") { e.preventDefault(); setOpen(false); setQ(""); setTimeout(() => btnRef.current?.focus(), 0); }
                }}
                className="w-full border border-line rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[#1e3a8a]" />
            </div>
            <div className="overflow-y-auto">
              {filtered.map((o) => (
                <button key={o} type="button" onClick={() => pick(o)}
                  className={["w-full text-left px-3 py-2 text-[13px] hover:bg-[#f0faf5]", o === value ? "font-semibold text-[#1e3a8a]" : "text-text"].join(" ")}>
                  {o}
                </button>
              ))}
              {q.trim() && !exact && (
                <button type="button" disabled={busy} onClick={() => void addCustom()}
                  className="w-full text-left px-3 py-2 text-[13px] text-[#178a5c] font-semibold hover:bg-[#f0faf5] border-t border-line disabled:opacity-50">
                  + Add “{q.trim()}”{field ? " (saved for next time)" : ""}
                </button>
              )}
              {filtered.length === 0 && !q.trim() && <div className="px-3 py-2 text-[12px] text-text-muted">No options.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
