"use client";

// Chat kit · the team (admin) chats' message pieces, used by admin/app/intake
// (LOAN_INTAKE_THEME) and admin/epc/intake (EPC_INTAKE_THEME):
//
//   MessageRow         one bubble + its "name · time · edited ✓✓ ✎ edit" line
//   AdminTypingBubble  the bot's "…" while something runs
//   DateChip           "Today · 24 November 2026" at the top
//
// The Partner Portal chats draw their bubbles differently and keep their own
// (their typing bubble is in PartnerChrome.tsx).

import type { AdminChatTheme } from "./theme";
import { todayLabel } from "./time";
import type { ChatMsg } from "./types";

/**
 * One message. A user bubble shows the ✎ edit / ↺ replace link when `canEdit`
 * (default: `m.editable`). A message without a time (the EPC chat's answers
 * replayed from the profile) shows no "· time" part.
 */
export function MessageRow({ theme, m, rmName, onEdit, editingId, canEdit = m.editable }: {
  theme: AdminChatTheme; m: ChatMsg; rmName: string; onEdit: () => void; editingId: string | null;
  canEdit?: boolean;
}) {
  const isUser = m.from === "user";
  const beingEdited = editingId === m.id;
  return (
    <div className={["group flex flex-col max-w-[82%]", isUser ? "self-end items-end" : "self-start items-start"].join(" ")}>
      <div className={["relative px-3.5 py-2 rounded-2xl text-[14px] leading-snug shadow-sm break-words whitespace-pre-wrap w-fit max-w-full",
        isUser ? `${theme.accentBg} text-white rounded-br-md` : `bg-white ${theme.botText} rounded-bl-md border border-black/5`,
        beingEdited ? `ring-2 ${theme.editRing}` : ""].join(" ")}>
        {/* document receipt */}
        {m.files ? (
          <div className="flex flex-col gap-1.5">
            {m.files.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                {f.thumb ? <img src={f.thumb} alt="" className="w-10 h-10 rounded-md object-cover" />
                  : <span className="w-10 h-10 rounded-md bg-white/20 grid place-items-center text-[16px]">📎</span>}
                <span className="text-[13px] break-all">{f.name}</span>
              </div>
            ))}
          </div>
        ) : m.text}
      </div>
      <div className={["flex items-center gap-1.5 mt-0.5 px-1 text-[10.5px]", isUser ? `${theme.inkFaint} flex-row-reverse` : "text-text-muted"].join(" ")}>
        <span className="font-medium">{isUser ? rmName : "Capital Craft"}</span>
        {m.time && <span>· {m.time}</span>}
        {m.edited && <span>· edited</span>}
        {isUser && !m.files && <span className={theme.accentText}>✓✓</span>}
        {isUser && canEdit && (
          <button onClick={onEdit} className={`${theme.accentText} font-semibold hover:underline`} aria-label={m.files ? "Replace" : "Edit"}>{m.files ? "↺ replace" : "✎ edit"}</button>
        )}
      </div>
    </div>
  );
}

/** The bot's "…" bubble (same in both team chats — no theme). */
export function AdminTypingBubble() {
  return (
    <div className="self-start">
      <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-white border border-black/5 shadow-sm inline-flex gap-1">
        <Dot d="0" /><Dot d="150" /><Dot d="300" />
      </div>
    </div>
  );
}
function Dot({ d }: { d: string }) {
  return <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 animate-bounce" style={{ animationDelay: d + "ms" }} />;
}

/** "Today · …" chip at the top of the message column. */
export function DateChip({ theme }: { theme: AdminChatTheme }) {
  return (
    <div className="self-center my-2">
      <span className={`text-[11px] ${theme.inkSoft} bg-white/70 rounded-full px-3 py-1 shadow-sm`}>{todayLabel()}</span>
    </div>
  );
}
