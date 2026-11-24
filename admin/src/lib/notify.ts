// notify — the app's small pop-up messages (toasts), in place of window.alert().
//
//   import { notify } from "@/lib/notify";
//
//   notify.success("Saved.");
//   notify.error(errText(e));
//   notify.info("Nothing to download yet.");
//   notify.error("Couldn't upload the file.\nIt is bigger than 10 MB.");  // title + description
//
// A message with a line break shows its first line as the title and the rest
// as the description (line breaks kept); any other message is shown exactly as
// written. Nothing blocks: the code after notify.x() runs at once (unlike
// alert(), which waited for OK). A message with a description, or a long one,
// stays up for LONG_MS instead of sonner's 4 seconds: it may be a list to read
// (for example the documents still to upload).
//
// The toasts are drawn by sonner's <Toaster/> in the root layout
// (app/layout.tsx), so they work on every page and stay up across client-side
// page changes (router.push). A full page load (window.location…) clears them.

import { toast } from "sonner";

/**
 * "Title\nrest…" → { title: "Title", body: "rest…" }; no line break → { title: message, body: "" }.
 * Blank lines right after the title are dropped ("Title\n\nrest…" → body "rest…").
 */
export function splitMessage(message: string): { title: string; body: string } {
  const i = message.indexOf("\n");
  if (i < 0) return { title: message, body: "" };
  return { title: message.slice(0, i).replace(/\r$/, ""), body: message.slice(i + 1).replace(/^(?:\r?\n)+/, "") };
}

type Kind = "success" | "error" | "info";

const LONG_MS = 12000;

function show(kind: Kind, message: string): void {
  const { title, body } = splitMessage(message);
  const duration = body || message.length > 80 ? LONG_MS : undefined; // undefined = sonner's default
  if (!body) toast[kind](message, { duration });
  else toast[kind](title, { description: body, descriptionClassName: "whitespace-pre-line", duration });
}

export const notify = {
  /** Red — something went wrong. */
  error: (message: string) => show("error", message),
  /** Green — something worked. */
  success: (message: string) => show("success", message),
  /** Blue — neutral information. */
  info: (message: string) => show("info", message),
};
