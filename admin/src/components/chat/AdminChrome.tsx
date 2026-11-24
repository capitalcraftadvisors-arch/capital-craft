"use client";

// Chat kit · the team (admin) chats' chrome, used by admin/app/intake (green,
// LOAN_INTAKE_THEME) and admin/epc/intake (blue, EPC_INTAKE_THEME):
//
//   AdminChatHeader   header bar ("CC" avatar, title, subtitle, %, ✕) + progress bar
//   AdminChatLoading  full-screen spinner while a saved chat / EPC loads
//   AdminComposer     the round text input, "Skip" / "Don't have it" and the send button
//   DonePanel         the "Open the profile →" block at the end of a chat
//   ChoiceGrid        the two-column grid of choice buttons
//
// The Partner Portal chats have their own header + text input — see PartnerChrome.tsx.

import type { ReactNode, RefObject } from "react";
import type { AdminChatTheme } from "./theme";
import type { Choice } from "./types";

/**
 * Header bar + the progress bar under it. `title` / `subtitle` follow
 * "Capital Craft · " and the live dot. `children` go between the % and the ✕
 * (the loan intake's ↶ undo button).
 */
export function AdminChatHeader({ theme, title, subtitle, progress, onBack, onClose, children }: {
  theme: AdminChatTheme; title: ReactNode; subtitle: ReactNode; progress: number;
  onBack: () => void; onClose: () => void; children?: ReactNode;
}) {
  return (
    <>
      <header className={`shrink-0 px-3 sm:px-5 py-2.5 ${theme.headerBg} text-white flex items-center gap-3 shadow-sm`}>
        <button onClick={onBack} className="p-1 -ml-1 text-white/80 hover:text-white text-[20px] leading-none">←</button>
        <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${theme.avatar} ring-2 ring-white/15 flex items-center justify-center font-display font-bold text-[15px]`}>CC</div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[15px] leading-tight truncate">Capital Craft · {title}</div>
          <div className="text-[11.5px] text-white/70 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${theme.liveDot}`} /> {subtitle}
          </div>
        </div>
        <span className="text-[11px] text-white/60 tabular-nums">{progress}%</span>
        {children}
        <button onClick={onClose} className="w-8 h-8 -mr-1 rounded-full hover:bg-white/10 grid place-items-center text-white/80 hover:text-white text-[18px] leading-none" aria-label="Close chat" title="Close">✕</button>
      </header>
      <div className="h-2 bg-black/15 shrink-0"><div className={`h-2 ${theme.bar} rounded-r-full transition-all duration-500`} style={{ width: progress + "%" }} /></div>
    </>
  );
}

/** Full-screen spinner on the chat canvas ("Restoring your chat…", "Loading the EPC…"). */
export function AdminChatLoading({ theme, label }: { theme: AdminChatTheme; label: string }) {
  return (
    <div className="h-screen grid place-items-center" style={theme.canvas}>
      <div className={`flex flex-col items-center gap-3 ${theme.ink}`}>
        <div className={`w-10 h-10 rounded-full border-2 ${theme.spinner} animate-spin`} />
        <div className="text-[13px]">{label}</div>
      </div>
    </div>
  );
}

/**
 * The text input row. Enter sends, like the round button; Escape cancels an edit.
 * While `editing` an earlier answer the skip button is hidden and the button
 * shows ✓. `skipLabel` unset = no skip button (the page decides when it shows).
 */
export function AdminComposer({ theme, inputRef, value, onChange, onSend, editing, onCancelEdit, placeholder, skipLabel, onSkip }: {
  theme: AdminChatTheme; inputRef: RefObject<HTMLInputElement>; value: string; onChange: (v: string) => void; onSend: () => void;
  editing: boolean; onCancelEdit: () => void; placeholder: string; skipLabel?: string; onSkip: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} autoFocus value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSend(); if (e.key === "Escape" && editing) onCancelEdit(); }}
        placeholder={placeholder} className={`flex-1 border border-line rounded-full px-4 py-2.5 text-[14px] bg-white focus:outline-none ${theme.focusBorder} focus:ring-2 ${theme.focusRing}`} />
      {!editing && skipLabel && <button onClick={() => onSkip()} className="px-3 py-2.5 text-[13px] text-text-muted hover:text-text whitespace-nowrap" title="Continue without this — you can add it later">{skipLabel}</button>}
      <button onClick={() => onSend()} className={`w-11 h-11 shrink-0 rounded-full ${theme.accentBg} text-white grid place-items-center ${theme.accentBgHover} shadow-sm`} aria-label="Send">
        {editing ? "✓" : <SendIcon />}
      </button>
    </div>
  );
}

// Filled send arrow on the composer's round button.
function SendIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12l16-8-6 16-2.5-6.5L4 12z" fill="currentColor" /></svg>;
}

/** End-of-chat block: a line, the main button, and an optional small link under it. */
export function DonePanel({ theme, message, actionLabel, onAction, secondaryLabel, onSecondary }: {
  theme: AdminChatTheme; message: ReactNode; actionLabel: string; onAction: () => void;
  secondaryLabel?: string; onSecondary?: () => void;
}) {
  return (
    <div className="self-stretch mt-3 flex flex-col items-center gap-2">
      <div className="text-[13px] text-text-mid text-center">{message}</div>
      <button onClick={onAction} className={`px-5 py-2.5 rounded-xl ${theme.accentBg} text-white text-[14px] font-semibold shadow-sm ${theme.accentBgHover}`}>{actionLabel}</button>
      {secondaryLabel && <button onClick={onSecondary} className="text-[12px] text-text-muted hover:text-text">{secondaryLabel}</button>}
    </div>
  );
}

/** Two-column grid of choice buttons (label + optional sub-line). */
export function ChoiceGrid({ theme, choices, onPick }: { theme: AdminChatTheme; choices: Choice[]; onPick: (c: Choice) => void }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {choices.map((c) => (
        <button key={c.value} onClick={() => onPick(c)} className={`text-left px-4 py-3 rounded-xl border border-line bg-white ${theme.accentBorderHover} ${theme.tintBgHover} transition`}>
          <div className="text-[14px] font-semibold text-text">{c.label}</div>{c.sub && <div className="text-[12px] text-text-muted">{c.sub}</div>}
        </button>
      ))}
    </div>
  );
}
