// Server-only. The standard quotation — Capital Craft's own proposal for every
// EPC without a builder of its own, drawn from scratch from a saved quotation
// (lib/quote-calc QuoteDoc; no template file, so no customer's sample data
// anywhere). In the EPC's accent colour, residential or commercial, in order:
//   offer    — the EPC's letterhead, the customer, the letter, the figures at a glance (page 1)
//   system   — the plant, the savings and the 25-year savings chart (can be switched off)
//   price    — the items (lump sum: bill of material; per item: HSN / qty / rate / GST),
//              the price with CGST + SGST or IGST, subsidy, net cost, the EMI box
//   terms    — payment, timeline, warranty, scope, subsidy & documents, terms, notes,
//              bank details, signature + stamp
// After page 1 the sections flow on (a short block moves to the next page whole).
// Every page carries the EPC's letterhead and a "Powered by Capital Craft" footer.

import { PDFDocument, PDFPage, PDFImage, rgb, type RGB } from "pdf-lib";
import { embedHelvetica, inr, num, printable, textWidth, wrap, type Fonts } from "./pdf-template";
import { STANDARD } from "./quotation-brands";
import { quoteEmis, quoteSavings, quoteTotals, type QuoteDoc } from "./quote-calc";
import { ACCENTS } from "./org-profile";
import { rupeesInWords } from "./numberToWords";

export type StdOrg = {
  name: string;
  address: string;
  gstin: string;
  phone: string;
  email: string;
  website: string;
  contact: string;           // the point of contact on the offer
  state: string;             // the EPC's own state (CGST + SGST vs IGST)
  accent: string | null;     // #rrggbb
  bank: { name: string; holder: string; account: string; ifsc: string; branch: string } | null;
  logo: Buffer | null;       // PNGs from epc_org_profile
  signature: Buffer | null;
  stamp: Buffer | null;
};

// ── Look ────────────────────────────────────────────────────────────────────
const W = 595.28, H = 841.89, M = 40, CW = W - 2 * M;
const HEADER_END = 104, FOOTER_TOP = H - 44;
type Rgb3 = [number, number, number];
const hex3 = (h: string): Rgb3 => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix = (a: Rgb3, b: Rgb3, t: number): RGB => rgb(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
const WHITE3: Rgb3 = [1, 1, 1];

// The page colours from the EPC's accent (headings, table heads, EMI box) + a warm highlight.
function palette(accent: string | null) {
  const a = hex3(/^#[0-9a-f]{6}$/i.test(accent || "") ? accent! : ACCENTS[0]);
  return {
    primary: rgb(...a), soft: mix(a, WHITE3, 0.93), panel: mix(a, WHITE3, 0.14), faint: mix(a, WHITE3, 0.72),
    accent: rgb(0.949, 0.647, 0.086), warm: rgb(1, 0.961, 0.871), warmInk: rgb(0.541, 0.353, 0),
    ink: rgb(0.122, 0.161, 0.216), muted: rgb(0.4, 0.439, 0.522), line: rgb(0.886, 0.902, 0.933), white: rgb(1, 1, 1),
  };
}
type Palette = ReturnType<typeof palette>;
const rs = (n: number) => `Rs. ${inr(n)}`;
const dmy = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
type TextOpts = { size?: number; bold?: boolean; color?: RGB; align?: "left" | "right" | "center"; max?: number };
type Col = { w: number; align?: "left" | "right" | "center" };

// A small layout kit over pdf-lib, in top-down coordinates (y = distance from the top).
class Sheet {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  constructor(readonly doc: PDFDocument, readonly f: Fonts, readonly c: Palette, private header: (s: Sheet) => void) {}

  add() {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    this.header(this);
    this.y = HEADER_END + 18;
  }
  /** Room for `h` more points on this page, else a new page. */
  need(h: number) { if (this.y + h > FOOTER_TOP - 10) this.add(); }

  text(s: string, x: number, y: number, o: TextOpts = {}) {
    const font = o.bold ? this.f.bold : this.f.reg;
    let size = o.size ?? 9.5;
    const t = printable(font, s);
    let w = textWidth(font, t, size);
    if (o.max && w > o.max) { size = (size * o.max) / w; w = o.max; }
    const left = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    this.page.drawText(t, { x: left, y: H - y, size, font, color: o.color ?? this.c.ink });
    return w;
  }
  lines(s: string, size: number, max: number, bold = false) {
    const font = bold ? this.f.bold : this.f.reg;
    return String(s ?? "").split(/\r?\n/).flatMap((p) => wrap(printable(font, p), (t) => textWidth(font, t, size), max, 999));
  }
  /** Wrapped text from the cursor; moves the cursor below it. */
  para(s: string, o: TextOpts & { x?: number; width?: number; lead?: number } = {}) {
    const size = o.size ?? 9.5, lead = o.lead ?? size * 1.45;
    for (const l of this.lines(s, size, o.width ?? CW, o.bold)) {
      this.need(lead);
      this.text(l, o.x ?? M, this.y + size, { ...o, max: undefined });
      this.y += lead;
    }
  }
  rect(x: number, y: number, w: number, h: number, color: RGB, border?: RGB) {
    this.page.drawRectangle({ x, y: H - y - h, width: w, height: h, color, borderColor: border, borderWidth: border ? 0.7 : 0 });
  }
  round(x: number, y: number, w: number, h: number, r: number, color: RGB, border?: RGB) {
    const p = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    this.page.drawSvgPath(p, { x, y: H - y, color, borderColor: border, borderWidth: border ? 0.7 : 0 });
  }
  hline(x: number, y: number, w: number, color = this.c.line, t = 0.7) {
    this.page.drawLine({ start: { x, y: H - y }, end: { x: x + w, y: H - y }, thickness: t, color });
  }
  image(img: PDFImage, x: number, y: number, maxW: number, maxH: number) {
    const sc = Math.min(maxW / img.width, maxH / img.height);
    this.page.drawImage(img, { x, y: H - y - img.height * sc, width: img.width * sc, height: img.height * sc });
    return img.width * sc;
  }
  /** A section heading with the accent bar. */
  heading(s: string) {
    this.need(34);
    this.y += 6;
    this.rect(M, this.y, 3, 14, this.c.accent);
    this.text(s, M + 10, this.y + 11, { size: 12.5, bold: true, color: this.c.primary });
    this.y += 24;
  }

  /** How tall table() would draw — to keep a short table with its heading on one page. */
  tableHeight(cols: Col[], head: string[] | null, rows: string[][], o: { size?: number; strong?: (i: number) => boolean } = {}) {
    const size = o.size ?? 8.8, pad = 5, lead = size * 1.3;
    return (head ? 20 : 0) + rows.reduce((a, r, ri) =>
      a + Math.max(...r.map((cell, i) => this.lines(cell, size, cols[i].w - 2 * pad, !!o.strong?.(ri)).length)) * lead + 2 * pad - (lead - size), 0);
  }
  /** A table: a header row in the accent colour, then rows with wrapped cells (zebra). Splits across pages.
   *  A cell's text may hold "\n": its first line bold (an item name over its description). */
  table(cols: Col[], head: string[] | null, rows: string[][],
    o: { size?: number; shade?: (i: number) => RGB | null; strong?: (i: number) => boolean; twoLine?: number } = {}) {
    const size = o.size ?? 8.8, pad = 5, lead = size * 1.3;
    const xs = cols.reduce<number[]>((a, _c, i) => [...a, i ? a[i - 1] + cols[i - 1].w : M], []);
    const drawHead = () => {
      if (!head) return;
      this.rect(M, this.y, CW, 20, this.c.primary);
      head.forEach((h, i) => this.cell(h, xs[i], cols[i], this.y + 13.5, size, true, this.c.white));
      this.y += 20;
    };
    this.need(20 + lead + 2 * pad);
    drawHead();
    rows.forEach((r, ri) => {
      const bold = !!o.strong?.(ri);
      const wrapped = r.map((cell, i) => this.lines(cell, size, cols[i].w - 2 * pad, bold));
      const h = Math.max(...wrapped.map((l) => l.length)) * lead + 2 * pad - (lead - size);
      if (this.y + h > FOOTER_TOP - 10) { this.add(); drawHead(); }
      this.rect(M, this.y, CW, h, o.shade?.(ri) ?? (ri % 2 ? this.c.soft : this.c.white));
      wrapped.forEach((l, i) => l.forEach((t, k) => {
        const first = o.twoLine === i && k === 0 && r[i].includes("\n");
        this.cell(t, xs[i], cols[i], this.y + pad + size + k * lead - 1, size, bold || first, o.twoLine === i && k > 0 && r[i].includes("\n") ? this.c.muted : this.c.ink);
      }));
      this.hline(M, this.y + h, CW);
      this.y += h;
    });
  }
  private cell(t: string, x: number, c: Col, y: number, size: number, bold: boolean, color: RGB) {
    const pad = 5;
    const at = c.align === "right" ? x + c.w - pad : c.align === "center" ? x + c.w / 2 : x + pad;
    this.text(t, at, y, { size, bold, color, align: c.align ?? "left" });
  }
}

/** The quotation → PDF bytes. ccMark = Capital Craft's mark (PNG) for the footer. */
export async function buildStandardQuotation(doc: QuoteDoc, quoteNo: string, org: StdOrg, ccMark: Buffer | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Quotation ${quoteNo} - ${doc.customer.name}`);
  pdf.setAuthor(org.name);
  pdf.setProducer("Capital Craft");
  const f = await embedHelvetica(pdf);
  const png = (b: Buffer | null) => (b ? pdf.embedPng(b).catch(() => null) : Promise.resolve(null));
  const [logo, mark, signature, stamp] = await Promise.all([png(org.logo), png(ccMark), png(org.signature), png(org.stamp)]);
  const c = palette(org.accent);
  const resi = doc.segment === "residential";
  const t = quoteTotals(doc, org.state);
  const pays = resi && t.eligible ? t.net : t.total;
  const sv = quoteSavings(doc.kw, doc.tariff, pays);
  const kw = num(doc.kw);
  const cust = doc.customer;
  const mod = doc.items.find((it) => it.key === "std_module");
  const inv = doc.items.find((it) => it.key === "std_inverter");
  const panels = parseInt(mod?.qty || "", 10) || 0;
  const wp = (/(\d{3,4})\s*wp/i.exec(mod?.spec || "") || [])[1] || "";
  const dcrText = doc.dcr ? "DCR" : "Non-DCR";
  const payback = sv.payback ? `${num(+sv.payback.toFixed(1))} years` : "-";
  const sheet = new Sheet(pdf, f, c, (s) => letterhead(s, org, logo, quoteNo, dmy(doc.date)));
  sheet.add();

  // ── 1 · Offer ────────────────────────────────────────────────────────────
  sheet.text("Techno-Commercial Offer", M, sheet.y + 20, { size: 22, bold: true, color: c.primary });
  sheet.y += 34;
  sheet.text(`${kw} kWp ${doc.system_type} Rooftop Solar Power Plant`, M, sheet.y + 12, { size: 13 });
  sheet.y += 22;
  const tag = resi ? "PM Surya Ghar: Muft Bijli Yojana" : `${cust.category || "Non-Domestic"} · ${doc.phase}`;
  const tw = textWidth(f.bold, printable(f.bold, tag), 8.5) + 20;
  sheet.round(M, sheet.y, tw, 18, 9, c.warm);
  sheet.text(tag, M + 10, sheet.y + 12.3, { size: 8.5, bold: true, color: c.warmInk });
  sheet.y += 32;

  const colW = (CW - 14) / 2, boxTop = sheet.y;
  const site = cust.shipping.trim();
  const forRows: [string, string][] = [
    ["Name", cust.name], ["Mobile", cust.mobile ? `+91 ${cust.mobile}` : ""], ["Email", cust.email], ["GSTIN", cust.gstin],
    ["Billing address", cust.billing], ...(site && site !== cust.billing.trim() ? [["Site address", site] as [string, string]] : []),
    ["Place of supply", cust.state], ["K. No.", cust.k_number], ["DISCOM", cust.discom],
    ...(resi ? [] : [["Sanctioned load", cust.sanctioned_load ? `${cust.sanctioned_load} kW` : ""] as [string, string]]),
  ];
  const offerRows: [string, string][] = [
    ["Quotation no.", quoteNo], ["Date", dmy(doc.date)], ["Valid till", dmy(doc.valid_till)],
    ["Plant capacity", `${kw} kWp`], ["Connection", `${doc.phase}${resi ? "" : `, ${cust.category || "Non-Domestic"}`}`],
    ["Prepared by", org.contact], ["Phone", org.phone ? `+91 ${org.phone}` : ""],
  ];
  const hA = infoBox(sheet, M, boxTop, colW, "Prepared for", forRows.filter(([, v]) => v));
  const hB = infoBox(sheet, M + colW + 14, boxTop, colW, "Offer details", offerRows.filter(([, v]) => v));
  sheet.y = boxTop + Math.max(hA, hB) + 20;

  sheet.para(`Dear ${cust.name || "Sir / Madam"},`, { bold: true, size: 10 });
  sheet.y += 4;
  sheet.para(resi
    ? `Thank you for considering solar for your home. We are pleased to offer a ${kw} kWp ${doc.system_type.toLowerCase()} rooftop solar power plant${t.eligible ? " under the PM Surya Ghar: Muft Bijli Yojana" : ""}, designed for your roof and your electricity use. It is expected to produce about ${inr(sv.units)} units a year${sv.payback ? ` and to pay for itself in about ${payback}` : ""}, then keep saving for 25 years and more.`
    : `Thank you for your enquiry. We are pleased to submit our techno-commercial offer for the design, supply, installation and commissioning of a ${kw} kWp ${doc.system_type.toLowerCase()} rooftop solar power plant at your premises. It is expected to produce about ${inr(sv.units)} units a year and to cut your electricity bill from the first month.`,
    { size: 10 });
  sheet.y += 4;
  sheet.para(`The pages that follow set out the system${doc.show_savings ? ", your savings" : ""}, the ${t.lines ? "items" : "bill of material"}, the price and our terms.`, { size: 10 });
  sheet.y += 14;

  sheet.heading("At a glance");
  kpis(sheet, [
    ["Plant capacity", `${kw} kWp`],
    ["Solar panels", panels ? `${panels} x ${wp ? `${wp} Wp` : "panels"}` : "-"],
    ["Generation a year", `${inr(sv.units)} units`],
    ["Savings a year", rs(sv.savings)],
    ["Payback", payback],
    [resi && t.eligible ? "Cost after subsidy" : "Total cost", rs(pays)],
  ]);

  // From here the sections flow page to page: a short block (a heading with its
  // table) starts a new page only when it doesn't fit; a long item list splits,
  // its header repeated. HEAD = a heading's height.
  const HEAD = 34;

  // ── System & savings ─────────────────────────────────────────────────────
  if (doc.show_savings) {
    const sysCols: Col[] = [{ w: 170 }, { w: CW - 170 }];
    const sysRows = [
      ["Plant capacity", `${kw} kWp`],
      ["System type", `${doc.system_type} rooftop solar${doc.system_type === "Hybrid" ? " with battery backup" : doc.system_type === "Off-grid" ? " with battery storage, not connected to the grid" : ", connected to the grid with net metering"}`],
      ["Connection", `${doc.phase}${cust.category ? `, ${cust.category}` : ""}`],
      ["Solar modules", [panels ? `${panels} Nos.` : "", mod?.spec, dcrText, mod?.make].filter(Boolean).join(" · ")],
      ["Inverter", [inv?.spec, inv?.make].filter(Boolean).join(" · ")],
      ["Expected generation", `About ${inr(sv.units)} units a year (${inr(STANDARD.unitsPerKw)} units per kW)`],
    ];
    sheet.y += 6;
    sheet.need(HEAD + sheet.tableHeight(sysCols, null, sysRows, { size: 9.2 }));
    sheet.heading("System details");
    sheet.table(sysCols, null, sysRows, { size: 9.2, shade: () => null });
    sheet.y += 18;

    sheet.need(HEAD + 64 + 6 + 178 + 8 + 26); // the cards, the chart and its note stay together
    sheet.heading("Your savings");
    kpis(sheet, [["Savings in year 1", rs(sv.savings)], ["Savings over 25 years", rs(sv.lifetime)], ["Payback", payback]]);
    sheet.y += 6;
    chart(sheet, sv.years);
    sheet.y += 8;
    sheet.para(`Worked out at Rs. ${num(doc.tariff)} a unit rising ${num(STANDARD.tariffRise * 100)}% a year, with panel output falling ${num(STANDARD.degradation * 100)}% a year. Actual generation depends on the site, the weather and upkeep.`,
      { size: 8, color: c.muted });
  }

  // ── Items & price ────────────────────────────────────────────────────────
  sheet.y += 10;
  sheet.need(HEAD + 20 + 3 * 26); // the heading with the table head and a few rows
  const itemName = (it: QuoteDoc["items"][number]) => it.key === "std_module" ? `${it.spec} (${dcrText})` : it.spec;
  if (t.lines) {
    sheet.heading("Items");
    sheet.table(
      [{ w: 24, align: "center" }, { w: 218 }, { w: 56, align: "center" }, { w: 52, align: "center" }, { w: 66, align: "right" }, { w: 36, align: "center" }, { w: CW - 452, align: "right" }],
      ["#", "Item & description", "HSN/SAC", "Qty", "Rate", "GST", "Amount"],
      doc.items.map((it, n) => [String(n + 1), [it.item, [itemName(it), it.make].filter(Boolean).join(" · ")].filter(Boolean).join("\n"),
        it.hsn, [it.qty, it.unit].filter(Boolean).join(" "), inr(it.rate), `${num(it.gst)}%`, inr(t.amounts[n])]),
      { twoLine: 1 },
    );
  } else {
    sheet.heading("Bill of material");
    sheet.table(
      [{ w: 26, align: "center" }, { w: 128 }, { w: 192 }, { w: 108 }, { w: CW - 454, align: "center" }],
      ["S.No.", "Item", "Specification", "Make", "Qty"],
      doc.items.map((it, n) => [String(n + 1), it.item, itemName(it), it.make, [it.qty, it.unit].filter(Boolean).join(" ")]),
    );
  }
  sheet.y += 18;

  const rows: [string, string][] = [
    t.lines ? ["Sub total", rs(t.base)] : ["Supply, installation & commissioning of the solar power plant", rs(t.base)],
  ];
  if (t.discount) rows.push(["Discount", `- ${rs(t.discount)}`]);
  t.taxes.forEach(({ rate, amount }) => {
    if (t.intra) {
      const half = Math.round(amount / 2);
      rows.push([`CGST @ ${num(rate / 2)}%`, rs(half)], [`SGST @ ${num(rate / 2)}%`, rs(amount - half)]);
    } else rows.push([`IGST @ ${num(rate)}%`, rs(amount)]);
  });
  const TOTAL = "Total (incl. GST)", NET = "Your cost after subsidy";
  rows.push([TOTAL, rs(t.total)]);
  if (resi) {
    rows.push(["Central subsidy (PM Surya Ghar)", t.eligible ? `- ${rs(t.central)}` : `Not applicable (${doc.system_type === "Off-grid" ? "off-grid" : "Non-DCR"})`]);
    if (t.state) rows.push(["State subsidy", `- ${rs(t.state)}`]);
    if (t.eligible) rows.push([NET, rs(t.net)]);
  } else rows.push(["Government subsidy", "Not applicable"]);
  const priceCols: Col[] = [{ w: CW - 150 }, { w: 150, align: "right" }];
  const strong = (n: number) => rows[n][0] === TOTAL || rows[n][0] === NET;
  sheet.need(HEAD + sheet.tableHeight(priceCols, ["Description", "Amount"], rows, { size: 9.4, strong }) + 40);
  sheet.heading("Commercial offer");
  sheet.table(priceCols, ["Description", "Amount"], rows, { size: 9.4, shade: (n) => (strong(n) ? c.warm : null), strong });
  sheet.y += 8;
  sheet.para(`${resi && t.eligible ? "Cost after subsidy" : "Total cost"} in words: ${rupeesInWords(Math.round(pays))}.`, { size: 8.6, color: c.muted });
  sheet.para(`Works out to ${rs(t.perKw)} per kW including GST.${doc.discom_included ? " DISCOM and net-metering fees are included." : " DISCOM and net-metering fees are paid by the customer."}`, { size: 8.6, color: c.muted });
  sheet.y += 12;
  if (doc.show_emi) emiBox(sheet, t.total, quoteEmis(t.total));

  // ── Terms ────────────────────────────────────────────────────────────────
  sheet.y += 6;
  if (doc.payment.length) {
    const payCols: Col[] = [{ w: CW - 190 }, { w: 60, align: "center" }, { w: 130, align: "right" }];
    const payRows = doc.payment.map(([stage, pct]) => [stage, `${num(pct)}%`, rs((t.total * pct) / 100)]);
    sheet.need(HEAD + sheet.tableHeight(payCols, ["Stage", "Share", "Amount"], payRows, { size: 9 }) + 40);
    sheet.heading("Payment terms");
    sheet.table(payCols, ["Stage", "Share", "Amount"], payRows, { size: 9 });
    sheet.y += 8;
  }
  if (doc.timeline) sheet.para(`Timeline: ${doc.timeline}`, { size: 9 });
  sheet.para(`Validity: this offer is valid till ${dmy(doc.valid_till)}.`, { size: 9 });
  sheet.y += 10;

  if (doc.warranty.length) {
    const wCols: Col[] = [{ w: 190 }, { w: CW - 190 }];
    const wRows = doc.warranty.map(([a, b]) => [a, b]);
    sheet.need(HEAD + sheet.tableHeight(wCols, null, wRows, { size: 9 }));
    sheet.heading("Warranty");
    sheet.table(wCols, null, wRows, { size: 9 });
    sheet.y += 14;
  }

  const fees = "DISCOM and net-metering fees";
  const ours = [...doc.scope_ours, ...(doc.discom_included ? [fees] : [])].filter((x) => x.trim());
  const theirs = [...doc.scope_theirs, ...(doc.discom_included ? [] : [fees])].filter((x) => x.trim());
  if (ours.length || theirs.length) {
    sheet.need(HEAD + 18 + Math.max(ours.length, theirs.length) * 14.4);
    sheet.heading("Scope of work");
    twoLists(sheet, ["Included in our scope", ours], ["Customer's scope", theirs]);
    sheet.y += 12;
  }

  if (resi) {
    sheet.need(HEAD + 70);
    sheet.heading("Subsidy & documents");
    if (t.eligible) {
      sheet.para(`The central subsidy of ${rs(t.central)} is credited by the Government directly to the customer's bank account after commissioning and inspection, usually within 30 to 90 days. The amount and its timing follow the scheme's rules at that time.`, { size: 9 });
      sheet.y += 4;
    }
    sheet.para("Documents needed: Aadhaar card, latest electricity bill, PAN card, bank passbook or cancelled cheque, passport-size photo, mobile number and email.", { size: 9 });
    sheet.y += 12;
  }

  if (doc.terms.trim()) {
    sheet.need(HEAD + 40);
    sheet.heading("Terms & conditions");
    bullets(sheet, doc.terms.split(/\r?\n/).map((l) => l.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean));
    sheet.y += 10;
  }
  if (doc.notes.trim()) {
    sheet.need(HEAD + 30);
    sheet.heading("Notes");
    sheet.para(doc.notes, { size: 9 });
    sheet.y += 10;
  }

  bankAndSign(sheet, org, signature, stamp);

  // Footer on every page, now that the page count is known.
  sheet.pages.forEach((p, n) => footer(sheet, p, n + 1, sheet.pages.length, mark));
  return pdf.save();
}

// ── Pieces ──────────────────────────────────────────────────────────────────

// The EPC's letterhead: logo (or its initial), name, address, GSTIN · phone · email · website; the quotation no. + date.
function letterhead(s: Sheet, org: StdOrg, logo: PDFImage | null, quoteNo: string, date: string) {
  let x = M;
  if (logo) x += s.image(logo, x, 30, 110, 46) + 12;
  else {
    s.round(x, 30, 44, 44, 10, s.c.primary);
    s.text((org.name || "S").slice(0, 1).toUpperCase(), x + 22, 60, { size: 22, bold: true, color: s.c.white, align: "center" });
    x += 56;
  }
  const textW = W - M - 140 - x;
  s.text(org.name, x, 44, { size: 14.5, bold: true, color: s.c.primary, max: textW });
  const addr = s.lines(org.address, 7.8, textW).slice(0, 2);
  addr.forEach((l, n) => s.text(l, x, 57 + n * 10, { size: 7.8, color: s.c.muted }));
  const contact = [org.gstin && `GSTIN ${org.gstin}`, org.phone && `+91 ${org.phone}`, org.email, org.website].filter(Boolean).join("  ·  ");
  s.text(contact, x, 57 + addr.length * 10 + 1, { size: 7.8, color: s.c.muted, max: textW });

  s.text("QUOTATION", W - M, 42, { size: 8, bold: true, color: s.c.accent, align: "right" });
  s.text(quoteNo, W - M, 57, { size: 10.5, bold: true, color: s.c.primary, align: "right", max: 135 });
  s.text(date, W - M, 70, { size: 8.5, color: s.c.muted, align: "right" });

  s.rect(M, HEADER_END - 14, CW, 1.6, s.c.primary);
  s.rect(M, HEADER_END - 11.4, 70, 1.6, s.c.accent);
}

function footer(s: Sheet, p: PDFPage, n: number, of: number, mark: PDFImage | null) {
  const y = H - FOOTER_TOP;
  p.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.6, color: s.c.line });
  let x = M;
  if (mark) {
    const sc = 11 / mark.height;
    p.drawImage(mark, { x, y: y - 21, width: mark.width * sc, height: 11 });
    x += mark.width * sc + 5;
  }
  p.drawText("Powered by Capital Craft", { x, y: y - 18.5, size: 7.5, font: s.f.reg, color: s.c.muted });
  const label = `Page ${n} of ${of}`;
  p.drawText(label, { x: W - M - textWidth(s.f.reg, label, 7.5), y: y - 18.5, size: 7.5, font: s.f.reg, color: s.c.muted });
}

// A titled box of label / value rows; returns its height.
function infoBox(s: Sheet, x: number, y: number, w: number, title: string, rows: [string, string][]) {
  const size = 8.8, lead = 12.2;
  const lw = Math.min(w * 0.45, Math.max(...rows.map(([l]) => textWidth(s.f.reg, printable(s.f.reg, l), 8.2))) + 12);
  const vw = w - lw - 24;
  const wrapped = rows.map(([, v]) => s.lines(v, size, vw, true));
  const h = 30 + wrapped.reduce((a, l) => a + l.length * lead + 3, 0) + 6;
  s.round(x, y, w, h, 8, s.c.soft);
  s.text(title.toUpperCase(), x + 12, y + 18, { size: 7.8, bold: true, color: s.c.accent });
  let yy = y + 32;
  rows.forEach(([l], n) => {
    s.text(l, x + 12, yy + size, { size: 8.2, color: s.c.muted });
    wrapped[n].forEach((t, k) => s.text(t, x + 12 + lw, yy + size + k * lead, { size, bold: true, max: vw }));
    yy += wrapped[n].length * lead + 3;
  });
  return h;
}

// Figure cards, 3 to a row.
function kpis(s: Sheet, items: [string, string][]) {
  const gap = 10, w = (CW - 2 * gap) / 3, h = 54;
  for (let r = 0; r < items.length; r += 3) {
    s.need(h + gap);
    items.slice(r, r + 3).forEach(([label, value], k) => {
      const x = M + k * (w + gap);
      s.round(x, s.y, w, h, 8, s.c.white, s.c.line);
      s.rect(x, s.y + 12, 2.5, h - 24, s.c.accent);
      s.text(label, x + 14, s.y + 20, { size: 8, color: s.c.muted });
      s.text(value, x + 14, s.y + 40, { size: 14, bold: true, color: s.c.primary, max: w - 24 });
    });
    s.y += h + gap;
  }
}

// The yearly savings over 25 years.
function chart(s: Sheet, years: number[]) {
  const h = 150, left = M + 44, w = CW - 52;
  s.need(h + 34);
  const top = s.y;
  // Four round steps just above the highest bar.
  const raw = Math.max(...years, 1) / 4;
  const step = [5, 10, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500].map((x) => x * 1000).find((x) => x >= raw)
    ?? Math.ceil(raw / 500000) * 500000;
  const max = step * 4;
  for (let n = 0; n <= 4; n++) {
    const y = top + 8 + (h * n) / 4;
    s.hline(left, y, w, s.c.line, 0.5);
    const v = max - step * n;
    s.text(!v ? "0" : v >= 100000 ? `${num(+(v / 100000).toFixed(2))}L` : `${num(v / 1000)}k`, left - 6, y + 3, { size: 7, color: s.c.muted, align: "right" });
  }
  const bw = w / years.length;
  years.forEach((v, n) => {
    const bh = (v / max) * h;
    s.rect(left + n * bw + bw * 0.18, top + 8 + h - bh, bw * 0.64, bh, n === 0 ? s.c.accent : s.c.primary);
    if (n === 0 || (n + 1) % 5 === 0) s.text(`Yr ${n + 1}`, left + n * bw + bw / 2, top + h + 20, { size: 7, color: s.c.muted, align: "center" });
  });
  s.y = top + h + 28;
}

// "Easy EMI with Capital Craft" — indicative EMIs on the total cost.
function emiBox(s: Sheet, total: number, emi: { years: number; emi: number }[]) {
  const h = 92;
  s.need(h + 22);
  s.round(M, s.y, CW, h, 10, s.c.primary);
  s.text("Easy EMI with Capital Craft", M + 16, s.y + 22, { size: 12, bold: true, color: s.c.white });
  s.text(`Finance the plant on easy monthly instalments. Loan amount ${rs(total)}.`, M + 16, s.y + 36, { size: 8.3, color: s.c.faint });
  const bw = (CW - 32 - 2 * 10) / 3;
  emi.forEach((e, n) => {
    const x = M + 16 + n * (bw + 10);
    s.round(x, s.y + 46, bw, 36, 7, s.c.panel);
    s.text(`${e.years} years`, x + 10, s.y + 60, { size: 7.8, color: s.c.faint });
    s.text(`${rs(e.emi)} / month`, x + 10, s.y + 75, { size: 10.5, bold: true, color: s.c.white, max: bw - 20 });
  });
  s.y += h + 6;
  s.text("Indicative EMI; the final amount, rate and tenure are as approved by the lender.", M, s.y + 7, { size: 7.5, color: s.c.muted });
  s.y += 14;
}

// A bullet list across the page.
function bullets(s: Sheet, items: string[]) {
  const size = 9, lead = 12.6;
  items.forEach((t) => {
    const l = s.lines(t, size, CW - 14);
    s.need(l.length * lead + 2);
    s.rect(M + 1, s.y + 5, 3.2, 3.2, s.c.accent);
    l.forEach((line, k) => s.text(line, M + 12, s.y + size + k * lead, { size }));
    s.y += l.length * lead + 2;
  });
}

// Two bullet lists side by side.
function twoLists(s: Sheet, a: [string, string[]], b: [string, string[]]) {
  const w = (CW - 20) / 2, size = 8.8, lead = 12.4;
  const rows = (items: string[]) => items.map((t) => s.lines(t, size, w - 14));
  const ra = rows(a[1]), rb = rows(b[1]);
  const hOf = (r: string[][]) => 18 + r.reduce((x, l) => x + l.length * lead + 2, 0);
  s.need(Math.max(hOf(ra), hOf(rb)));
  const top = s.y;
  ([[a[0], ra, M], [b[0], rb, M + w + 20]] as [string, string[][], number][]).forEach(([title, r, x]) => {
    if (!r.length) return;
    s.text(title, x, top + 10, { size: 9.2, bold: true, color: s.c.primary });
    let y = top + 18;
    r.forEach((l) => {
      s.rect(x + 1, y + 5, 3.2, 3.2, s.c.accent);
      l.forEach((t, k) => s.text(t, x + 12, y + size + k * lead, { size }));
      y += l.length * lead + 2;
    });
  });
  s.y = top + Math.max(hOf(ra), hOf(rb));
}

// Bank details (for payment) beside the signatures (+ the signature and stamp images).
function bankAndSign(s: Sheet, org: StdOrg, signature: PDFImage | null, stamp: PDFImage | null) {
  const h = 128, w = (CW - 14) / 2;
  s.need(h + 10);
  const top = s.y;
  s.round(M, top, w, h, 8, s.c.soft);
  s.text("BANK DETAILS FOR PAYMENT", M + 12, top + 18, { size: 7.8, bold: true, color: s.c.accent });
  const b = org.bank;
  const rows: [string, string][] = b ? [["Account name", b.holder || org.name], ["Bank", b.name], ["Account no.", b.account], ["IFSC", b.ifsc], ["Branch", b.branch]] : [];
  rows.filter(([, v]) => v).forEach(([l, v], n) => {
    s.text(l, M + 12, top + 36 + n * 15, { size: 8.2, color: s.c.muted });
    s.text(v, M + 92, top + 36 + n * 15, { size: 8.8, bold: true, max: w - 104 });
  });
  const x = M + w + 14, half = w / 2;
  s.round(x, top, w, h, 8, s.c.white, s.c.line);
  s.text(`For ${org.name}`, x + 12, top + 20, { size: 9, bold: true, color: s.c.primary, max: w - 24 });
  // The signature across the signatory's line, the stamp over its right end.
  if (signature) s.image(signature, x + 12, top + 40, half - 24, 40);
  if (stamp) s.image(stamp, x + half - 62, top + 26, 56, 56);
  s.hline(x + 12, top + 86, half - 24, s.c.muted, 0.6);
  s.hline(x + half + 6, top + 86, half - 18, s.c.muted, 0.6);
  s.text("Authorised signatory", x + 12, top + 98, { size: 7.8, color: s.c.muted });
  s.text("Customer's acceptance", x + half + 6, top + 98, { size: 7.8, color: s.c.muted });
  s.text("Name, signature & date", x + half + 6, top + 109, { size: 7, color: s.c.muted });
  s.y = top + h + 6;
}
