// Server-only. Sarvatra Energy (gozerobils) documents — their own PDFs are the
// templates, filled in place by lib/pdf-template from one form:
//   • Quotation (templates/sarvatra-template.pdf, 5 pages; page 2 untouched)
//   • Project Confirmation Receipt — PCR (templates/sarvatra-pcr.pdf, 1 page)
//   • Consumer–vendor agreement (templates/sarvatra-agreement.pdf, 7 pages; 1, 5, 6 filled)
//
// Fixed, as in their quotation: 1,400 units per kW per year; shortfall paid back
// at ₹8.5 per unit (example: 10 % less); savings at ₹10 per unit; 600 Wp panels;
// financing 10 % down, EMI at 9.75 % flat for 1 / 3 / 5 years; ₹10,000 booking.
// These reproduce the sample's own numbers exactly for 6 kW at ₹3,00,000.

import { PDFDocument } from "pdf-lib";
import { editPage, embedHelvetica, inr, num, type At, type Edit } from "./pdf-template";
import { centralSubsidyFor, computeFlatEmi } from "./emi";
import { STATE_CODES } from "./india-states";
import { SARVATRA } from "./quotation-brands";
import { numberToWordsIndian } from "./numberToWords";

const UNITS_PER_KW = 1400;
const PAYBACK_PER_UNIT = 8.5;
const SHORTFALL = 0.1;
const SAVING_PER_UNIT = 10;
const PANEL_WP = 600;
const DOWN_PAYMENT = 0.1;
const FLAT_RATE = 9.75;
const TENURES = [1, 3, 5];

export type SarvatraInput = {
  quote_no: string;
  date: string;               // DD-MM-YYYY
  title: string;              // Mr. / Mrs. / …
  customer_name: string;
  contact: string;            // 10-digit mobile
  city: string;
  state: string;              // full name, e.g. Rajasthan
  kw: number;
  panel_brand: string;
  panel_type: string;
  inverter_brand: string;
  inverter_kw: number;
  phase: string;
  inverter_location: string;
  connection_type: string;
  floors: string;
  solar_care: boolean;
  roof_type: string;
  structure_type: string;
  price: number;              // system price, GST inclusive
  state_subsidy: number;
  design_payment: number;     // "On design approval"
  // PCR
  email: string;
  ebill_name: string;
  k_number: string;
  address: string;
  pincode: string;
  sanctioned_load: string;    // kW
  spc_name: string;
  cell_type: string;
  dcr_type: string;
  wp: string;
  inverter_type: string;      // SARVATRA.inverterTypes
  maintenance_plan: string;   // SARVATRA.maintenancePlans or ""
  maintenance_others: string;
  site_readiness: string;     // SARVATRA.siteReadiness
  bill_correction: string[];  // subset of SARVATRA.billCorrections; empty = NA
  finance_by: string;
  payment_method: string;     // UPI / Cash / …
  payment_mode: string;       // Direct / Financing
  // Agreement
  aen: string;                // DISCOM sub-division (AEN) office
};

export function sarvatraFigures(i: SarvatraInput) {
  const units = Math.round(i.kw * UNITS_PER_KW);
  const lowUnits = Math.round(units * (1 - SHORTFALL));
  const lost = units - lowUnits;
  const yearly = units * SAVING_PER_UNIT;
  const central = centralSubsidyFor(i.kw, SARVATRA.commercial(i.connection_type));
  const down = Math.round(i.price * DOWN_PAYMENT);
  const loan = i.price - down;
  return {
    units, lowUnits, lost, payback: lost * PAYBACK_PER_UNIT, yearly, monthly: yearly / 12,
    panels: Math.ceil((i.kw * 1000) / PANEL_WP),
    central, net: Math.max(0, i.price - central - i.state_subsidy),
    down, loan, emis: TENURES.map((y) => computeFlatEmi(loan, FLAT_RATE, y)),
    dispatch: Math.max(0, i.price - SARVATRA.booking - i.design_payment),
  };
}

/** Fills the Sarvatra template (readBundledTemplate("bundled:sarvatra")) with the form values → PDF bytes. */
export async function buildSarvatraQuotation(i: SarvatraInput, template: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template);
  const fonts = await embedHelvetica(doc);
  const k = sarvatraFigures(i);
  const name = `${i.title} ${i.customer_name}`.trim();
  const pages = doc.getPages();
  const units = (n: number) => `${inr(n)} units`;

  // 1 — cover
  editPage(doc, pages[0], [
    { kind: "text", at: [238.5, 199.9], to: 356.8, text: name, bold: true, align: "center", fit: 300 },
  ], fonts);
  // 3 — performance promise
  editPage(doc, pages[2], [
    { kind: "text", at: [504.4, 603.4], to: 548, text: units(k.units), bold: true, align: "right" },
    { kind: "text", at: [507.3, 575.7], to: 548, text: units(k.lowUnits), align: "right" },
    { kind: "text", at: [514, 547.9], to: 548, text: units(k.lost), align: "right" },
    { kind: "amount", rupee: [519.7, 521.7], at: [526.3, 521.7], to: 548, text: inr(k.payback), bold: true, align: "right" },
    { kind: "text", at: [56.7, 110.7], to: 96.2, text: inr(k.units), bold: true },
    { kind: "amount", rupee: [240.5, 110.7], at: [251.3, 110.7], to: 300.1, text: inr(k.yearly), bold: true, align: "left" },
    { kind: "amount", rupee: [467, 110.7], at: [477.8, 110.7], to: 516, text: inr(k.monthly), bold: true, align: "left" },
  ], fonts);
  // 4 — the offer (fit = the value's box, so long values shrink instead of running into the next one)
  editPage(doc, pages[3], [
    { kind: "text", at: [376.6, 800.7], to: 446.1, text: i.quote_no, bold: true, fit: true },
    { kind: "text", at: [474.5, 800.7], to: 516.7, text: i.date, bold: true },
    { kind: "text", at: [48, 704.7], to: 61.4, text: i.title, bold: true, fit: 36 },
    { kind: "text", at: [90, 704.7], to: 142.3, text: i.customer_name, bold: true, fit: 140 },
    { kind: "text", at: [255.3, 704.7], to: 306.8, text: i.contact, bold: true, fit: 125 },
    { kind: "text", at: [396.9, 704.7], to: 439.5, text: [i.city, STATE_CODES[i.state] ?? i.state].filter(Boolean).join(", "), bold: true, fit: 155 },
    { kind: "text", at: [73.5, 651.4], to: 80.6, text: num(i.kw), bold: true, fit: 44 },
    { kind: "line", at: [205.4, 655.2], to: 410.1, fit: 340, parts: [
      { text: i.panel_brand, bold: true },
      { text: ` - ${i.panel_type}`, like: [234.5, 655.2], bold: true },
      { text: ` ( ${k.panels} Panels)`, bold: true },
    ] },
    { kind: "line", at: [72, 608.7], to: 226.4, fit: 380, parts: [
      { text: i.inverter_brand, bold: true },
      { text: ` - ${num(i.inverter_kw)}`, like: [110.5, 608.7], bold: true },
      { text: ` kW ( ${i.phase} )`, bold: true },
    ] },
    { kind: "text", at: [472.3, 608.7], to: 504.4, text: i.inverter_location, bold: true, fit: 80 },
    { kind: "text", at: [72, 571.2], to: 112.1, text: i.connection_type, bold: true, fit: 120 },
    { kind: "text", at: [205.4, 571.2], to: 222, text: i.floors, bold: true, fit: 120 },
    { kind: "text", at: [338.9, 571.2], to: 350.8, text: i.solar_care ? "Yes" : "No", bold: true },
    { kind: "text", at: [472.3, 571.2], to: 489.3, text: i.roof_type, bold: true, fit: 80 },
    { kind: "text", at: [72, 532.9], to: 139.1, text: i.structure_type, bold: true, fit: 380 },
    { kind: "text", at: [509.7, 435.4], to: 545, text: inr(i.price), bold: true, align: "right" },
    { kind: "amount", rupee: [502.7, 403.2], at: [509.8, 403.2], to: 546.5, text: inr(i.price), bold: true, align: "right" },
    { kind: "text", at: [518.4, 371.7], to: 545, text: inr(k.central), bold: true, align: "right" },
    { kind: "text", at: [48.7, 338.7], to: 175.8, text: `State Govt. Subsidy (${i.state})`, fit: 380 },
    { kind: "text", at: [518.4, 339.4], to: 545, text: inr(i.state_subsidy), bold: true, align: "right" },
    { kind: "amount", rupee: [492.6, 304.2], at: [501.3, 304.2], to: 546.5, text: inr(k.net), bold: true, align: "right" },
  ], fonts);
  // 5 — financing table (1 / 3 / 5 years): per column the original [₹ x, number x];
  // numbers end at the column's right edge.
  const right = [329.2, 438.6, 548];
  const row = (y: number, xs: At[], values: number[], bold = false): Edit[] =>
    values.map((v, c) => ({ kind: "amount", rupee: [xs[c][0], y], at: [xs[c][1], y], to: right[c], text: inr(v), bold, align: "right" }));
  const wide: At[] = [[291.6, 297.9], [401, 407.3], [510.4, 516.7]];
  editPage(doc, pages[4], [
    ...row(697.9, wide, [i.price, i.price, i.price]),
    ...row(670.2, [[298.3, 304.6], [407.7, 414], [517.1, 523.4]], [k.down, k.down, k.down]),
    ...row(642.4, wide, [k.loan, k.loan, k.loan]),
    ...row(616.2, [[296.2, 302.8], [410.4, 416.9], [519.7, 526.3]], k.emis, true),
    ...row(589.9, [[301, 307.5], [410.4, 416.9], [519.7, 526.3]], [k.monthly, k.monthly, k.monthly], true),
    { kind: "amount", rupee: [515, 472.2], at: [521.5, 472.2], to: 548, text: inr(i.design_payment), bold: true, align: "right" },
    { kind: "amount", rupee: [507.6, 444.4], at: [514.1, 444.4], to: 548, text: inr(k.dispatch), bold: true, align: "right" },
    { kind: "text", at: [448.2, 383.7], to: 505.3, text: name, bold: true, align: "center", fit: 165 },
  ], fonts);

  return doc.save();
}

// "Central subsidy" / "State subsidy" / "Central + State subsidy" / "NA" — from the figures.
function subsidyLabel(i: SarvatraInput): string {
  const parts = [sarvatraFigures(i).central > 0 && "Central", i.state_subsidy > 0 && "State"].filter(Boolean);
  return parts.length ? `${parts.join(" + ")} subsidy` : "NA";
}

// PCR checkbox groups: each option's box (bottom-left), in the order of its SARVATRA list.
const PCR_BOXES = {
  inverterType: [[125.3, 470.7], [174, 470.7], [222.8, 470.7]],
  maintenance: [[125.3, 431.7], [192, 431.7], [264, 431.7], [330.8, 431.7], [402.8, 431.7]],
  readiness: [[125.3, 391.9], [226.5, 391.9], [360.8, 391.9]],
  billCorrection: [[125.3, 373.2], [197.3, 373.2], [270.8, 373.2]], // + NA below
  billNa: [339, 373.2],
  paymentMode: [[481.5, 257.7], [523.5, 257.7]],
} satisfies Record<string, At[] | At>;

/** Fills the Sarvatra Project Confirmation Receipt (readBundledTemplate("bundled:sarvatra-pcr")) → PDF bytes. */
export async function buildSarvatraPcr(i: SarvatraInput, template: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template);
  const fonts = await embedHelvetica(doc);
  // A value in a form box: bold, left-aligned, shrunk to fit the box when longer.
  const v = (at: At, to: number, text: string, box: number): Edit => ({ kind: "text", at, to, text, bold: true, fit: box });
  const group = (boxes: At[], options: readonly string[], chosen: (o: string) => boolean): Edit[] =>
    boxes.map((at, n) => ({ kind: "check", at, on: chosen(options[n]) }));

  editPage(doc, doc.getPages()[0], [
    // customer details
    v([98.6, 712.2], 111, i.title, 22),
    v([123.4, 712.2], 172.4, i.customer_name, 175),
    v([451.4, 712.2], 500.4, i.ebill_name, 118),
    v([123.4, 686.7], 171.4, i.contact, 175),
    v([374.4, 686.7], 422.7, i.quote_no.replace(/^Quote_/i, ""), 195),
    v([67.5, 661.2], 159.7, i.email, 230),
    v([358.4, 661.2], 416.1, i.k_number, 210),
    v([69.9, 635.7], 235.5, i.address, 228),
    v([388, 635.7], 407.6, i.sanctioned_load ? `${i.sanctioned_load} KW` : "", 180),
    v([70.6, 610.2], 99.4, i.pincode, 228),
    v([363.9, 610.2], 433.8, [i.city, i.state].filter(Boolean).join(", "), 205),
    v([356.9, 584.7], 406.3, i.spc_name, 210),
    v([82.2, 583.9], 129.7, i.date, 190),
    // project details
    v([126.7, 532.9], 131.6, num(i.kw), 58),
    v([284.9, 532.9], 347.1, subsidyLabel(i), 125),
    v([126.7, 512.7], 149.8, i.panel_brand, 125),
    v([317.5, 512.7], 378.6, i.cell_type, 95),
    v([444.7, 512.7], 493.5, i.dcr_type, 52),
    v([520.5, 512.7], 552.5, i.wp, 50),
    v([126.7, 492.4], 158.6, i.inverter_brand, 230),
    v([387.2, 492.4], 392, num(i.inverter_kw), 47),
    v([516, 492.4], 541, i.phase.replace(/\s*phase$/i, ""), 54),
    ...group(PCR_BOXES.inverterType, SARVATRA.inverterTypes, (o) => o === i.inverter_type),
    v([126.7, 453.4], 188.4, i.structure_type, 350),
    v([528, 453.4], 532.8, i.floors.replace(/^G\s*\+\s*/i, ""), 40),
    ...group(PCR_BOXES.maintenance, SARVATRA.maintenancePlans, (o) => o === i.maintenance_plan),
    v([161.8, 413.7], 173.2, i.maintenance_others || "NA", 73),
    ...group(PCR_BOXES.readiness, SARVATRA.siteReadiness, (o) => o === i.site_readiness),
    ...group(PCR_BOXES.billCorrection, SARVATRA.billCorrections, (o) => i.bill_correction.includes(o)),
    { kind: "check", at: PCR_BOXES.billNa, on: i.bill_correction.length === 0 },
    // payment details
    v([137.6, 301.2], 177.8, `${inr(i.price)}/-`, 150),
    v([415.2, 301.2], 428.6, i.finance_by, 155),
    v([137.6, 280.2], 170.4, `${inr(SARVATRA.booking)}/-`, 150),
    v([476.2, 280.2], 523.8, i.date, 80),
    v([126.7, 259.2], 141, i.payment_method, 280),
    ...group(PCR_BOXES.paymentMode, SARVATRA.paymentModes, (o) => o === i.payment_mode),
  ], fonts);

  return doc.save();
}

// Agreement short forms, as in their sample ("GI", "DCR & NDCR").
const STRUCTURE_SHORT: Record<string, string> = { "galvanised iron": "GI", "galvanium iron": "GI", "hot-dip galvanised": "HDGI" };

/** Fills the Sarvatra consumer–vendor agreement (readBundledTemplate("bundled:sarvatra-agreement")) → PDF bytes.
 *  Values are written in the agreement's own font when it has every character. */
export async function buildSarvatraAgreement(i: SarvatraInput, template: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template);
  const fonts = await embedHelvetica(doc);
  const k = sarvatraFigures(i);
  const pages = doc.getPages();
  const v = (at: At, to: number, text: string, box: number): Edit => ({ kind: "text", at, to, text, bold: true, fit: box, native: true });

  // 1 — parties
  editPage(doc, pages[0], [
    v([205.7, 730.9], 256.6, i.date, 110),
    v([337, 730.9], 365.2, i.city, 48),
    v([53.4, 648.4], 66.9, i.title, 62),
    v([122.1, 648.4], 179.8, i.customer_name, 120),
    v([53.4, 633.4], 300.7, i.address, 275),
    v([421.7, 633.4], 483.7, i.k_number, 78),
    v([53.4, 618.4], 138.3, i.aen, 104),
  ], fonts);
  // 5 — Annexure A, system specification
  editPage(doc, pages[4], [
    v([258.5, 743.7], 285, `${num(i.kw)} kWp`, 280),
    v([258.5, 721.2], 283.5, i.panel_brand, 280),
    v([258.5, 697.9], 315.3, `${i.wp.replace(/\s*wp$/i, " Wp")} x ${k.panels}`, 280),
    v([258.5, 675.4], 315.5, i.dcr_type === "Both" ? "DCR & NDCR" : i.dcr_type, 280),
    v([258.5, 652.9], 323, `${i.inverter_brand}_ ${num(i.inverter_kw)} KW`, 280),
    v([258.5, 630.4], 285.5, i.phase.replace(/\s*phase$/i, ""), 280),
    v([258.5, 607.9], 268, STRUCTURE_SHORT[i.structure_type.trim().toLowerCase()] ?? i.structure_type, 280),
  ], fonts);
  // 6 — Annexure B, cost & payment schedule (booking stays ₹10,000)
  editPage(doc, pages[5], [
    v([147.2, 748.9], 183.7, inr(i.price), 55),
    v([332.9, 748.9], 442.9, `Rupees ${numberToWordsIndian(i.price)} Only`, 212),
    v([462.9, 677.7], 503.5, `₹ ${inr(i.design_payment)}/-`, 75),
    v([462.9, 655.2], 511, `₹ ${inr(k.dispatch)}/-`, 75),
  ], fonts);

  return doc.save();
}
