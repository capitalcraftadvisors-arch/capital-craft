"use client";

// Chat kit · the Partner Portal chats' chrome (navy), used by
// dashboard/apply/chat and dashboard/insurance/[id]/chat. Both pages had these
// pieces the same up to the props below. The navy colours the other kit pieces
// share come from PARTNER_THEME; the ones only this chrome uses (header, live
// dot, progress bar, typing dots, input focus) are written here directly.
//
//   PartnerChatHeader    header bar (logo, title, subtitle, %) + progress bar
//   PartnerTypingBubble  the bot's "…" while something runs
//   PartnerComposer      the round text input + send button (outlined paper-plane)
//
// Page background: PARTNER_THEME.canvas. The message bubbles differ between the
// two chats (edit vs ↺ replace links, file chips) and stay local.

import type { ReactNode, RefObject } from "react";
import { PARTNER_THEME as THEME } from "./theme";

/**
 * `title` / `subtitle` follow "Capital Craft · " and the live dot; `children` go
 * after the % (the loan chat's ↶ undo button). `hideBrokenLogo`: hide the logo
 * if the image fails to load (the loan chat does; the insurance chat doesn't).
 */
export function PartnerChatHeader({ title, subtitle, progress, onBack, hideBrokenLogo = false, children }: {
  title: ReactNode; subtitle: ReactNode; progress: number; onBack: () => void; hideBrokenLogo?: boolean; children?: ReactNode;
}) {
  return (
    <>
      <header className="shrink-0 px-4 sm:px-5 py-2.5 bg-navy-ink text-white flex items-center gap-3 shadow-sm">
        <button onClick={onBack} className="p-1 -ml-1 text-white/80 hover:text-white text-[20px] leading-none" aria-label="Back">←</button>
        <img src="/brand/capital-craft-mark.png" alt="" className="w-9 h-9 rounded-full bg-white object-contain p-1 shadow-sm"
          onError={hideBrokenLogo ? (e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; } : undefined} />
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[15px] leading-tight truncate">Capital Craft · {title}</div>
          <div className="text-[11.5px] text-white/70 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#93b4ff]" /> {subtitle}</div>
        </div>
        <span className="text-[11px] text-white/60 tabular-nums">{progress}%</span>
        {children}
      </header>
      <div className="h-1.5 bg-black/15 shrink-0"><div className="h-1.5 bg-[#5b8def] rounded-r-full transition-all duration-500" style={{ width: progress + "%" }} /></div>
    </>
  );
}

/** The bot's "…" bubble. */
export function PartnerTypingBubble() {
  return (
    <div className="self-start">
      <div className={`rounded-2xl rounded-tl-md bg-white border ${THEME.cardBorder} px-4 py-3 shadow-sm flex gap-1`}>
        <span className="w-2 h-2 rounded-full bg-navy/40 animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-2 h-2 rounded-full bg-navy/40 animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-2 h-2 rounded-full bg-navy/40 animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

/** Round text input + send button. Enter sends, like the button. */
export function PartnerComposer({ inputRef, value, onChange, onSend, inputMode, placeholder }: {
  inputRef?: RefObject<HTMLInputElement>; value: string; onChange: (v: string) => void; onSend: () => void;
  inputMode: "text" | "numeric" | "decimal"; placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 flex items-center border border-line rounded-full bg-white overflow-hidden focus-within:border-navy focus-within:ring-2 focus-within:ring-navy/15">
        <input
          ref={inputRef} autoFocus value={value}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSend(); }}
          placeholder={placeholder}
          className="flex-1 min-w-0 px-4 py-2.5 text-[14px] bg-transparent focus:outline-none" />
      </div>
      <button onClick={onSend} className={`w-11 h-11 shrink-0 rounded-full ${THEME.accentBg} text-white grid place-items-center ${THEME.accentBgHover} shadow-sm`} aria-label="Send">
        <OutlineSendIcon />
      </button>
    </div>
  );
}

// Outlined paper-plane on the composer's round button.
function OutlineSendIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>;
}
