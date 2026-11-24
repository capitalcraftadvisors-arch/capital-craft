"use client";

// Chat kit · the frame pieces every chat page is built from.
//
//   ChatMessages   the scrolling message column          all four chats
//   ChatDock       the bar under it with the controls    all four chats
//   ChatError      the red one-line error                all four chats
//   EditingBanner  "Editing your answer · Cancel"        admin/app/intake, admin/epc/intake,
//                                                       dashboard/insurance/[id]/chat
//
// (all four = admin/app/intake, admin/epc/intake, dashboard/apply/chat,
//  dashboard/insurance/[id]/chat)

import type { ReactNode, RefObject } from "react";
import type { ChatTheme } from "./theme";

/** The scrolling message column. `scrollRef` comes from useScrollToBottom. */
export function ChatMessages({ scrollRef, children }: { scrollRef: RefObject<HTMLDivElement>; children: ReactNode }) {
  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4">
      <div className="max-w-xl mx-auto py-4 flex flex-col gap-1.5">
        {children}
        <div className="h-2" />
      </div>
    </div>
  );
}

/**
 * The frosted bar under the messages that holds the active question's controls.
 * `cap` limits its height (it then scrolls inside) — the loan chats use
 * max-h-[75vh], the insurance chat max-h-[60vh]; the EPC onboarding chat (and the
 * loan intake's edit-intro bar) have no cap.
 */
export function ChatDock({ cap, children }: { cap?: "max-h-[75vh]" | "max-h-[60vh]"; children: ReactNode }) {
  return (
    <div className={cap ? `shrink-0 ${cap} overflow-y-auto bg-white/85 backdrop-blur border-t border-line` : "shrink-0 bg-white/85 backdrop-blur border-t border-line"}>
      <div className="max-w-xl mx-auto px-3 sm:px-4 py-3">{children}</div>
    </div>
  );
}

/** The red error line inside the message column. */
export function ChatError({ text }: { text: string }) {
  return <div className="self-center text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 my-1">{text}</div>;
}

/** Top line of the dock while an earlier answer is being changed. */
export function EditingBanner({ theme, label = "Editing your answer", onCancel }: { theme: ChatTheme; label?: string; onCancel: () => void }) {
  return (
    <div className="flex items-center justify-between mb-2 text-[12px]">
      <span className={`${theme.accentText} font-semibold`}>{label}</span>
      <button onClick={onCancel} className="text-text-muted hover:text-text">Cancel</button>
    </div>
  );
}
