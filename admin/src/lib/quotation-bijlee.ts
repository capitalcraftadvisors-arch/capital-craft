// Server-only. Bijlee Solar quotation — their own 12-page PDF is the template
// (templates/bijlee-template.pdf), filled in place by lib/pdf-template. Page 8's
// savings chart is an image, so it's covered and redrawn. A brand logo (pages
// 5–6) is removed when the chosen brand isn't that maker. Pages 2–3 and 9–12 are
// untouched.
//
// Savings (user-confirmed): 1,250 units per kW per year at ₹13.50 per unit;
// payback = total cost ÷ yearly savings; CO₂ ≈ 1.01 kg per unit; trees = CO₂ kg ÷ 38;
// the 25-year chart grows ~1.6 % a year (2 % tariff rise, 0.4 % panel ageing).
// These reproduce the template's own numbers exactly for 15 kW.

import { PDFDocument, PDFPage, rgb, degrees } from "pdf-lib";
import { editPage, embedHelvetica, inr, logos, num, textWidth, type Fonts } from "./pdf-template";

const UNITS_PER_KW = 1250;
const RATE_PER_UNIT = 13.5;
const MODULE_WP = 590;
const GST_PERCENT = 8.9;
const EM = 2048; // the template's Type3 fonts are TrueType outlines: 2048 glyph units per em

export type BijleeInput = {
  customer_name: string;
  location: string;           // page 1 "Location:"
  kw: number;
  serial: string;             // e.g. BIJ-324/P/1.2
  date: string;               // DD/MM/YYYY
  project_location: string;   // survey
  client_name: string;
  msedcl_division: string;
  contracted_demand: string;  // kW (number as text)
  module_brand: string;
  inverter_brand: string;
  cable_brand: string;
  rate_per_kw: number;        // system ₹ per kW
  structure_rate_per_kw: number;
};

export function bijleeFigures(i: BijleeInput) {
  const kw = i.kw;
  const system = kw * i.rate_per_kw;
  const structure = kw * i.structure_rate_per_kw;
  const subtotal = system + structure;
  const gst = subtotal * (GST_PERCENT / 100);
  const total = subtotal + gst;
  const units = Math.round(kw * UNITS_PER_KW);
  const savings = units * RATE_PER_UNIT;
  const co2kg = units * 1.01;
  return {
    system, structure, subtotal, gst, total, units, savings,
    perKwTotal: total / kw,
    payback: savings > 0 ? (total / savings).toFixed(1) : "—",
    trees: Math.round(co2kg / 38),
    co2t: Math.round(co2kg / 1000),
    modules: Math.ceil((kw * 1000) / MODULE_WP),
    chart: Array.from({ length: 25 }, (_, n) => savings * Math.pow(1.02 * 0.996, n)),
  };
}

// Page 8 savings chart (an image in the template) → covered and redrawn.
// Geometry measured from the template's own chart.
function drawChart(page: PDFPage, values: number[], fonts: Fonts) {
  page.drawRectangle({ x: 51.56, y: 82.98, width: 515.36, height: 418.83, color: rgb(1, 1, 1) });
  const navy = rgb(0.17, 0.16, 0.37), grey = rgb(0.4, 0.4, 0.4), size = 9;
  const steps = [10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000, 2000000, 2500000, 5000000];
  const max = Math.max(...values);
  const step = steps.find((s) => Math.ceil(max / s) <= 8) ?? 10000000;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const left = 107, right = 566, base = 122, ph = 356;
  const label = (text: string, x: number, y: number, bold = false) =>
    page.drawText(text, { x, y, size, font: bold ? fonts.bold : fonts.reg, color: grey });
  const width = (text: string, bold = false) => textWidth(bold ? fonts.bold : fonts.reg, text, size);
  // legend
  page.drawRectangle({ x: 277, y: 486.2, width: 29.4, height: 7.8, color: navy });
  label("Savings", 312, 487);
  // y labels
  for (let v = 0; v <= top; v += step) label(String(v), left - 3.5 - width(String(v)), base + (v / top) * ph - 3.2);
  // bars + x labels
  const slot = (right - left) / values.length, bw = 12.7;
  values.forEach((v, i) => {
    page.drawRectangle({ x: left + i * slot + (slot - bw) / 2, y: base, width: bw, height: (v / top) * ph, color: navy });
    label(String(i + 1), left + i * slot + slot / 2 - width(String(i + 1)) / 2, 106);
  });
  // axis titles
  const yt = "Amount (in Rupees)";
  page.drawText(yt, { x: 62.6, y: base + ph / 2 - width(yt, true) / 2, size, font: fonts.bold, color: grey, rotate: degrees(90) });
  label("Year", (left + right) / 2 - width("Year", true) / 2, 89, true);
}

/** Fills the Bijlee template (readBundledTemplate("bundled:bijlee")) with the form values → PDF bytes. */
export async function buildBijleeQuotation(i: BijleeInput, template: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template);
  const fonts = await embedHelvetica(doc);
  const k = bijleeFigures(i);
  const kw = num(i.kw);
  const pages = doc.getPages();

  // 1 — cover
  editPage(doc, pages[0], [
    { kind: "text", at: [264.3, 504], text: i.date, bold: true, align: "right" },
    { kind: "text", at: [246.4, 484], text: i.serial, bold: true, align: "right" },
    { kind: "text", at: [41.9, 400.1], text: i.customer_name },
    { kind: "text", at: [41.9, 360], text: `Recommended System Capacity: ${kw} KW` },
    { kind: "text", at: [41.9, 339.9], text: `Location: ${i.location}` },
  ], fonts, EM);
  // 4 — site survey (only these four fields)
  editPage(doc, pages[3], [
    { kind: "text", at: [153.3, 706.8], text: i.project_location, bold: true },
    { kind: "text", at: [442.9, 669.6], text: `${i.contracted_demand} KW`, bold: true },
    { kind: "add", x: 400, y: 709, text: i.client_name, bold: true, like: [153.3, 706.8] },
    { kind: "add", x: 160.5, y: 677.1, text: i.msedcl_division, bold: true, like: [153.3, 706.8] },
  ], fonts, EM);
  // 5 — module + inverter
  editPage(doc, pages[4], [
    { kind: "text", at: [346.4, 615.4], text: i.module_brand },
    { kind: "text", at: [346.4, 474.3], text: String(k.modules) },
    { kind: "text", at: [353.8, 296.1], text: i.inverter_brand },
    { kind: "text", at: [353.8, 270.1], text: `Max - ${Math.round(i.kw * 1000)} W` },
    ...logos(i.module_brand, [["novasys", [261.7, 645.1]], ["navitas", [445.9, 643.6]]]),
    ...logos(i.inverter_brand, [["growatt", [269.1, 53.3]], ["sungrow", [453.3, 63.7]]]),
  ], fonts, EM);
  // 6 — cable
  editPage(doc, pages[5], [
    { kind: "text", at: [153.3, 680], text: i.cable_brand, bold: true },
    ...logos(i.cable_brand, [["polycab", [142.2, 627.3]]]),
  ], fonts, EM);
  // 7 — techno-commercial offer
  editPage(doc, pages[6], [
    { kind: "text", at: [79, 723.1], text: `Offer ${kw} KW`, bold: true },
    { kind: "text", at: [64.9, 654.8], text: `Cost of Standard ${kw} KW Solar PV`, bold: true, fit: true },
    { kind: "text", at: [275.5, 605.8], text: `${kw} KW`, align: "center" },
    { kind: "text", at: [275.5, 504.8], text: `${kw} KW`, align: "center" },
    { kind: "amount", rupee: [358.7, 605.8], at: [368.9, 605.8], text: inr(i.rate_per_kw), align: "center" },
    { kind: "amount", rupee: [476.1, 605.8], at: [486.4, 605.8], text: inr(k.system), align: "center" },
    { kind: "amount", rupee: [375, 504.8], at: [385.3, 504.8], text: inr(i.structure_rate_per_kw), align: "center" },
    { kind: "amount", rupee: [497.5, 504.8], at: [507.8, 504.8], text: inr(k.structure), align: "center" },
    { kind: "amount", rupee: [358.7, 458.7], at: [368.9, 458.7], text: inr(i.rate_per_kw + i.structure_rate_per_kw), align: "center" },
    { kind: "amount", rupee: [458.2, 458.7], at: [468.4, 458.7], text: `${inr(k.subtotal)} + GST`, align: "center" },
    { kind: "amount", rupee: [476.1, 398.6], at: [486.4, 398.6], text: inr(k.subtotal), align: "center" },
    { kind: "text", at: [64.9, 368.9], text: `GST @ ${GST_PERCENT} %`, bold: true },
    { kind: "amount", rupee: [481.2, 368.9], at: [491.4, 368.9], text: inr(k.gst), align: "center" },
    { kind: "amount", rupee: [358.7, 339.9], at: [368.9, 339.9], text: inr(k.perKwTotal), align: "center" },
    { kind: "amount", rupee: [474.9, 339.9], at: [485.3, 339.9], text: inr(k.total), align: "center", bold: true },
    { kind: "text", at: [493.9, 198.1], text: inr(k.subtotal) },
  ], fonts, EM);
  // 8 — savings
  editPage(doc, pages[7], [
    { kind: "text", at: [98, 652.6], text: `${k.payback} Years`, align: "center" },
    { kind: "text", at: [268.1, 645.1], text: `${k.units} Units`, align: "center" },
    { kind: "amount", rupee: [457.6, 645.1], at: [467.8, 645.1], text: inr(k.savings), align: "center" },
    { kind: "amount", rupee: [93.7, 553], at: [103.9, 553], text: inr(k.total), align: "center" },
    { kind: "text", at: [290.9, 556], text: String(k.trees), align: "center" },
    { kind: "text", at: [458.5, 553], text: `${k.co2t} Tonnes`, align: "center" },
  ], fonts, EM);
  drawChart(pages[7], k.chart, fonts);

  return doc.save();
}
