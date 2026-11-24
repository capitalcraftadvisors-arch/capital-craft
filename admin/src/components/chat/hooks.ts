"use client";

// Chat kit · hooks.
//
//   useScrollToBottom  all four chats (admin/app/intake, admin/epc/intake,
//                      dashboard/apply/chat, dashboard/insurance/[id]/chat)
//   useChatLog         the two team chats (admin/app/intake, admin/epc/intake)
//   useRmFirstName     the two team chats
//
// None of these sends a request.

import { useCallback, useEffect, useMemo, useRef, useState, type DependencyList, type RefObject } from "react";
import { getBusiness } from "@/lib/auth";
import { nowLabel } from "./time";
import type { ChatMsg, Fetched } from "./types";

/**
 * Keeps the message list pinned to the newest message. Put the returned ref on
 * the scrolling element (ChatMessages' `scrollRef`). It re-runs whenever a value
 * in `deps` changes — pass the same list the page's own effect had.
 *
 * Default: every scroll animates (the Partner Portal chats).
 * `instantFirst` (the team chats): scrolls jump instantly until the first one
 * made with messages on screen (`hasMessages`) — so a restored chat opens at
 * the bottom — and animate after that.
 *
 * Call it where the page's old scroll effect sat, so effects keep their order.
 */
export function useScrollToBottom(deps: DependencyList, opts?: { instantFirst?: boolean; hasMessages?: boolean }): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const didFirstScroll = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: !opts?.instantFirst || didFirstScroll.current ? "smooth" : "auto" });
    if (opts?.instantFirst && opts.hasMessages) didFirstScroll.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/**
 * The team chats' message list and the ways a message is added or changed:
 *   pushBot(text, turnId)             — a turn's question, at most once per turnId
 *   pushUser(text, meta)              — the user's answer (meta: turnId, field, editable, files…)
 *   say(from, text)                   — any one-off line
 *   pushFetched(fields)               — the permanent "Read from the document" card ("Looks good")
 *   updateFetched(msgId, field, value) — a value changed on that card (✎ → Save)
 * `idRef` / `uid` are exposed for pages that restore a saved chat (they move the
 * id counter past the restored ids) or build messages themselves.
 */
export function useChatLog() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const idRef = useRef(0);
  const uid = () => "m" + ++idRef.current;
  const pushBot = useCallback((text: string, turnId: string) => {
    setMsgs((m) => (m.some((x) => x.from === "bot" && x.turnId === turnId) ? m : [...m, { id: uid(), from: "bot", text, time: nowLabel(), turnId }]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function pushUser(text: string, meta: Partial<ChatMsg> = {}) {
    setMsgs((m) => [...m, { id: uid(), from: "user", text, time: nowLabel(), ...meta }]);
  }
  function say(from: "bot" | "user", text: string) {
    setMsgs((m) => [...m, { id: uid(), from, text, time: nowLabel() }]);
  }
  function pushFetched(fetched: Fetched[]) {
    setMsgs((m) => [...m, { id: uid(), from: "bot", time: nowLabel(), fetched }]);
  }
  function updateFetched(msgId: string, field: string, value: string) {
    setMsgs((m) => m.map((x) => (x.id === msgId ? { ...x, fetched: x.fetched!.map((ff) => (ff.field === field ? { ...ff, value, ok: !!value } : ff)) } : x)));
  }
  return { msgs, setMsgs, idRef, uid, pushBot, pushUser, say, pushFetched, updateFetched };
}

/** The signed-in team member's first name, shown under their messages ("You" if unknown). */
export function useRmFirstName(): string {
  return useMemo(() => {
    const full = (getBusiness()?.contact_name || "").trim();
    return full ? full.split(" ")[0] : "You";
  }, []);
}
