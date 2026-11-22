// One-tap WhatsApp from the partner portal (Partner Portal v2, paid — lib/subscription):
// the EPC's own WhatsApp opens with a ready message (Hinglish, editable before
// sending). A quotation goes as a 90-day link to its PDF (/api/epc/quotes/<id>/share).

import { getToken } from "./auth";
import { openWhatsApp } from "./wa-link";

/** A lead's follow-up message. */
export function whatsAppLead(name: string, mobile: string | null, org: string) {
  openWhatsApp(null, mobile, `Namaste ${name} ji,\n\n${org} se baat kar rahe hain. Aapke rooftop solar ke baare mein aapse baat karni thi. Aap kab baat kar sakte hain?`);
}

/** A saved quotation, as a link to its PDF. */
export async function whatsAppQuote(id: string) {
  // Open the tab now (while the click counts); it goes to WhatsApp once the link is ready.
  const win = window.open("", "_blank");
  if (win) win.opener = null;
  try {
    const res = await fetch(`/api/epc/quotes/${id}/share`, { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't share the quotation.");
    const size = j.kw ? `${+Number(j.kw).toFixed(2)} kW ` : "";
    openWhatsApp(win, j.mobile, `Namaste ${j.customer} ji,\n\nAapke ${size}rooftop solar system ka quotation yeh raha:\n${j.url}\n\n${j.org}`);
  } catch (e) {
    win?.close();
    throw e;
  }
}
