// Bill photo → quotation (Partner Portal v2): what a customer's electricity bill
// says about the plant they need, for the "From bill photo" modal on
// Quotations (components/partner/BillToQuote). Pure maths, plus the one call
// that reads the bill (/api/epc/bill-to-quote → lib/doc-extractors
// geminiExtractBillForQuote, which returns BillQuoteFields).
//   size       units a month ÷ what 1 kW makes a month in the state, up to the
//              next 0.5 kW, never above the sanctioned load + 1 kW
//   quotation  a draft standard quotation (lib/quote-calc) — residential for a
//              domestic connection, else commercial — at a price per kW before GST
//   EMI        on what the customer pays (after the central subsidy), at the
//              indicative rate, for each tenure, against the current monthly bill

import { getToken } from "./auth";
import { computeEmi, DEFAULT_INDICATIVE_ROI, TENURES } from "./emi";
import { newQuoteDoc, quoteTotals, withAutoItems, type QuoteDoc } from "./quote-calc";
import { STANDARD, type Segment } from "./quotation-brands";
import type { OrgProfile } from "./org-profile";
import type { QuoteRow } from "./quotes";

/** What the bill says — literal values, null when the bill doesn't show them. */
export type BillQuoteFields = {
  units: number | null;          // a month: the latest bill's, or the average of the history printed (up to 12)
  bill: number | null;           // ₹ a month (this bill ÷ the months it covers)
  sanctioned_kw: number | null;  // sanctioned / connected load
  domestic: boolean | null;      // the connection category
  name: string | null;           // the consumer
  address: string | null;        // billing address, with the PIN
  pincode: string | null;
  discom: string | null;
  state: string | null;          // one of lib/india-states INDIA_STATES
  k_number: string | null;       // consumer / K / CA number
};

// Units 1 kW of solar makes in a month — only the starting figure: it varies
// (site, roof, state), so the partner changes it on every quotation (23/11).
export const UNITS_PER_KW_MONTH: Record<string, number> = { Rajasthan: 120 };
const DEFAULT_UNITS_PER_KW_MONTH = 120;
export const unitsPerKwMonth = (state: string | null | undefined) => UNITS_PER_KW_MONTH[state ?? ""] ?? DEFAULT_UNITS_PER_KW_MONTH;

/** The plant for the units a month at `perKwMonth` units a kW: up to the next 0.5 kW,
 *  not above the sanctioned load + 1 kW. 0 = no units. */
export function suggestKw(units: number | null, perKwMonth: number, sanctionedKw: number | null): number {
  if (!units || !(units > 0) || !(perKwMonth > 0)) return 0;
  const kw = Math.ceil((units / perKwMonth) * 2 - 1e-9) / 2;
  if (!sanctionedKw || !(sanctionedKw > 0)) return kw;
  return Math.max(0.5, Math.min(kw, Math.floor((sanctionedKw + 1) * 2 + 1e-9) / 2));
}

/** The price per kW before GST a new quotation starts at: the Quotation preferences'
 *  (quote_defaults.price_per_kw, when set), else the last saved quotation's (its
 *  total less the standard GST, per kW — the same kind first). 0 = none yet. */
export function defaultPricePerKw(org: OrgProfile | null, segment: Segment, quotes: QuoteRow[]): number {
  const pref = (org?.quote_defaults as { price_per_kw?: number | Partial<Record<Segment, number>> } | undefined)?.price_per_kw;
  const own = typeof pref === "number" ? pref : pref?.[segment];
  if (own && own > 0) return own;
  const priced = (q: QuoteRow) => Number(q.kw) > 0 && Number(q.total) > 0;
  const last = quotes.find((q) => q.segment === segment && priced(q)) ?? quotes.find(priced);
  return last ? Math.round(Number(last.total) / (1 + STANDARD.gst / 100) / Number(last.kw)) : 0;
}

export type BillDraft = {
  domestic: boolean;
  name: string; mobile: string; address: string; discom: string; state: string; k_number: string;
  sanctioned_kw: number | null;
  kw: number; price_per_kw: number;
};

/** The draft quotation: the EPC's preferences (newQuoteDoc), the bill's customer, the size and a lump-sum price. */
export function billQuoteDoc(org: OrgProfile | null, b: BillDraft): QuoteDoc {
  const base = newQuoteDoc(b.domestic ? "residential" : "commercial", org);
  return withAutoItems({
    ...base,
    customer: {
      ...base.customer,
      name: b.name.trim(), mobile: b.mobile, billing: b.address.trim(), discom: b.discom.trim(),
      state: b.state || base.customer.state, k_number: b.k_number.trim(),
      sanctioned_load: b.sanctioned_kw ? String(b.sanctioned_kw) : "",
    },
    kw: b.kw, gst_mode: "blended",
    price: Math.round(b.kw * b.price_per_kw * 100) / 100,
  });
}

/** Total, central subsidy (lib/emi centralSubsidyFor, through quoteTotals — domestic only) and, for each
 *  tenure, the EMI on what the customer pays against the current bill. saving null = no bill. */
export function billFigures(doc: QuoteDoc, monthlyBill: number) {
  const t = quoteTotals(doc, ""); // CGST + SGST or IGST — the total is the same
  const pays = t.eligible ? t.net : t.total;
  return {
    total: t.total, subsidy: t.central, pays,
    emis: TENURES.map((years) => {
      const emi = computeEmi(pays, DEFAULT_INDICATIVE_ROI, years);
      return { years, emi, saving: monthlyBill > 0 ? Math.round((monthlyBill - emi) * 100) / 100 : null };
    }),
  };
}

/** Reads the bill (photo or PDF). Throws a readable message when it can't. */
export async function readBill(file: File): Promise<BillQuoteFields> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/epc/bill-to-quote", { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read this bill.");
  return j.fields as BillQuoteFields;
}
