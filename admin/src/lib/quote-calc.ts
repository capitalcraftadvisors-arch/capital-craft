// A saved quotation (epc_quotes.payload, 0118) — the whole editable document —
// and its figures. Pure: the quote editor and the PDF use the same functions,
// so the totals on screen and on paper can never differ.
//
// GST: "blended" = one system price + 8.9 % (70 % at 5 % + 30 % at 18 %);
// "lines" = each item row's qty × rate at its own rate. Split CGST + SGST when
// the place of supply is the EPC's own state, else IGST. A discount comes off
// before tax. Subsidy only on a residential plant with DCR modules.

import { centralSubsidyFor, computeEmi, DEFAULT_INDICATIVE_ROI } from "./emi";
import { STANDARD, standardBom, type PaymentStage, type Segment } from "./quotation-brands";
import { resolveQuoteDefaults, type OrgProfile } from "./org-profile";

export type QuoteItem = {
  key?: string;            // a standard BOM row (std_*), else a row the EPC added
  item: string; spec: string; make: string;
  hsn: string; qty: string; unit: string;
  rate: number;            // per unit, before GST ("lines")
  gst: number;             // % ("lines")
  auto?: { qty?: boolean; spec?: boolean }; // still follows the kW / phase
};

export type QuoteCustomer = {
  name: string; mobile: string; email: string; gstin: string;
  billing: string; shipping: string;   // shipping "" = same as billing (the site)
  state: string;                       // place of supply
  k_number: string; discom: string; category: string;
  application_no: string;              // PM Surya Ghar (residential)
  sanctioned_load: string;             // kW (commercial)
};

export type QuoteDoc = {
  v: 2;
  segment: Segment;
  date: string; valid_till: string;    // YYYY-MM-DD
  customer: QuoteCustomer;
  kw: number; phase: string; system_type: string; dcr: boolean; tariff: number;
  gst_mode: "blended" | "lines";
  price: number;                       // "blended": the system price before GST
  discount: number;                    // ₹, before tax
  subsidy: number | null;              // central; null = by kW
  state_subsidy: number;
  discom_included: boolean;            // DISCOM / net-metering fees in the price
  items: QuoteItem[];
  payment: PaymentStage[]; timeline: string; warranty: [string, string][];
  scope_ours: string[]; scope_theirs: string[];
  terms: string; notes: string;
  show_savings: boolean; show_emi: boolean;
};

export const GST_RATES = [0, 5, 12, 18, 28];

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return isoDay(d); };

/** The standard bill of material as item rows (lump-sum rates empty). */
export function standardItems(kw: number, phase: string, hybrid: boolean): QuoteItem[] {
  const { rows, cells } = standardBom({}, kw, phase, hybrid);
  return rows.map((r) => ({
    key: r.key, item: r.product, spec: cells[r.key].spec, make: cells[r.key].make, qty: cells[r.key].qty,
    hsn: r.key === "std_install" ? "995442" : "8541", unit: "", rate: 0, gst: r.key === "std_install" ? 18 : 5,
    auto: r.key === "std_module" ? { qty: true } : r.key === "std_inverter" ? { spec: true } : undefined,
  }));
}

/** A new quotation from the EPC's preferences (Settings → Quotation preferences). */
export function newQuoteDoc(segment: Segment, org: OrgProfile | null): QuoteDoc {
  const d = resolveQuoteDefaults(org, segment);
  const today = isoDay(new Date());
  const resi = segment === "residential";
  const phase = resi ? STANDARD.phases[0] : STANDARD.phases[1];
  return {
    v: 2, segment, date: today, valid_till: addDays(today, d.validity),
    customer: { name: "", mobile: "", email: "", gstin: "", billing: "", shipping: "", state: org?.state ?? "",
      k_number: "", discom: "", category: STANDARD.categories[segment][0], application_no: "", sanctioned_load: "" },
    kw: 0, phase, system_type: STANDARD.systemTypes[0], dcr: resi, tariff: STANDARD.tariff[segment],
    gst_mode: org?.gst_mode ?? "blended", price: 0, discount: 0, subsidy: null, state_subsidy: 0, discom_included: resi,
    items: standardItems(0, phase, false),
    payment: d.payment.map((p) => [...p] as PaymentStage), timeline: d.timeline,
    warranty: d.warranty.map((w) => [...w] as [string, string]),
    scope_ours: [...STANDARD.scope.ours, ...(resi ? STANDARD.scope.residential : [])], scope_theirs: [...STANDARD.scope.theirs],
    terms: d.terms, notes: d.notes, show_savings: true, show_emi: true,
  };
}

/** Rows still following the kW / phase get their module count / inverter line again. */
export function withAutoItems(doc: QuoteDoc): QuoteDoc {
  const auto = standardItems(doc.kw, doc.phase, doc.system_type === "Hybrid");
  const of = (key?: string) => auto.find((a) => a.key === key);
  return {
    ...doc,
    items: doc.items.map((it) => {
      if (!it.auto) return it;
      const a = of(it.key);
      if (!a) return it;
      const moduleQty = it.key === "std_module" ? standardBom({ std_module_spec: it.spec }, doc.kw, doc.phase, false).cells.std_module.qty : a.qty;
      return { ...it, ...(it.auto.qty ? { qty: moduleQty } : {}), ...(it.auto.spec ? { spec: a.spec } : {}) };
    }),
  };
}

export const qtyNum = (q: string) => parseFloat(String(q).replace(/[^\d.]/g, "")) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Every figure of a quotation. epcState = the EPC's own state (its GSTIN's), for CGST + SGST vs IGST. */
export function quoteTotals(doc: QuoteDoc, epcState: string) {
  const lines = doc.gst_mode === "lines";
  const amounts = doc.items.map((it) => r2(qtyNum(it.qty) * (Number(it.rate) || 0)));
  const base = lines ? r2(amounts.reduce((a, b) => a + b, 0)) : Number(doc.price) || 0;
  const discount = Math.min(Math.max(0, Number(doc.discount) || 0), base);
  const sub = r2(base - discount);
  const share = base > 0 ? sub / base : 0; // the discount spread over the rows' tax
  // Tax by rate: one 8.9 % bucket for a lump sum, else each row's own rate.
  const byRate = new Map<number, number>();
  if (lines) doc.items.forEach((it, i) => { const g = Number(it.gst) || 0; if (g) byRate.set(g, (byRate.get(g) ?? 0) + (amounts[i] * g) / 100 * share); });
  else if (sub > 0) byRate.set(STANDARD.gst, (sub * STANDARD.gst) / 100);
  const intra = !doc.customer.state || !epcState || doc.customer.state === epcState;
  const taxes = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, t]) => ({ rate, amount: Math.round(t) }));
  const tax = taxes.reduce((a, t) => a + t.amount, 0);
  const total = r2(sub + tax);
  const resi = doc.segment === "residential";
  const eligible = resi && doc.dcr;
  const central = eligible ? (doc.subsidy ?? centralSubsidyFor(doc.kw, false)) : 0;
  const state = eligible ? Math.max(0, Number(doc.state_subsidy) || 0) : 0;
  const net = Math.max(0, r2(total - central - state));
  return { lines, amounts, base, discount, sub, taxes, tax, intra, total, eligible, central, state, net, perKw: doc.kw > 0 ? Math.round(total / doc.kw) : 0 };
}

/** Units, savings, payback and the 25-year savings, from the kW, the tariff and what the customer pays. */
export function quoteSavings(kw: number, tariff: number, pays: number) {
  const units = Math.round(kw * STANDARD.unitsPerKw);
  const savings = Math.round(units * tariff);
  const years = Array.from({ length: 25 }, (_, n) => savings * ((1 + STANDARD.tariffRise) * (1 - STANDARD.degradation)) ** n);
  return { units, savings, years, lifetime: Math.round(years.reduce((a, b) => a + b, 0)), payback: savings > 0 ? pays / savings : 0 };
}

/** Indicative EMIs on the total (the rate is never shown). */
export const quoteEmis = (total: number) => STANDARD.emiYears.map((y) => ({ years: y, emi: computeEmi(total, DEFAULT_INDICATIVE_ROI, y) }));
