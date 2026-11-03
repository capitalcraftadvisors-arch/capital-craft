// Server-only. RVS Technologies' solar proposal — their own 7-page PDF, whose
// pages are pictures. The template (templates/rvs-template.pdf) is that PDF with
// the sample's values painted out of pages 1–4; the new values are drawn on top
// at the sample's own spots, sizes and colours (measured on the page images,
// 1190 px across):
//   1 cover — "<kW> KW SOLAR"; the customer's name, mobile, address and city
//   2 welcome — the name; "Dear <name>,"
//   3 savings & payback — six figures + the 25-year savings chart
//   4 commercial offer — the kW in the opening line + the price table
//   5 bill of material — a cell is redrawn only where it differs from the sample;
//     the modules' description ends with (DCR) / (Non-DCR)
// Pages 6–7 (terms, contact) are unchanged.

import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import { embedHelvetica, inr, num, printable, textWidth, wrap, type Fonts } from "./pdf-template";
import { RVS, RVS_BOM, rvsBom, rvsFigures, type BoqCells, type BoqColumn } from "./quotation-brands";

export type RvsInput = {
  customer_name: string;
  mobile: string;
  address: string;
  city: string;            // e.g. Jaipur Rajasthan
  kw: number;
  price: number;           // system price, before GST
  subsidy: number | null;  // MNRE subsidy; null = by kW
  bom: BoqCells;
  dcr: string;             // the solar modules: DCR / Non-DCR
};

/** The form values → the builder's input. */
export function rvsInput(b: Record<string, unknown>): RvsInput {
  const s = (k: string) => String(b[k] ?? "").trim();
  const kw = Number(b.kw) || 0;
  return {
    customer_name: s("customer_name"), mobile: s("mobile"), address: s("address"), city: s("city"), kw,
    price: Number(b.price) || 0, subsidy: s("subsidy") === "" ? null : Number(b.subsidy) || 0,
    bom: rvsBom(b.bom && typeof b.bom === "object" ? (b.bom as Record<string, unknown>) : {}, kw),
    dcr: s("dcr") || RVS.dcrTypes[0],
  };
}

type RGB = [number, number, number];
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];
type TextOpts = { bold?: boolean; align?: "center" | "right"; max?: number };

// Drawing on a page image in its own pixels (from its top-left): the image is
// 1190 px across the 447 pt page and `height` px down 631.5 pt from the top (631.92).
function canvas(page: PDFPage, fonts: Fonts, height: number) {
  const k = 447 / 1190, ky = 631.5 / height;
  const X = (px: number) => px * k, Y = (px: number) => 631.92 - px * ky;
  const color = (c: RGB) => rgb(c[0] / 255, c[1] / 255, c[2] / 255);
  return {
    /** Text with its baseline at `base`, from x (or centred on / ending at it); shrunk to `max` px wide. */
    text(s: string, x: number, base: number, size: number, c: RGB, o: TextOpts = {}) {
      const font = o.bold ? fonts.bold : fonts.reg;
      const t = printable(font, s);
      const max = (o.max ?? Infinity) * k;
      let pt = size * k;
      const w = textWidth(font, t, pt);
      if (w > max) pt = (pt * max) / w;
      const drawn = Math.min(w, max);
      const left = o.align === "center" ? X(x) - drawn / 2 : o.align === "right" ? X(x) - drawn : X(x);
      page.drawText(t, { x: left, y: Y(base), size: pt, font, color: color(c) });
    },
    /** Words wrapped onto at most `rows` lines `max` px wide. */
    lines(s: string, size: number, max: number, rows: number, bold = false) {
      const font = bold ? fonts.bold : fonts.reg;
      return wrap(printable(font, s), (t) => textWidth(font, t, size * k), max * k, rows);
    },
    /** Filled box between pixel edges x0..x1, y0..y1. */
    box(x0: number, y0: number, x1: number, y1: number, c: RGB) {
      page.drawRectangle({ x: X(x0), y: Y(y1), width: X(x1) - X(x0), height: Y(y0) - Y(y1), color: color(c) });
    },
  };
}
type Canvas = ReturnType<typeof canvas>;

// Page 3's yearly savings chart, as in the sample: a 2 px grid line every 75 px
// from row 1033 (the top value) to 1333 (zero); 25 bars 24 px wide every 30 px.
function drawChart(c: Canvas, years: number[]) {
  const top = Math.ceil(Math.max(...years, 1) / 20000) * 20000;
  for (let i = 0; i <= 4; i++) {
    const y = 1033 + 75 * i, v = top - (top / 4) * i;
    if (i < 4) for (let x = 270; x < 1020; x += 12) c.box(x, y, Math.min(x + 6, 1020), y + 2, [230, 234, 237]);
    c.text(v ? `${num(v / 1000)}k` : "0", 254, y + 8, 16, BLACK, { align: "right" });
  }
  c.box(269, 1034, 271, 1335, [229, 230, 234]);
  years.forEach((v, n) => c.box(273 + 30 * n, 1334 - (v / top) * 300, 297 + 30 * n, 1333, [0, 79, 154]));
  c.box(269, 1333, 1020, 1335, [225, 231, 238]);
}

// Page 5 bill of material: each column's x and each row's y inside the borders (px edges).
const BOM_COLS: Record<BoqColumn, [number, number]> = { spec: [82, 596], qty: [674, 750], make: [752, 1120] };
const BOM_ROWS: [number, number][] = [[312, 438], [440, 544], [546, 644], [646, 704], [706, 762], [764, 816],
  [818, 866], [868, 944], [946, 1028], [1030, 1110], [1112, 1170], [1172, 1228], [1230, 1296]];
const BOM_SAMPLE = rvsBom({ rvs_module_qty: "16" }, 10); // what the template's page 5 shows

/** Fills the RVS template (readBundledTemplate("bundled:rvs")) → PDF bytes. */
export async function buildRvsQuotation(i: RvsInput, template: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template);
  const fonts = await embedHelvetica(doc);
  const pages = doc.getPages();
  const k = rvsFigures(i.kw, i.price, i.subsidy, i.dcr);
  const kw = num(i.kw);

  // 1 — cover
  const cover = canvas(pages[0], fonts, 1684);
  cover.text(`${kw} KW SOLAR`, 589.5, 409, 90, [15, 48, 79], { bold: true, align: "center", max: 1080 });
  const forLines = [i.customer_name, i.mobile, ...(i.address ? cover.lines(i.address, 28, 505, 3, true) : [""]), i.city];
  forLines.forEach((l, n) => cover.text(l, 103.5, 635 + 36 * n, 28, BLACK, { bold: true, max: 505 }));

  // 2 — welcome
  const welcome = canvas(pages[1], fonts, 1684);
  welcome.text(i.customer_name, 84, 603, 36, [11, 73, 129], { bold: true, max: 1032 });
  welcome.text(`Dear ${i.customer_name},`, 84, 671, 28, BLACK, { max: 1032 });

  // 3 — savings & payback
  const savings = canvas(pages[2], fonts, 1684);
  const navy: RGB = [16, 47, 74];
  ([[k.payback, 195.5, 567], [inr(k.units), 596, 567], [inr(k.savings), 990, 573],
    [inr(k.total), 193.5, 883], [inr(k.trees), 596, 883], [inr(k.co2), 991.5, 883]] as [string, number, number][])
    .forEach(([v, x, base]) => savings.text(v, x, base, 32, navy, { bold: true, align: "center", max: 360 }));
  drawChart(savings, k.years);

  // 4 — commercial offer
  const offer = canvas(pages[3], fonts, 1684);
  offer.text(`Price quote for total EPC services for ${kw} KW Solar PV plant as per the mentioned`, 84, 271, 28, BLACK, { max: 1032 });
  [kw, inr(i.price), inr(k.gst), inr(k.total), inr(k.subsidy), inr(k.effective)].forEach((v, n) =>
    offer.text(v, 860, [451, 519, 589, 657, 725, 793][n], 27, n < 3 ? [2, 14, 40] : BLACK, { bold: true, align: "center", max: 490 }));

  // 5 — bill of material: only the cells that differ from the sample (the module / inverter logos stay until then);
  //     the modules' DCR / Non-DCR follows their description
  const bom = canvas(pages[4], fonts, 1682);
  RVS_BOM.forEach((r, n) => {
    const [y0, y1] = BOM_ROWS[n];
    for (const col of Object.keys(BOM_COLS) as BoqColumn[]) {
      const v = r.key === "rvs_module" && col === "spec" && i.dcr ? `${i.bom[r.key][col]} (${i.dcr})` : i.bom[r.key][col];
      if (v === BOM_SAMPLE[r.key][col]) continue;
      const [x0, x1] = BOM_COLS[col], width = x1 - x0 - 10;
      bom.box(x0, y0, x1, y1, WHITE);
      const lines = bom.lines(v, 23, width, Math.max(1, Math.round((y1 - y0) / 33)));
      lines.forEach((l, m) => bom.text(l, (x0 + x1) / 2, (y0 + y1) / 2 + 6 + (m - (lines.length - 1) / 2) * 33, 23, BLACK, { align: "center", max: width }));
    }
  });

  return doc.save();
}
