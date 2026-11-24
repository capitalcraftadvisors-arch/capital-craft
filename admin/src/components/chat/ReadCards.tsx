"use client";

// Chat kit · the "📄 Read from the document" cards of the team (admin) chats,
// used by admin/app/intake (LOAN_INTAKE_THEME) and admin/epc/intake
// (EPC_INTAKE_THEME):
//
//   ReadCardFrame  the card outline + its header band (icon, title)
//   EditableRows   "label … value ✎" rows — ✎ opens an input in the row, Enter /
//                  Save writes it, Escape closes it
//   FetchedCard    the permanent card left in the chat after "Looks good" — every
//                  value with a form field is editable in place (✎)
//   ConfirmCard    the card shown right after a read: thumbnails, the values, a
//                  note, "Looks good →" / "Re-attach". The value rows are the
//                  page's own children — the loan intake's are editable, the EPC
//                  chat's are read-only.
//
// The loan intake's info-sheet card (SheetConfirmCard, in its page) is built
// from ReadCardFrame + EditableRows too. The insurance chat's read card looks
// different and stays in its page; the document table's smaller rows are
// FieldRows in DocSlotTable.tsx.

import { useState, type ReactNode } from "react";
import type { AdminChatTheme } from "./theme";
import type { ChatMsg, Fetched } from "./types";

/** The card outline + its header band. Defaults: "📄 Read from the document", max-w-[88%]. */
export function ReadCardFrame({ theme, icon = "📄", title = "Read from the document", width = "max-w-[88%]", children }: {
  theme: AdminChatTheme; icon?: string; title?: string; width?: "max-w-[88%]" | "max-w-[92%]"; children: ReactNode;
}) {
  return (
    <div className={`self-start w-full ${width} rounded-2xl rounded-tl-md border ${theme.cardBorder} bg-white shadow-sm overflow-hidden`}>
      <div className={`px-3.5 py-2 ${theme.headBg} border-b ${theme.headBorder} flex items-center gap-2`}>
        <span className="text-[12px]">{icon}</span>
        <span className={`text-[12.5px] font-semibold ${theme.ink}`}>{title}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * The value rows (no wrapper — the card's column holds them). A row with a
 * `field` can be changed: `onSave(field, value)`. `ok: false` shows "not found";
 * `display` (if set) is shown instead of `value` — the editor always starts
 * from `value`.
 */
export function EditableRows({ theme, rows, onSave }: {
  theme: AdminChatTheme; rows: (Fetched & { display?: string })[]; onSave: (field: string, value: string) => void;
}) {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [val, setVal] = useState("");
  return (
    <>
      {rows.map((f, i) => (
        <div key={i} className="flex items-center justify-between gap-3 text-[13px] min-h-[24px]">
          <span className="text-text-muted shrink-0">{f.label}</span>
          {editKey === `${i}:${f.field}` && f.field ? (
            <span className="flex items-center gap-1.5">
              <input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { onSave(f.field!, val.trim()); setEditKey(null); } if (e.key === "Escape") setEditKey(null); }}
                className={`border ${theme.accentBorder} rounded-lg px-2.5 py-1 text-[13px] w-44 text-right outline-none`} />
              <button onClick={() => { onSave(f.field!, val.trim()); setEditKey(null); }} className={`${theme.accentText} text-[12px] font-semibold`}>Save</button>
            </span>
          ) : (
            <span className="flex items-center gap-2 min-w-0">
              {f.ok
                ? <span className="text-text font-medium text-right break-words">{f.display ?? f.value}</span>
                : <span className="text-amber-600 text-[12px] italic">not found</span>}
              {f.field && (
                <button onClick={() => { setEditKey(`${i}:${f.field}`); setVal(f.ok ? f.value : ""); }} className={`opacity-60 hover:opacity-100 ${theme.accentText} text-[11px] hover:underline shrink-0`} aria-label="Edit">✎</button>
              )}
            </span>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * The permanent card (a message with `fetched`). Saving a value calls
 * `onSave(messageId, field, value)`; the page writes it and updates the message.
 * Nothing is masked except what the reader never returns in full (Aadhaar).
 */
export function FetchedCard({ theme, m, onSave }: { theme: AdminChatTheme; m: ChatMsg; onSave: (msgId: string, field: string, value: string) => void }) {
  return (
    <ReadCardFrame theme={theme}>
      <div className="p-3.5 flex flex-col gap-2">
        <EditableRows theme={theme} rows={m.fetched ?? []} onSave={(field, value) => onSave(m.id, field, value)} />
      </div>
    </ReadCardFrame>
  );
}

/**
 * The card right after a document is read. `children` = the value rows (the
 * page renders them — editable or not); `thumbs` = the attached images.
 */
export function ConfirmCard({ theme, thumbs, note, onLooksGood, onReattach, children }: {
  theme: AdminChatTheme; thumbs: (string | null)[]; note: string;
  onLooksGood: () => void; onReattach: () => void; children: ReactNode;
}) {
  return (
    <ReadCardFrame theme={theme}>
      {thumbs.some(Boolean) && (
        <div className="px-3.5 pt-3 flex gap-2">
          {thumbs.filter(Boolean).map((t, i) => (
            <img key={i} src={t as string} alt="" className="w-14 h-14 rounded-lg object-cover border border-line" />
          ))}
        </div>
      )}
      <div className="p-3.5 flex flex-col gap-1.5">
        {children}
        <p className="text-[11.5px] text-text-muted mt-1.5 leading-snug">{note}</p>
        <div className="flex flex-wrap gap-2 mt-1.5">
          <button onClick={onLooksGood} className={`px-3.5 py-1.5 rounded-lg ${theme.accentBg} text-white text-[12.5px] font-semibold ${theme.accentBgHover}`}>Looks good →</button>
          <button onClick={onReattach} className="px-3 py-1.5 rounded-lg border border-line text-[12.5px] text-text-mid hover:bg-bg-soft">Re-attach</button>
        </div>
      </div>
    </ReadCardFrame>
  );
}
