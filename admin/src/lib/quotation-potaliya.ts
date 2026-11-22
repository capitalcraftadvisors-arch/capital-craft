// Server-only. Potaliya Enterprises' solar proposal — their own 10-page PDF is the
// template (templates/potaliya-template.pdf), filled in place by lib/pdf-template:
//   1 cover — date, "<kW> KW Rooftop EPC Solar", prepared for (name) + address
//   2 welcome — "Dear <name>,"
//   3 contact details — name, plant capacity, contact person + mobile, date, reference no.
//   4 savings & payback — six figures + the monthly savings chart (redrawn)
//   5 domestic offer — the price (drawn as shapes in the template: covered) + the subsidies
//   6 bill of material — a cell is rewritten only where it differs from the sample
// Pages 7–10 (terms, disclaimer, contact) are unchanged.

import { PDFDocument, PDFPage, degrees, rgb } from "pdf-lib";
import { editPage, embedHelvetica, inr, num, textWidth, wrap, printable, type Edit, type Fonts } from "./pdf-template";
import { POTALIYA_BOM, potaliyaBom, potaliyaFigures, type BoqCells, type BoqColumn } from "./quotation-brands";

export type PotaliyaInput = {
  serial: string;          // proposal reference no.
  date: string;            // DD/MM/YYYY
  customer_name: string;
  mobile: string;          // 10 digits
  address: string;
  kw: number;
  price: number;           // GST included
  central: number | null;  // central subsidy; null = by kW
  state: number | null;    // state subsidy; null = ₹17,000
  bom: BoqCells;
};

/** The form values + today's date → the builder's input. */
export function potaliyaInput(b: Record<string, unknown>, date: string): PotaliyaInput {
  const s = (k: string) => String(b[k] ?? "").trim();
  const opt = (k: string) => (s(k) === "" ? null : Number(b[k]) || 0);
  const kw = Number(b.kw) || 0;
  return {
    serial: s("serial"), date, customer_name: s("customer_name"), mobile: s("mobile"), address: s("address"), kw,
    price: Number(b.price) || 0, central: opt("central_subsidy"), state: opt("state_subsidy"),
    bom: potaliyaBom(b.bom && typeof b.bom === "object" ? (b.bom as Record<string, unknown>) : {}, kw),
  };
}

const H = 842.04; // page height — the measurements below are from the page's top
const top = (y: number) => H - y;

// Page 6 bill of material: the columns' and rows' edges (from the top).
const BOM_COLS: Record<BoqColumn, [number, number]> = { spec: [193.5, 408.8], make: [408.8, 505.4], qty: [505.4, 572.2] };
const BOM_ROWS: [number, number][] = [[163.2, 184.7], [184.7, 229.9], [229.9, 258.9], [258.9, 289.4], [289.4, 333.2], [333.2, 363.5],
  [363.5, 429.5], [429.5, 460.0], [460.0, 496.4], [496.4, 526.8], [526.8, 557.0], [557.0, 594.8], [594.8, 623.8], [623.8, 653.5]];
const BOM_SAMPLE = potaliyaBom({}, 10); // what the template's page 6 shows

// Page 4's monthly savings chart, drawn where the template's picture was (Chart.js
// look: grey labels, green bars, no grid): the plot runs x 67.6–577.4 and from the
// top value at 472.78 down to zero at 743.4; 12 bars 32.6 wide, the first and last
// halved by the plot's edges.
const GREY = rgb(0.4, 0.4, 0.4), GREEN = rgb(0, 151 / 255, 70 / 255);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function niceStep(max: number) {
  const raw = Math.max(max, 1) / 7, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function drawChart(page: PDFPage, fonts: Fonts, months: number[]) {
  const size = 8.9, cap = size * 0.36;
  const label = (t: string, x: number, y: number, bold = false, rotate = 0) =>
    page.drawText(t, { x, y, size, font: bold ? fonts.bold : fonts.reg, color: GREY, rotate: degrees(rotate) });
  const step = niceStep(Math.max(...months)), ceil = Math.ceil(Math.max(...months, step) / step) * step;
  const L = 67.6, R = 577.4, T = 472.78, Z = 743.4, pitch = (R - L) / 11, half = 16.29;
  const level = (v: number) => Z - (v / ceil) * (Z - T);
  // legend
  page.drawRectangle({ x: 248.7, y: top(466.5), width: 29.7, height: 8.9, color: GREEN });
  label("Monthly Savings", 285.8, top(464.7));
  // y axis: values, title
  for (let v = 0; v <= ceil + 0.5; v += step) {
    const t = num(+v.toFixed(2));
    label(t, 60 - textWidth(fonts.reg, t, size), top(level(v) + 2.85));
  }
  const title = "Amount (in Rupees)";
  label(title, 26.2, top((T + Z) / 2) - textWidth(fonts.bold, title, size) / 2, true, 90);
  // bars + month labels (rotated, ending under each bar)
  const a = (23.5 * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  months.forEach((m, i) => {
    const c = L + i * pitch, x0 = Math.max(L, c - half), x1 = Math.min(R, c + half);
    page.drawRectangle({ x: x0, y: top(Z), width: x1 - x0, height: Z - level(m), color: GREEN });
    const w = textWidth(fonts.reg, MONTHS[i], size), ex = c + cap * sin, ey = top(748) - cap * cos;
    label(MONTHS[i], ex - w * cos, ey - w * sin, false, 23.5);
  });
  const x = "Months";
  label(x, (L + R) / 2 - textWidth(fonts.bold, x, size) / 2, top(780.7), true);
}

/** Fills the Potaliya template (readBundledTemplate("bundled:potaliya")) → PDF bytes. */
export async function buildPotaliyaQuotation(i: PotaliyaInput, template: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template);
  const fonts = await embedHelvetica(doc);
  const pages = doc.getPages();
  const k = potaliyaFigures(i.kw, i.price, i.central, i.state);
  const kw = num(i.kw);
  const text = (at: [number, number], to: number, t: string, o: Partial<{ bold: boolean; align: "center"; fit: number }> = {}): Edit =>
    ({ kind: "text", at, to, text: t, ...o });

  // 1 — cover: the address wraps onto a second line below the first
  const addr = wrap(printable(fonts.reg, i.address), (t) => textWidth(fonts.reg, t, 14), 270, 2);
  editPage(doc, pages[0], [
    text([41.88, 798.48], 130, i.date),
    text([64.22, 685.54], 345, `${kw} KW Rooftop EPC Solar`, { bold: true, fit: 300 }),
    text([41.88, 182.21], 100, i.customer_name, { fit: 238 }),
    text([286.99, 182.21], 400, addr[0] ?? "", { fit: 270 }),
    ...(addr[1] ? [{ kind: "add", x: 286.99, y: 165.4, text: addr[1], like: [286.99, 182.21], fit: 270 } as Edit] : []),
  ], fonts);

  // 2 — welcome letter
  editPage(doc, pages[1], [text([49.32, 345.05], 145, `Dear ${i.customer_name},`, { fit: 480 })], fonts);

  // 3 — contact details
  editPage(doc, pages[2], [
    text([183.05, 724.30], 560, i.customer_name, { fit: 380 }),
    text([183.05, 657.46], 260, `${kw} KW`),
    text([233.21, 629.62], 560, i.customer_name, { fit: 330 }),
    text([272.95, 614.14], 400, i.mobile ? `+91${i.mobile}` : ""),
    text([183.05, 485.95], 280, i.date),
    text([183.05, 456.31], 300, i.serial, { fit: 380 }),
  ], fonts);

  // 4 — savings & payback: each figure centred where the sample's was; the chart redrawn
  editPage(doc, pages[3], [
    text([73.10, 567.34], 160, `${k.payback} year`, { align: "center", fit: 150 }),
    text([246.05, 567.34], 370, `${k.units} Units`, { align: "center", fit: 170 }),
    { kind: "amount", rupee: [434.74, 566.62], at: [453.34, 566.62], text: inr(k.savings), align: "center" },
    { kind: "amount", rupee: [46.56, 440.71], at: [65.06, 440.71], text: inr(i.price), align: "center" },
    text([277.03, 441.07], 320, String(k.trees), { align: "center" }),
    text([426.82, 445.03], 540, `${k.co2} Tonnes`, { align: "center", fit: 150 }),
    { kind: "hide", image: [14.40, 54.79] },
  ], fonts);
  drawChart(pages[3], fonts, k.months);

  // 5 — domestic offer: the price was drawn as shapes — covered in the row's grey, written on top
  const price = inr(i.price);
  editPage(doc, pages[4], [
    { kind: "box", x: 444, y: top(215.4), width: 53.3, height: 11.8, color: [0.925, 0.925, 0.925] },
    { kind: "add", x: 470.65 - textWidth(fonts.reg, price, 12.5) / 2, y: top(213), text: price, like: [429.34, 614.50] },
    text([56.78, 598.54], 300, `Subsidy – ${k.central}/- Central Government`),
    text([56.78, 582.58], 300, k.state > 0 ? `*Subsidy – ${k.state}/- State Government` : ""),
  ], fonts);

  // 6 — bill of material: only the cells that differ from the sample
  const cells: Edit[] = [];
  POTALIYA_BOM.forEach((r, n) => {
    const [t0, t1] = BOM_ROWS[n];
    for (const col of Object.keys(BOM_COLS) as BoqColumn[]) {
      const v = i.bom[r.key][col];
      if (v === BOM_SAMPLE[r.key][col]) continue;
      const [x0, x1] = BOM_COLS[col];
      cells.push({ kind: "area", box: [x0, top(t1), x1, top(t0)], text: v, rows: Math.max(1, Math.floor((t1 - t0 - 4) / 11.6)) });
    }
  });
  if (cells.length) editPage(doc, pages[5], cells, fonts);

  return doc.save();
}
