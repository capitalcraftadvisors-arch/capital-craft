// A solar EPC's GST invoice figures (epc_invoices, 0129) — Partner Portal v2.
// Pure: the invoice form, the saved row and the PDF use the same numbers.
//
// A rooftop solar plant is one composite supply, split for GST as 70 % goods
// (HSN 8541) + 30 % services (SAC 9954) of the taxable value — effective 8.9 %,
// the same as STANDARD.gst (lib/quotation-brands). The amount is entered
// GST-inclusive; each line gets its taxable value and its tax, to the paisa,
// and the lines always add up to the amount entered. CGST + SGST (halves) when
// the place of supply is the EPC's own state (its GSTIN's), else IGST — the same
// rule as lib/quote-calc (an unknown state counts as the EPC's own).

// Rates to be confirmed by the CA.
type SplitLine = { key: string; share: number; rate: number; hsn: string; description: (size: string) => string };
export const INVOICE_SPLIT: SplitLine[] = [
  { key: "goods", share: 0.7, rate: 5, hsn: "8541", description: (size) => `Supply of ${size}rooftop solar power plant (solar modules, inverter, structure and balance of system)` },
  { key: "services", share: 0.3, rate: 18, hsn: "9954", description: () => "Installation, testing and commissioning of the solar power plant" },
];
/** The effective rate on the taxable value: 0.7 × 5 % + 0.3 × 18 % = 8.9 %. */
export const INVOICE_GST = INVOICE_SPLIT.reduce((a, l) => a + l.share * l.rate, 0);

export type InvoiceLine = {
  description: string; hsn: string;
  taxable: number; rate: number;              // rate = GST %
  cgst: number; sgst: number; igst: number;
  amount: number;                             // taxable + tax
};
export type InvoiceFigures = {
  lines: InvoiceLine[]; intra: boolean;
  taxable: number; cgst: number; sgst: number; igst: number; total: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** CGST + SGST when the place of supply is the EPC's own state (or either is unknown). */
export const isIntraState = (placeOfSupply: string | null | undefined, epcState: string | null | undefined) =>
  !placeOfSupply || !epcState || placeOfSupply === epcState;

/** The lines and totals for a GST-inclusive amount. kw (optional) goes into the goods line. */
export function invoiceFigures(amount: number, placeOfSupply: string | null | undefined, epcState: string | null | undefined, kw?: number | null): InvoiceFigures {
  const gross = Math.max(0, r2(Number(amount) || 0));
  const intra = isIntraState(placeOfSupply, epcState);
  const size = kw ? `${+Number(kw).toFixed(2)} kWp ` : "";
  const base = gross / (1 + INVOICE_GST / 100);
  let left = gross;
  const lines = INVOICE_SPLIT.map((l, i): InvoiceLine => {
    const last = i === INVOICE_SPLIT.length - 1;
    // The last line takes what's left, so the lines add up to the amount entered.
    const taxable = last ? r2(left / (1 + l.rate / 100)) : r2(base * l.share);
    const tax = last ? r2(left - taxable) : r2((taxable * l.rate) / 100);
    left = r2(left - taxable - tax);
    const cgst = intra ? r2(tax / 2) : 0;
    return {
      description: l.description(size), hsn: l.hsn, taxable, rate: l.rate,
      cgst, sgst: intra ? r2(tax - cgst) : 0, igst: intra ? 0 : tax, amount: r2(taxable + tax),
    };
  });
  const sum = (k: "taxable" | "cgst" | "sgst" | "igst" | "amount") => r2(lines.reduce((a, l) => a + l[k], 0));
  return { lines, intra, taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), total: sum("amount") };
}
