"use client";

// Admin console — shared kit of the tabs (EPCs, Loan applications, Solar /
// Other Insurance, Leads): summary cards, the search + Filters toolbar, the
// filters panel and its date range, the Created-on cell, the empty/loading
// table row, CSV export, the back-from-View scroll/highlight/filters restore,
// and the small helpers they use.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { fmtDate } from "@/lib/dates";

// The EPC embedded in a loan / insurance list row (epc_business:epc_business_id(…)).
export type EpcBusinessRef = { contact_name: string | null; trade_name: string | null; legal_name: string | null; epc_display_id: string | null } | null;

// The time half of a row's created timestamp — the tables show the date bold
// (fmtDate) with the time muted underneath: "10:43 am".
export function fmtAddedTime(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
}

// Phone-search cap: when the query is ALL digits (searching a mobile number),
// limit it to 10 digits; mixed text (names, emails, EPC-… ids) is unrestricted.
function capPhone(v: string): string {
  return /^\d+$/.test(v) ? v.slice(0, 10) : v;
}

// Shared CSV export — one blob/download path for every console table (Loans,
// Insurance, Leads, EPCs). Excel-friendly: UTF-8 BOM + CRLF + quoted cells.
// Formula-injection guard (OWASP): a text cell starting with = + - @ or a tab /
// carriage return would run as a formula in Excel, so it gets a leading single
// quote. Real numbers, and text that is just a number ("-500"), stay as they are.
export function downloadCsv(filenameStem: string, header: string[], rows: (unknown[])[]) {
  const safe = (v: unknown) => {
    const s = String(v ?? "");
    return typeof v !== "number" && /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s) ? "'" + s : s;
  };
  const esc = (v: unknown) => `"${safe(v).replace(/"/g, '""')}"`;
  const lines = [header.map(esc).join(",")];
  for (const r of rows) lines.push(r.map(esc).join(","));
  const csv = "﻿" + lines.join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameStem}-${fmtDate(new Date()).replace(/\//g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Every status pill in the console: one shape, labels as written (no forced capitals).
export const PILL = "inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold";

export const IconDownload = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" />
  </svg>
);

export type SummaryCard = { key: string; label: string; value: number };

// Per-card outline icons (accent-colored via currentColor), keyed by card key.
const IW = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const SUMMARY_ICON: Record<string, ReactNode> = {
  "":               <svg {...IW}><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></svg>,
  unseen:           <svg {...IW}><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a13.2 13.2 0 0 1-1.67 2.68M6.6 6.6A13.5 13.5 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="M2 2l20 20" /></svg>,
  under_review:     <svg {...IW}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  updated:          <svg {...IW}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>,
  docs_pending:     <svg {...IW}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M12 12v3M12 18h.01" /></svg>,
  docs_sent:        <svg {...IW}><path d="M22 2 11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>,
  approved:         <svg {...IW}><path d="M12 3l2 1.6 2.5-.3 1 2.3 2.3 1-.3 2.5L21 12l-1.6 2 .3 2.5-2.3 1-1 2.3-2.5-.3L12 21l-2-1.6-2.5.3-1-2.3-2.3-1 .3-2.5L3 12l1.6-2-.3-2.5 2.3-1 1-2.3 2.5.3z" /><path d="M9 12l2 2 4-4" /></svg>,
  lender_approved:  <svg {...IW}><path d="M12 3l2 1.6 2.5-.3 1 2.3 2.3 1-.3 2.5L21 12l-1.6 2 .3 2.5-2.3 1-1 2.3-2.5-.3L12 21l-2-1.6-2.5.3-1-2.3-2.3-1 .3-2.5L3 12l1.6-2-.3-2.5 2.3-1 1-2.3 2.5.3z" /><path d="M9 12l2 2 4-4" /></svg>,
  rejected_by_lender: <svg {...IW}><path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z" /><path d="M15 9l-6 6M9 9l6 6" /></svg>,
  hold:             <svg {...IW}><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></svg>,
  rejected:         <svg {...IW}><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></svg>,
  aborted:          <svg {...IW}><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>,
  disbursed:        <svg {...IW}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>,
  awaiting_policy:  <svg {...IW}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M12 8v4M12 16h.01" /></svg>,
  policy_issued:    <svg {...IW}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>,
  new:              <svg {...IW}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>,
  contacted:        <svg {...IW}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z" /></svg>,
  converted:        <svg {...IW}><circle cx="12" cy="12" r="9" /><path d="M8 12l2.5 2.5L16 9" /></svg>,
  closed:           <svg {...IW}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></svg>,
};

// Compact, clickable stat cards. Clicking sets the active category (key);
// clicking the active one — or the "" (Total) card — clears it. Each card's
// count is computed with the SAME predicate the table filters on, so a card's
// number always equals the rows shown when it's active.
// The detailed count cards stay collapsed until the admin opens the
// breakdown (or a stage filter is active). Cards are compact.
export function SummaryCards({ accent, cards, active, onPick, caption }: {
  accent: string; cards: SummaryCard[]; active: string; onPick: (key: string) => void; caption?: string;
}) {
  const [open, setOpen] = useState(false);
  const show = open || !!active;
  return (
    <div className="mb-5">
      <div className="flex items-center gap-3">
        {caption && <p className="text-[11px] text-text-muted font-medium">{caption}</p>}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={show}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border bg-white px-3.5 py-1.5 text-[12px] font-semibold shadow-sm hover:shadow-md transition-shadow"
          style={{ color: accent, borderColor: `color-mix(in srgb, ${accent} 35%, white)` }}>
          {show ? "Hide breakdown" : "Breakdown"}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={"transition-transform " + (show ? "rotate-180" : "")}><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      <div className={"grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 overflow-hidden transition-all duration-300 " + (show ? "mt-3 max-h-[900px] opacity-100" : "max-h-0 opacity-0")}>
        {cards.map((c) => {
          const on = active === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onPick(c.key)}
              aria-pressed={on}
              className="flex items-center gap-2.5 rounded-xl border bg-white px-3 py-2 text-left shadow-sm hover:shadow-md transition-shadow"
              style={on ? { borderColor: accent, boxShadow: `inset 0 0 0 1px ${accent}` } : { borderColor: `color-mix(in srgb, ${accent} 18%, white)` }}
            >
              <span className="w-7 h-7 rounded-md grid place-items-center shrink-0" style={{ backgroundColor: accent + "1a", color: accent }}>
                {SUMMARY_ICON[c.key] ?? SUMMARY_ICON[""]}
              </span>
              <span className="min-w-0">
                <span className="block text-[16px] font-display font-bold leading-none text-text">{c.value}</span>
                <span className="block text-[10px] text-text-muted mt-0.5 truncate" title={c.label}>{c.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// "Filters" toggle with an active-count badge (panel filters + any active card).
function FiltersButton({ count, open, accent, onClick }: {
  count: number; open: boolean; accent: string; onClick: () => void;
}) {
  const active = count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="inline-flex items-center gap-2 rounded-input border border-line bg-white px-3.5 py-2.5 text-[14px] font-medium text-text-mid hover:text-text transition-colors whitespace-nowrap"
      style={active || open ? { borderColor: accent, color: accent } : undefined}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M7 12h10M11 18h2" /></svg>
      Filters
      {active && (
        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-white text-[11px] font-bold" style={{ backgroundColor: accent }}>{count}</span>
      )}
    </button>
  );
}

// The row above each table: search box (all-digit queries capped at 10 —
// capPhone), the Filters toggle, then the tab's own buttons (children).
export function ListToolbar({ placeholder, q, onQ, accent, filterCount, filtersOpen, onToggleFilters, children }: {
  placeholder: string; q: string; onQ: (v: string) => void;
  accent: string; filterCount: number; filtersOpen: boolean; onToggleFilters: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-3">
      <div className="flex-1 min-w-[220px]">
        <Input placeholder={placeholder} value={q} onChange={(e) => onQ(capPhone(e.target.value))} />
      </div>
      <FiltersButton count={filterCount} open={filtersOpen} accent={accent} onClick={onToggleFilters} />
      {children}
    </div>
  );
}

// "Report" — the tab's CSV export of its currently-filtered list.
export function ReportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" onClick={onClick} className="whitespace-nowrap inline-flex items-center gap-1.5">
      {IconDownload} Report
    </Button>
  );
}

// Collapsible panel holding a tab's existing filter controls + Clear all.
export function FiltersPanel({ open, hasActive, onClear, children }: {
  open: boolean; hasActive: boolean; onClear: () => void; children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="mb-5 rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-semibold text-text-mid uppercase tracking-wide">Filters</p>
        {hasActive && (
          <button type="button" onClick={onClear} className="text-[12px] text-blue hover:underline">Clear all</button>
        )}
      </div>
      <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {children}
      </div>
    </div>
  );
}

// "Created Date" range control: a calendar-icon box showing the formatted date
// (or a From/To placeholder) that opens the NATIVE calendar popover on click —
// no visible dd-mm-yyyy field.
function CalField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const display = value ? fmtDate(value) : placeholder;
  return (
    <button
      type="button"
      onClick={() => { const el = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null; try { el?.showPicker?.(); } catch { el?.focus(); } }}
      className="relative inline-flex items-center gap-2 w-full rounded-input border border-line bg-white px-3 py-2.5 text-[13px] text-left hover:border-blue transition-colors"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted shrink-0"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>
      <span className={value ? "text-text" : "text-text-muted"}>{display}</span>
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-hidden
        tabIndex={-1}
        className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
      />
    </button>
  );
}

// One labelled "Created Date" group (From + To), spanning two filter columns.
export function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1 col-span-2">
      <span className="text-[11px] font-medium text-text-muted">Created Date</span>
      <div className="grid grid-cols-2 gap-2">
        <CalField value={from} onChange={onFrom} placeholder="From" />
        <CalField value={to} onChange={onTo} placeholder="To" />
      </div>
    </div>
  );
}

// The panel's "Created Date" range (inclusive From / To, local days) as a row
// test on created_at. Used by the Loan, Insurance, Other Insurance and Leads
// filters (the EPC list keeps its own, slightly different, comparison).
export function createdRange(dateFrom: string, dateTo: string): (createdAt: string) => boolean {
  const fromT = dateFrom ? Date.parse(dateFrom + "T00:00:00") : null;
  const toT   = dateTo ? Date.parse(dateTo + "T23:59:59.999") : null;
  return (createdAt) => {
    const t = Date.parse(createdAt);
    if (fromT != null && !(t >= fromT)) return false;
    if (toT != null && !(t <= toT)) return false;
    return true;
  };
}

// Filter-dropdown options: the distinct names present in the list, A→Z ("—" skipped).
export function nameOptions<T>(rows: T[], nameOf: (r: T) => string): { value: string; label: string }[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const name = nameOf(r);
    if (name && name !== "—") seen.add(name);
  }
  return [...seen].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));
}

// Created on — date bold dark, time smaller grey beneath.
export function CreatedOnCell({ at }: { at: string }) {
  return (
    <td className="px-3 py-3 text-center">
      <p className="text-[13px] font-semibold text-cc-ink">{fmtDate(at)}</p>
      <p className="text-[11px] text-cc-muted mt-0.5">{fmtAddedTime(at)}</p>
    </td>
  );
}

// The table body while it has nothing to show: "Loading…" until the first
// read is done, then "No <noun> match." (rows exist, none pass the filters)
// or "No <noun> yet.".
export function EmptyRow({ cols, loaded, hasRows, noun }: { cols: number; loaded: boolean; hasRows: boolean; noun: string }) {
  return (
    <tr><td colSpan={cols} className="px-5 py-10 text-center text-cc-muted">{!loaded ? "Loading…" : hasRows ? `No ${noun} match.` : `No ${noun} yet.`}</td></tr>
  );
}

// Red count on the "Message to EPC" button — this admin's unseen EPC replies.
export function UnseenBadge({ n }: { n: number }) {
  if (!(n > 0)) return null;
  return (
    <span className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 grid place-items-center rounded-full bg-red-600 text-white text-[10px] font-bold leading-none">
      {n > 9 ? "9+" : n}
    </span>
  );
}

// Back from a row's View page: on mount (and after rows load) restore the
// saved scroll position and briefly highlight the last-viewed row, then clear
// both sessionStorage keys so a fresh session doesn't inherit stale state.
// Each list passes its own keys (written by its navigateToView).
export function useReturnHighlight(scrollKey: string, rowKey: string, rowCount: number): string | null {
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (rowCount === 0) return;
    const savedScroll = sessionStorage.getItem(scrollKey);
    const savedRow    = sessionStorage.getItem(rowKey);
    if (savedScroll) {
      const y = parseInt(savedScroll, 10);
      if (!isNaN(y)) window.scrollTo(0, y);
    }
    if (savedRow) {
      setHighlightId(savedRow);
      const t = window.setTimeout(() => setHighlightId(null), 2100);
      // Clear immediately — we've consumed it.
      sessionStorage.removeItem(rowKey);
      sessionStorage.removeItem(scrollKey);
      return () => window.clearTimeout(t);
    }
    sessionStorage.removeItem(rowKey);
    sessionStorage.removeItem(scrollKey);
  }, [rowCount, scrollKey, rowKey]);
  return highlightId;
}

// The returned-to row's tint, fading out once the highlight clears.
export function highlightRowStyle(on: boolean): CSSProperties {
  return { transition: "background-color 2s ease-out", backgroundColor: on ? "var(--acc-tint)" : undefined };
}

// Back from a row's View page: restore the filter/search/sort state its
// navigateToView saved under `key`, so the list comes back filtered the same
// way. Mount-only, and the key is consumed at once so a fresh visit is clean.
// `apply` sets the tab's own filter state from the parsed object.
export function useRestoredFilters(key: string, apply: (f: Record<string, unknown>) => void) {
  useEffect(() => {
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    sessionStorage.removeItem(key);
    try {
      apply(JSON.parse(raw) as Record<string, unknown>);
    } catch { /* ignore malformed */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
