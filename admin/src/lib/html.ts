// HTML escaping for the email bodies the server builds (lender packs, login
// passwords, follow-up reminders): any text typed by a person goes through esc().

/** `&`, `<`, `>` and `"` as HTML entities. */
export function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
