// askConfirm() — the app's own OK / Cancel pop-up, in place of window.confirm().
//
//   import { askConfirm } from "@/lib/confirm";
//
//   if (!(await askConfirm("Delete this document?\nIt can't be undone.", { danger: true }))) return;
//
// It returns a Promise: true = OK, false = Cancel (also Escape or a click on
// the dark backdrop). Enter = OK. The first line of the message is the title,
// the rest is the body (line breaks kept). `danger` makes OK the red button —
// use it for deletes, removals and other things that can't be undone.
//
// Shown by <ConfirmHost/> (components/ui/ConfirmHost.tsx), mounted once in the
// root layout, so it works on every page: team console, Partner Portal,
// onboarding. Several asks at once queue up and show one at a time, in order.
// Moving to another page (Back, a link) answers every open question with
// Cancel, so OK can never run the old page's action.
//
// This file is only the queue; the look is in ConfirmHost.

export type ConfirmOptions = { danger?: boolean };

/** One waiting question. `id` is unique (the host uses it as the pop-up's key). */
export type ConfirmRequest = { id: number; message: string; danger: boolean };

type Waiting = ConfirmRequest & { resolve: (ok: boolean) => void };

const queue: Waiting[] = [];   // queue[0] is the one on screen
let show: ((req: ConfirmRequest | null) => void) | null = null; // the mounted host
let nextId = 1;

/** Ask an OK / Cancel question. Resolves true for OK, false for Cancel. */
export function askConfirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false); // never asked on the server
  return new Promise<boolean>((resolve) => {
    queue.push({ id: nextId++, message, danger: !!opts.danger, resolve });
    if (queue.length === 1) show?.(queue[0]);
  });
}

/** ConfirmHost only: the person answered question `id` (the one on screen). A second answer to it is ignored. */
export function answerConfirm(id: number, ok: boolean): void {
  if (queue[0]?.id !== id) return;
  const done = queue.shift()!;
  show?.(queue[0] ?? null);
  done.resolve(ok);
}

/** ConfirmHost only: answer every waiting question with Cancel (the page changed). */
export function cancelAllConfirms(): void {
  const all = queue.splice(0);
  show?.(null);
  for (const q of all) q.resolve(false);
}

/** True while a question is on screen (a press then lands on it, not on the page). */
export function isConfirmOpen(): boolean {
  return queue.length > 0;
}

/** ConfirmHost only: start showing questions (including any already waiting). Returns the stop function. */
export function subscribeConfirm(fn: (req: ConfirmRequest | null) => void): () => void {
  show = fn;
  fn(queue[0] ?? null);
  return () => { if (show === fn) show = null; };
}
