// Chat kit · the clock and date labels of the two team chats
// (admin/app/intake, admin/epc/intake). The Partner Portal loan chat shows a
// different clock format ("04:05 pm") and keeps its own.

/** "4:05 pm" — the time under a message. */
export function nowLabel(): string {
  return new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
}

/** "Today · 24 November 2026" — the date chip at the top of the chat. */
export function todayLabel(): string {
  return "Today · " + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}
