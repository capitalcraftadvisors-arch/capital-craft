// Server-only. Sarvatra Energy's offer letter — their own 3-page PDF is the
// template (templates/sarvatra-energy.pdf), filled in place by lib/pdf-template:
//   1 — the customer table and the bill of quantities (every cell from the form's dropdowns)
//   2 — the commercial summary: the total project cost as supply + GST at 8.9 %
//   3 — bank details and terms (unchanged)

import { PDFDocument } from "pdf-lib";
import { editPage, embedHelvetica, inr, num, textWidth, type At, type Edit } from "./pdf-template";
import { sarvatraEnergyBoq, sarvatraEnergyTotals, type BoqColumn } from "./quotation-brands";

export type SarvatraEnergyInput = {
  quote_no: string;
  date: string;               // DD/MM/YYYY
  customer_name: string;
  mobile: string;
  email: string;
  application_no: string;
  discom: string;             // e.g. AEN_OM_BASSI
  system: string;             // e.g. 5KW Non-Domestic NDCR
  k_number: string;
  address: string;            // installation address
  boq: Record<string, Record<BoqColumn, string>>;
  total: number;              // total project cost, GST inclusive
};

/** The form values + today's date → the builder's input. */
export function sarvatraEnergyInput(b: Record<string, unknown>, date: string): SarvatraEnergyInput {
  const s = (k: string) => String(b[k] ?? "").trim();
  const kw = Number(b.kw) || 0;
  return {
    quote_no: s("serial"), date, customer_name: s("customer_name"), mobile: s("mobile"), email: s("email"),
    application_no: s("application_no"), discom: s("discom"),
    system: [`${num(kw)}KW`, s("category"), s("dcr")].filter(Boolean).join(" "),
    k_number: s("k_number"), address: s("address"),
    boq: sarvatraEnergyBoq(b.boq && typeof b.boq === "object" ? (b.boq as Record<string, unknown>) : {}, kw),
    total: Number(b.total) || 0,
  };
}

// Bill of quantities cells: per row, each column's original lines and how many lines it holds.
const BOQ_X = { make: [226.2, 324, 95], spec: [331.9, 498, 163], qty: [505.7, 575, 67] } as const; // x, to, width
const BOQ_CELLS: Record<string, Record<BoqColumn, [number[], number]>> = { // [line baselines, rows]
  module: { make: [[412.9], 2], spec: [[419.6], 1], qty: [[412.9], 2] },
  inverter: { make: [[391.1, 379.7], 2], spec: [[392.2], 1], qty: [[385.4], 2] },
  meter: { make: [[364.7], 1], spec: [[364.7], 1], qty: [[364.7], 1] },
  structure: { make: [[349.7], 1], spec: [[350], 1], qty: [[350], 1] },
  cable: { make: [[328.8], 2], spec: [[335.5], 1], qty: [[328.8], 2] },
  earthing: { make: [[308], 1], spec: [[308], 1], qty: [[308], 1] },
  arrester: { make: [[294], 1], spec: [[294], 1], qty: [[294], 1] },
  acdb: { make: [[280, 268.4], 2], spec: [[274.2], 2], qty: [[274.2], 2] },
  pedestal: { make: [[254.5], 1], spec: [[254.5], 1], qty: [[254.5], 1] },
  protection: { make: [[240.5, 229], 2], spec: [[234.7], 2], qty: [[234.7], 2] },
};

/** Fills the Sarvatra Energy template (readBundledTemplate("bundled:sarvatra-energy")) → PDF bytes. */
export async function buildSarvatraEnergyQuotation(i: SarvatraEnergyInput, template: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template);
  const fonts = await embedHelvetica(doc);
  const pages = doc.getPages();
  const cell = (lines: At[], to: number, text: string, width: number, rows = 1, bold = false): Edit =>
    ({ kind: "cell", lines, to, text, width, rows, bold });

  // 1 — the mail ID's blue underline is drawn, not text: covered (before the new
  // text, so its descenders stay) and drawn again under the new one
  editPage(doc, pages[0], [
    { kind: "box", x: 151, y: 555.4, width: 126, height: 1.5, color: [0.851, 0.929, 0.949] },
    ...(i.email ? [{ kind: "box", x: 151.3, y: 555.7, width: Math.min(textWidth(fonts.reg, i.email, 11), 166), height: 0.9, color: [0, 0, 1] } as Edit] : []),
    cell([[151.3, 588.2]], 322, i.quote_no, 166, 1, true),
    cell([[413.5, 588.2]], 575, i.date, 159, 1, true),
    cell([[151.3, 573]], 322, i.customer_name, 166),
    cell([[413.5, 573.4]], 575, i.mobile, 159),
    cell([[151.3, 557.8]], 322, i.email, 166),
    { kind: "add", x: 413.5, y: 558.4, text: i.application_no, like: [413.5, 573.4], fit: 159 },
    cell([[151.3, 542.6]], 322, i.discom, 166),
    cell([[413.5, 542.6]], 575, i.system, 159),
    cell([[151.3, 528.5]], 575, i.k_number, 421),
    cell([[151.3, 507.6]], 575, i.address, 421, 2),
    ...Object.entries(BOQ_CELLS).flatMap(([row, cols]) => (Object.keys(cols) as BoqColumn[]).map((col) => {
      const [x, to, width] = BOQ_X[col], [ys, rows] = cols[col];
      return cell(ys.map((y) => [x, y] as At), to, i.boq[row]?.[col] ?? "", width, rows);
    })),
  ], fonts);

  // 2 — commercial summary (each amount's ₹ is its own first glyph)
  const t = sarvatraEnergyTotals(i.total);
  const amount = (y: number, v: number, bold = false): Edit =>
    ({ kind: "amount", rupee: [500, y], at: [500, y], to: 575, text: `${inr(v)}/-`, bold, align: "left" });
  editPage(doc, pages[1], [amount(715, t.base), amount(701, t.gst), amount(687, i.total, true)], fonts);

  return doc.save();
}
