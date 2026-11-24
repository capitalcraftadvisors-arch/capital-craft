"use client";

// Chat kit · the document TABLE's look, shared by admin/app/intake
// (LOAN_INTAKE_THEME) and dashboard/apply/chat (PARTNER_THEME):
//
//   DocSlotTable   Document | Upload | Don't have it — one row per slot, plus a
//                  full-width strip under a unit's last row
//   AddFileButton  the dashed "＋ Add" box (tap or drop a file)
//   SlotFileChip   an attached file: thumbnail / 📄 + "Replace"
//   ReadingLine    "◌ Reading…"
//   FieldRows      the small editable "label … value ✎" rows under a read unit
//   ContinueRow    the "Done / Continue →" button + the hint shown while it's off
//
// ONLY the markup is shared. What a slot reads, when a row counts as done,
// replace / skip rules, reads, uploads — all of that differs between the two
// chats and stays in each page's own DocTable.

import { Fragment, useState, type ReactNode } from "react";
import type { ChatTheme } from "./theme";
import type { Fetched } from "./types";

/** What the table needs from a page's row type. `required` hides the skip tick. */
export type SlotRow = { slot: string; label: string; lastOfUnit?: boolean; required?: boolean };

/**
 * `cell(row)` = the Upload column; `strip(row)` = the line under a unit's last
 * row (called only for `lastOfUnit` rows; null = no strip).
 */
export function DocSlotTable<R extends SlotRow>({ theme, rows, skipped, onToggleSkip, cell, strip }: {
  theme: ChatTheme; rows: R[]; skipped: Partial<Record<string, boolean>>; onToggleSkip: (slot: R["slot"]) => void;
  cell: (r: R) => ReactNode; strip: (r: R) => ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-white overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className={`${theme.headBg} border-b ${theme.headBorder} text-[11px] font-semibold ${theme.ink}`}>
            <th className="text-left font-semibold px-3 py-2 w-full">Document</th>
            <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">Upload</th>
            <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Don&apos;t have it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const s = r.lastOfUnit ? strip(r) : null;
            return (
              <Fragment key={r.slot}>
                <tr className={i > 0 ? "border-t border-line/70" : ""}>
                  <td className="px-3 py-2 align-middle text-[12.5px] text-text leading-snug">{r.label}</td>
                  <td className="px-2 py-2 align-middle whitespace-nowrap">{cell(r)}</td>
                  <td className="px-3 py-2 align-middle text-right">
                    {!r.required && <input type="checkbox" checked={!!skipped[r.slot]} onChange={() => onToggleSkip(r.slot)} className={`w-4 h-4 ${theme.checkbox} cursor-pointer align-middle`} aria-label={`Don't have ${r.label}`} />}
                  </td>
                </tr>
                {s && <tr><td colSpan={3} className="px-3 pb-2.5 pt-0">{s}</td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Dashed "＋ Add" box — tap to pick, or drop a file on it. Images and PDFs. */
export function AddFileButton({ theme, onFile }: { theme: ChatTheme; onFile: (f: File) => void }) {
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      className={`inline-flex items-center gap-1 rounded-lg border border-dashed border-line ${theme.accentBorderHover} bg-white px-2.5 py-1.5 cursor-pointer text-[11.5px] font-semibold ${theme.accentText}`}>
      <span className="text-[13px] leading-none">＋</span> Add
      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />
    </label>
  );
}

/** An attached (or on-file) document: its thumbnail, else 📄, and "Replace". */
export function SlotFileChip({ theme, thumb, onReplace }: { theme: ChatTheme; thumb?: string | null; onReplace: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {thumb
        ? <img src={thumb} alt="" className="w-8 h-8 rounded-md object-cover border border-line" />
        : <span className={`w-8 h-8 rounded-md ${theme.tintBg} border ${theme.cardBorder} grid place-items-center text-[13px]`}>📄</span>}
      <button onClick={onReplace} className={`${theme.accentText} text-[11px] font-semibold hover:underline`}>Replace</button>
    </span>
  );
}

/** "◌ Reading…" while a unit's read runs. */
export function ReadingLine({ theme }: { theme: ChatTheme }) {
  return (
    <span className="flex items-center gap-2 text-[11.5px] text-text-muted">
      <span className={`w-3.5 h-3.5 rounded-full border-2 ${theme.spinner} animate-spin`} /> Reading…
    </span>
  );
}

/**
 * Small editable read-out rows. A row with a `field` can be changed (✎) —
 * `onEdit(field, value)`; `ok: false` shows "not found".
 * (dashboard/apply/chat builds its rows as { label, field, value, ok: !!value }.)
 */
export function FieldRows({ theme, fields, onEdit }: { theme: ChatTheme; fields: Fetched[]; onEdit: (field: string, value: string) => void }) {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [val, setVal] = useState("");
  return (
    <div className="flex flex-col gap-1.5">
      {fields.map((f, i) => (
        <div key={f.field || f.label} className="flex items-center justify-between gap-3 text-[12.5px] min-h-[22px]">
          <span className="text-text-muted shrink-0">{f.label}</span>
          {editKey === `${i}:${f.field}` && f.field ? (
            <span className="flex items-center gap-1.5">
              <input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { onEdit(f.field!, val.trim()); setEditKey(null); } if (e.key === "Escape") setEditKey(null); }}
                className={`border ${theme.accentBorder} rounded-lg px-2.5 py-1 text-[12.5px] w-40 text-right outline-none`} />
              <button onClick={() => { onEdit(f.field!, val.trim()); setEditKey(null); }} className={`${theme.accentText} text-[11.5px] font-semibold`}>Save</button>
            </span>
          ) : (
            <span className="flex items-center gap-2 min-w-0">
              {f.ok ? <span className="text-text font-medium text-right break-words">{f.value}</span> : <span className="text-amber-600 text-[11.5px] italic">not found</span>}
              {f.field && <button onClick={() => { setEditKey(`${i}:${f.field}`); setVal(f.ok ? f.value : ""); }} className={`opacity-60 hover:opacity-100 ${theme.accentText} text-[11px] hover:underline shrink-0`} aria-label="Edit">✎</button>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** The step's main button; while it's `disabled`, `hint` explains what's missing. */
export function ContinueRow({ theme, label, onClick, disabled, hint }: {
  theme: ChatTheme; label: ReactNode; onClick: () => void; disabled: boolean; hint: string;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={onClick} disabled={disabled} className={`px-4 py-2 rounded-lg ${theme.accentBg} text-white text-[13px] font-semibold ${theme.accentBgHover} disabled:opacity-50`}>{label}</button>
      {disabled && <span className="text-[11px] text-text-muted">{hint}</span>}
    </div>
  );
}
