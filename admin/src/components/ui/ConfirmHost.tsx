"use client";

// The OK / Cancel pop-up behind askConfirm() (lib/confirm.ts). Mounted ONCE, in
// the root layout (app/layout.tsx) — pages never render it themselves; they
// just `await askConfirm("…")`.
//
//   Title   the message's first line
//   Body    the rest of the message, line breaks kept (none → no body)
//   Cancel  outline button — also Escape and a click on the dark backdrop
//   OK      blue button, or the red danger one with { danger: true } — also Enter
//
// "Cancel" and "OK" are the words the browser's own confirm box used, so
// nothing new to read. The look is the app's small confirm pop-ups
// (ConfirmDeleteModal): white card, footer row with the buttons on the right.
// It sits above every other pop-up (z-[100]) and shows one question at a time.
//
// Answers in the first SETTLE_MS after a question opens are ignored: the second
// click of a double-click on the button that asked would otherwise land on the
// pop-up (Cancel by the backdrop, or OK unread). A page change (Back, a link)
// cancels every open question — see cancelAllConfirms in lib/confirm.ts.

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { answerConfirm, cancelAllConfirms, subscribeConfirm, type ConfirmRequest } from "@/lib/confirm";
import { splitMessage } from "@/lib/notify";

const OVERLAY = "fixed inset-0 z-[100] bg-black/40 grid place-items-center p-4";
const SETTLE_MS = 400;

/** Answer question `id` — unless it opened (at `openedAt`) less than SETTLE_MS ago. */
function answerIfSettled(id: number, openedAt: number, ok: boolean) {
  if (performance.now() - openedAt >= SETTLE_MS) answerConfirm(id, ok);
}

export default function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  useEffect(() => subscribeConfirm(setReq), []);
  // The page changed: the questions it asked are answered Cancel.
  const pathname = usePathname();
  useEffect(() => () => cancelAllConfirms(), [pathname]);
  // A new key per question, so each one opens fresh (focus, key handling).
  return req ? <ConfirmDialog key={req.id} req={req} /> : null;
}

function ConfirmDialog({ req }: { req: ConfirmRequest }) {
  const titleId = useId();
  const bodyId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const openedAt = useRef(performance.now());
  const { title, body } = splitMessage(req.message);

  // While the question is up the keyboard belongs to it, as with the browser's
  // own box: Escape = Cancel, Enter = OK (a focused Cancel/OK button keeps its
  // own Enter), and no key reaches the page behind — its shortcuts, or another
  // pop-up's Escape. Tab still moves between the two buttons (Modal keeps it in).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") return;
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        answerIfSettled(req.id, openedAt.current, false);
      } else if (e.key === "Enter" && !e.repeat && !e.isComposing) {
        const t = e.target;
        const onOwnButton = t instanceof Element && !!t.closest("button") && !!boxRef.current?.contains(t);
        if (!onOwnButton) { e.preventDefault(); answerIfSettled(req.id, openedAt.current, true); }
      }
    };
    window.addEventListener("keydown", onKey, true); // capture: before any page handler
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req.id]);

  return (
    <Modal
      onClose={() => answerIfSettled(req.id, openedAt.current, false)}
      overlayClassName={OVERLAY}
      className="bg-white rounded-card w-full max-w-[420px] shadow-2xl overflow-hidden"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
    >
      <div ref={boxRef}>
        <div className="p-6">
          <h2 id={titleId} className="font-display font-bold text-[17px] text-text">{title}</h2>
          {body && <p id={bodyId} className="mt-2 text-[13px] text-text-mid whitespace-pre-line">{body}</p>}
        </div>
        <div className="border-t border-line px-6 py-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => answerIfSettled(req.id, openedAt.current, false)}>Cancel</Button>
          <Button type="button" variant={req.danger ? "danger" : "primary"} onClick={() => answerIfSettled(req.id, openedAt.current, true)}>OK</Button>
        </div>
      </div>
    </Modal>
  );
}
