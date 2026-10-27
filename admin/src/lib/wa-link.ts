// WhatsApp click-to-chat — opens the sender's own WhatsApp with a ready message
// (no API, no cost). Shared by My Day (Task Manager) and Sustera's customer
// applications.

/** A stored number as a 10-digit Indian mobile, or "" if not usable. */
export function waTel(mobile: string | null | undefined): string {
  const d = (mobile ?? "").replace(/\D/g, "");
  const ten = d.length > 10 ? d.slice(-10) : d;
  return ten.length === 10 ? ten : "";
}

/** The chat link for a 10-digit Indian mobile + message. */
export const waUrl = (ten: string, text: string) => `https://wa.me/91${ten}?text=${encodeURIComponent(text)}`;

// The message body can be written in English, Hinglish, or easy Hindi.
export type WaLang = "en" | "hinglish" | "hi";
export const WA_LANGS: { key: WaLang; label: string }[] = [
  { key: "en", label: "English" },
  { key: "hinglish", label: "Hinglish" },
  { key: "hi", label: "Hindi" },
];
