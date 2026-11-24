// Proposal links (epc_proposals, 0129) — Partner Portal v2. A saved quotation as
// a public page (/p/<token>) the customer opens from WhatsApp and accepts there
// (no login, no OTP) → the quotation becomes Accepted and a project starts.
// Made by the Owner, a Manager or Sales (/api/epc/quotes/<id>/proposal). The last
// link per quotation is kept in the tab, so pressing again reuses it instead of
// making another row; a changed quotation gets a new link.

import { authHeaders } from "./auth";
import { getCached, setCached } from "./list-cache";
import { openWhatsApp } from "./wa-link";
import type { QuoteDoc } from "./quote-calc";
import type { Segment } from "./quotation-brands";

export type ProposalLine = { description: string; make: string; qty: string };

/** What the customer sees (epc_proposals.snapshot), copied from the saved quotation. */
export type ProposalSnapshot = {
  customer_name: string; mobile: string; city: string; kw: number | null;
  total: number; net: number | null;          // net = after subsidy; null = no subsidy
  quote_no: string; quote_date: string; valid_till: string | null; segment: Segment;
  org: { name: string; phone: string; email: string };
  lines: ProposalLine[];
};

/** The public page's read (/api/proposal/<token>) — the snapshot without the mobile. */
export type PublicProposal = {
  snapshot: Omit<ProposalSnapshot, "mobile">;
  accepted_at: string | null; accepted_name: string | null;
  pdf: string | null;                         // the quotation PDF (a fresh 90-day link)
};

/** A proposal token: 32 hex characters. */
export const PROPOSAL_TOKEN_RE = /^[0-9a-f]{32}$/;

type Made = { v: string; url: string; org: string };
const key = (quoteId: string) => `proposal.${quoteId}`;
const TTL = 24 * 60 * 60_000;

// A short fingerprint of the saved quotation, so a changed one gets a new link.
function version(doc: QuoteDoc | undefined): string {
  if (!doc) return "";
  const s = JSON.stringify(doc);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}.${(h >>> 0).toString(36)}`;
}

async function make(quoteId: string, doc?: QuoteDoc): Promise<Made> {
  const v = version(doc);
  const hit = getCached<Made>(key(quoteId), TTL);
  if (hit && hit.v === v) return hit;
  const res = await fetch(`/api/epc/quotes/${quoteId}/proposal`, { method: "POST", headers: authHeaders() });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.ok || !j.url) throw new Error(j?.error || "Couldn't make the proposal link.");
  const made: Made = { v, url: String(j.url), org: String(j.org || "") };
  setCached(key(quoteId), made);
  return made;
}

/** The proposal link of a saved quotation (`doc` = it as saved). */
export async function createProposal(quoteId: string, doc?: QuoteDoc): Promise<string> {
  return (await make(quoteId, doc)).url;
}

/** WhatsApp to the customer with the proposal link (Hinglish, editable before
 *  sending). `saved` gives the saved quotation (saving first when there are
 *  changes); the WhatsApp tab opens at once, while the tap still counts. */
export async function whatsAppProposal(saved: () => Promise<{ id: string; doc: QuoteDoc } | null>) {
  const win = window.open("", "_blank");
  if (win) win.opener = null;
  try {
    const q = await saved();
    if (!q) { win?.close(); return; }
    const { url, org } = await make(q.id, q.doc);
    const size = q.doc.kw ? `${+Number(q.doc.kw).toFixed(2)} kW ` : "";
    const text = `Namaste ${q.doc.customer.name.trim()} ji,\n\nAapke ${size}rooftop solar system ka proposal yeh raha. ` +
      `Link kholkar poori details dekhiye aur wahin se accept kar dijiye:\n${url}${org ? `\n\n${org}` : ""}`;
    openWhatsApp(win, q.doc.customer.mobile, text);
  } catch (e) {
    win?.close();
    throw e;
  }
}
