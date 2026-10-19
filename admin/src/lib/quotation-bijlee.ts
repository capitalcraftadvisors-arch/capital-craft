// Server-only. Bijlee Solar quotation — their own 12-page PDF is the template
// (templates/bijlee-template.pdf). Only the variable values change: each
// original value's text operator is removed from the page and the new value is
// drawn at the same spot, size and colour (left / right / centre aligned like the
// original). Amounts keep the template's own ₹ glyph. Page 8's savings chart is an
// image, so it's covered and redrawn. A brand logo (pages 5–6) is removed when
// the chosen brand isn't that maker. Pages 2–3 and 9–12 are untouched.
//
// Savings (user-confirmed): 1,250 units per kW per year at ₹13.50 per unit;
// payback = total cost ÷ yearly savings; CO₂ ≈ 1.01 kg per unit; trees = CO₂ kg ÷ 38;
// the 25-year chart grows ~1.6 % a year (2 % tariff rise, 0.4 % panel ageing).
// These reproduce the template's own numbers exactly for 15 kW.

import zlib from "zlib";
import {
  PDFDocument, PDFName, PDFArray, PDFRawStream, PDFRef, PDFDict, PDFHexString, PDFPage, PDFFont,
  StandardFonts, rgb, degrees, beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingRgbColor,
} from "pdf-lib";

const UNITS_PER_KW = 1250;
const RATE_PER_UNIT = 13.5;
const MODULE_WP = 590;
const GST_PERCENT = 8.9;

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

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

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

// ── content-stream reading ───────────────────────────────────────────────────
type Run = {
  text: string; start: number; end: number; operand: string; font: string; size: number;
  x: number; y: number; lin: [number, number, number, number]; pt: number; width: number;
  color: [number, number, number];
};
type FontMeta = { map: Record<number, string>; width: number; fm: number; widths: number[]; first: number };
const BS = String.fromCharCode(92);
const EM = 2048; // the template's Type3 fonts are TrueType outlines: 2048 glyph units per em
const mul = (a: number[], b: number[]) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

function look<T>(doc: PDFDocument, v: unknown): T { return (v instanceof PDFRef ? doc.context.lookup(v) : v) as T; }
function streamBytes(doc: PDFDocument, ref: unknown): Buffer {
  const s = look<PDFRawStream>(doc, ref);
  const raw = Buffer.from(s.contents);
  return String(s.dict.get(PDFName.of("Filter")) ?? "").includes("FlateDecode") ? zlib.inflateSync(raw) : raw;
}
function fontMeta(doc: PDFDocument, f: PDFDict): FontMeta {
  const map: Record<number, string> = {}; let width = 2;
  const tu = f.get(PDFName.of("ToUnicode"));
  if (tu) {
    const t = streamBytes(doc, tu).toString("latin1");
    const hex = (h: string) => { let o = ""; for (let k = 0; k + 4 <= h.length; k += 4) o += String.fromCharCode(parseInt(h.slice(k, k + 4), 16)); return o; };
    for (const b of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) { map[parseInt(m[1], 16)] = hex(m[2]); width = m[1].length; }
    for (const b of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const a = parseInt(m[1], 16), z = parseInt(m[2], 16), base = parseInt(m[3], 16); width = m[1].length;
      for (let c = a; c <= z; c++) map[c] = String.fromCharCode(base + c - a);
    }
  }
  const fmArr = f.get(PDFName.of("FontMatrix"));
  const fm = fmArr instanceof PDFArray ? Number(String(fmArr.get(0))) : 0.001;
  const wArr = look<PDFArray | undefined>(doc, f.get(PDFName.of("Widths")));
  const widths = wArr instanceof PDFArray ? wArr.asArray().map((v) => Number(String(look(doc, v)))) : [];
  const first = Number(String(f.get(PDFName.of("FirstChar")) ?? 0));
  return { map, width, fm, widths, first };
}
function literalBytes(tok: string): number[] {
  const s = tok.slice(1, -1); const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === BS) {
      const n = s[++i];
      if (/[0-7]/.test(n)) { let oct = n; while (oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i]; out.push(parseInt(oct, 8)); continue; }
      const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      out.push(esc[n] ?? n.charCodeAt(0)); continue;
    }
    out.push(ch.charCodeAt(0));
  }
  return out;
}
function tokenCodes(tok: string, fm: FontMeta): number[] {
  if (tok.startsWith("<")) { const h = tok.slice(1, -1).replace(/\s/g, ""); const w = fm.width || 2; const out: number[] = []; for (let k = 0; k + w <= h.length; k += w) out.push(parseInt(h.slice(k, k + w), 16)); return out; }
  return literalBytes(tok);
}

type ImageDraw = { start: number; end: number; x: number; y: number }; // "/Name Do", bottom-left corner

function readPage(doc: PDFDocument, page: PDFPage): { content: string; runs: Run[]; images: ImageDraw[] } {
  const res = look<PDFDict>(doc, page.node.Resources());
  const fd = look<PDFDict | undefined>(doc, res.get(PDFName.of("Font")));
  const fonts: Record<string, FontMeta> = {};
  if (fd) for (const [k, v] of fd.entries()) fonts[k.toString()] = fontMeta(doc, look<PDFDict>(doc, v));
  const contents = look<unknown>(doc, page.node.get(PDFName.of("Contents")));
  const parts = contents instanceof PDFArray ? contents.asArray() : [page.node.get(PDFName.of("Contents"))];
  const content = parts.map((r) => streamBytes(doc, r).toString("latin1")).join("\n");

  const re = /\[(?:\((?:\\.|[^\\)])*\)|<[^>]*>|[^\]()<>])*\]|<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)|\/[^\s/[\]()<>{}]+|-?\d*\.?\d+(?:e-?\d+)?|[A-Za-z'"*]+/g;
  const stack: { tk: string; idx: number }[] = [];
  let ctm = [1, 0, 0, 1, 0, 0]; const gs: { ctm: number[]; color: [number, number, number] }[] = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = tm.slice(), tl = 0, font = "", size = 0;
  let color: [number, number, number] = [0, 0, 0];
  const runs: Run[] = [];
  const images: ImageDraw[] = [];
  const nums = (n: number) => stack.splice(-n).map((x) => Number(x.tk));
  const emit = (operandTok: string, codesList: (number | string)[], start: number, end: number) => {
    const f = fonts[font]; if (!f) return;
    let text = "", adv = 0;
    for (const c of codesList) {
      if (typeof c === "string") { adv -= (Number(c) / 1000); continue; }
      text += f.map[c] ?? "";
      const w = f.widths[c - f.first] ?? 0;
      adv += w * f.fm;
    }
    if (!text.trim()) return;
    const trm = mul(tm, ctm);
    const hScale = Math.hypot(trm[0], trm[1]);
    runs.push({
      text, start, end, operand: operandTok, font, size,
      x: trm[4], y: trm[5], lin: [trm[0] * size, trm[1] * size, trm[2] * size, trm[3] * size],
      pt: Math.abs(size * f.fm * EM * Math.hypot(trm[2], trm[3])),
      width: adv * size * hScale, color,
    });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const tk = m[0];
    switch (tk) {
      case "q": gs.push({ ctm: ctm.slice(), color }); stack.length = 0; continue;
      case "Q": { const g = gs.pop(); if (g) { ctm = g.ctm; color = g.color; } stack.length = 0; continue; }
      case "cm": ctm = mul(nums(6), ctm); stack.length = 0; continue;
      case "Do": {
        const a = stack.pop();
        const x1 = ctm[4] + ctm[0] + ctm[2], y1 = ctm[5] + ctm[1] + ctm[3];
        if (a) images.push({ start: a.idx, end: m.index + tk.length, x: Math.min(ctm[4], x1), y: Math.min(ctm[5], y1) });
        stack.length = 0; continue;
      }
      case "rg": { const v = nums(3); color = [v[0], v[1], v[2]]; stack.length = 0; continue; }
      case "g": { const v = nums(1); color = [v[0], v[0], v[0]]; stack.length = 0; continue; }
      case "k": { const v = nums(4); color = [(1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3])]; stack.length = 0; continue; }
      case "sc": case "scn": { const v = stack.map((x) => Number(x.tk)).filter((x) => Number.isFinite(x)); if (v.length === 3) color = [v[0], v[1], v[2]]; else if (v.length === 1) color = [v[0], v[0], v[0]]; stack.length = 0; continue; }
      case "BT": tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); stack.length = 0; continue;
      case "Tf": size = Number(stack.pop()?.tk); font = String(stack.pop()?.tk); stack.length = 0; continue;
      case "TL": tl = Number(stack.pop()?.tk); stack.length = 0; continue;
      case "Tm": tm = nums(6); tlm = tm.slice(); stack.length = 0; continue;
      case "Td": case "TD": { const v = nums(2); if (tk === "TD") tl = -v[1]; tlm = mul([1, 0, 0, 1, v[0], v[1]], tlm); tm = tlm.slice(); stack.length = 0; continue; }
      case "T*": tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); stack.length = 0; continue;
      case "Tj": case "'": case "\"": {
        if (tk !== "Tj") { tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); }
        const a = stack.pop(); if (a) emit(a.tk, tokenCodes(a.tk, fonts[font] ?? ({} as FontMeta)), a.idx, m.index + tk.length);
        stack.length = 0; continue;
      }
      case "TJ": {
        const a = stack.pop();
        if (a && fonts[font]) {
          const list: (number | string)[] = [];
          for (const p of a.tk.slice(1, -1).matchAll(/<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)|-?\d*\.?\d+/g)) {
            if (p[0].startsWith("<") || p[0].startsWith("(")) list.push(...tokenCodes(p[0], fonts[font])); else list.push(p[0]);
          }
          emit(a.tk, list, a.idx, m.index + tk.length);
        }
        stack.length = 0; continue;
      }
    }
    if (/^[A-Za-z'"*]+$/.test(tk)) { stack.length = 0; continue; }
    stack.push({ tk, idx: m.index });
  }
  return { content, runs, images };
}

// ── edits ───────────────────────────────────────────────────────────────────
type Align = "left" | "right" | "center";
type TextEdit = { kind: "text"; at: [number, number]; text: string; bold?: boolean; align?: Align; fit?: boolean };
type AmountEdit = { kind: "amount"; rupee: [number, number]; at: [number, number]; text: string; bold?: boolean; align: Align };
type AddEdit = { kind: "add"; x: number; y: number; text: string; bold?: boolean; like: [number, number] };
type HideEdit = { kind: "hide"; image: [number, number] };
type Edit = TextEdit | AmountEdit | AddEdit | HideEdit;

// Brand logos: each [maker, image corner] stays only when the chosen brand names that maker.
const logos = (brand: string, list: [string, [number, number]][]): Edit[] =>
  list.filter(([maker]) => !brand.toLowerCase().includes(maker)).map(([, image]) => ({ kind: "hide", image }));

function findRun(runs: Run[], at: [number, number]): Run {
  const r = runs.find((q) => Math.abs(q.x - at[0]) < 1.5 && Math.abs(q.y - at[1]) < 1.5);
  if (!r) throw new Error(`Bijlee template changed: no text at ${at.join(",")}`);
  return r;
}
function editPage(doc: PDFDocument, page: PDFPage, edits: Edit[], fonts: { reg: PDFFont; bold: PDFFont }) {
  const { content, runs, images } = readPage(doc, page);
  // Keep only what Helvetica can print (’ é – stay; other scripts would make drawText throw).
  const printable = new Set(fonts.reg.getCharacterSet());
  const clean = (s: string) => Array.from(s.replace(/\s+/g, " ")).filter((c) => printable.has(c.codePointAt(0) ?? 0)).join("").trim();
  const cut: [number, number][] = [];
  const draws: (() => void)[] = [];
  const draw = (text: string, x: number, y: number, pt: number, color: [number, number, number], bold?: boolean) =>
    draws.push(() => page.drawText(text, { x, y, size: pt, font: bold ? fonts.bold : fonts.reg, color: rgb(...color) }));

  for (const e of edits) {
    if (e.kind === "hide") {
      const img = images.find((q) => Math.abs(q.x - e.image[0]) < 1.5 && Math.abs(q.y - e.image[1]) < 1.5);
      if (!img) throw new Error(`Bijlee template changed: no image at ${e.image.join(",")}`);
      cut.push([img.start, img.end]);
      continue;
    }
    if (e.kind === "add") {
      const ref = findRun(runs, e.like);
      draw(clean(e.text), e.x, e.y, ref.pt, ref.color, e.bold);
      continue;
    }
    const r = findRun(runs, e.at);
    cut.push([r.start, r.end]);
    const text = clean(e.text);
    const f = e.bold ? fonts.bold : fonts.reg;
    const w = f.widthOfTextAtSize(text, r.pt);
    if (e.kind === "text") {
      // fit: shrink to the original's width (text inside a table cell).
      const pt = e.fit && w > r.width ? (r.pt * r.width) / w : r.pt;
      const tw = Math.min(w, e.fit ? r.width : w);
      const x = e.align === "center" ? r.x + r.width / 2 - tw / 2 : e.align === "right" ? r.x + r.width - tw : r.x;
      draw(text, x, r.y, pt, r.color, e.bold);
      continue;
    }
    // Amount: the template's own ₹ glyph + the new number, aligned like the original group.
    const rr = findRun(runs, e.rupee);
    cut.push([rr.start, rr.end]);
    const gap = r.x - (rr.x + rr.width);
    const groupW = rr.width + gap + w;
    const left = e.align === "right" ? r.x + r.width - groupW
      : e.align === "center" ? (rr.x + r.x + r.width) / 2 - groupW / 2
      : rr.x;
    const fontName = rr.font.replace(/^\//, "");
    const hex = PDFHexString.of(literalOrHexToHex(rr.operand));
    draws.push(() => page.pushOperators(
      setFillingRgbColor(...rr.color), beginText(), setFontAndSize(fontName, rr.size),
      setTextMatrix(rr.lin[0] / rr.size, rr.lin[1] / rr.size, rr.lin[2] / rr.size, rr.lin[3] / rr.size, left, rr.y),
      showText(hex), endText(),
    ));
    draw(text, left + rr.width + gap, r.y, r.pt, r.color, e.bold);
  }

  // Remove the original value operators, write the page back as one stream —
  // wrapped in q/Q so its scaling doesn't leak into the new text drawn after it.
  let out = content;
  for (const [s, eIdx] of cut.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + " ".repeat(eIdx - s) + out.slice(eIdx);
  const stream = doc.context.flateStream(Buffer.from(`q\n${out}\nQ\n`, "latin1"));
  page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  for (const d of draws) d();
}

function literalOrHexToHex(tok: string): string {
  const inner = tok.startsWith("[") ? tok.slice(1, -1).trim() : tok;
  const m = inner.match(/<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)/);
  if (!m) return "";
  if (m[0].startsWith("<")) return m[0].slice(1, -1).replace(/\s/g, "");
  return literalBytes(m[0]).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Page 8 savings chart (an image in the template) → covered and redrawn.
// Geometry measured from the template's own chart.
function drawChart(page: PDFPage, values: number[], fonts: { reg: PDFFont; bold: PDFFont }) {
  page.drawRectangle({ x: 51.56, y: 82.98, width: 515.36, height: 418.83, color: rgb(1, 1, 1) });
  const navy = rgb(0.17, 0.16, 0.37), grey = rgb(0.4, 0.4, 0.4), size = 9;
  const steps = [10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000, 2000000, 2500000, 5000000];
  const max = Math.max(...values);
  const step = steps.find((s) => Math.ceil(max / s) <= 8) ?? 10000000;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const left = 107, right = 566, base = 122, ph = 356;
  const label = (text: string, x: number, y: number, bold = false) =>
    page.drawText(text, { x, y, size, font: bold ? fonts.bold : fonts.reg, color: grey });
  const width = (text: string, bold = false) => (bold ? fonts.bold : fonts.reg).widthOfTextAtSize(text, size);
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
  const fonts = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
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
  ], fonts);
  // 4 — site survey (only these four fields)
  editPage(doc, pages[3], [
    { kind: "text", at: [153.3, 706.8], text: i.project_location, bold: true },
    { kind: "text", at: [442.9, 669.6], text: `${i.contracted_demand} KW`, bold: true },
    { kind: "add", x: 400, y: 709, text: i.client_name, bold: true, like: [153.3, 706.8] },
    { kind: "add", x: 160.5, y: 677.1, text: i.msedcl_division, bold: true, like: [153.3, 706.8] },
  ], fonts);
  // 5 — module + inverter
  editPage(doc, pages[4], [
    { kind: "text", at: [346.4, 615.4], text: i.module_brand },
    { kind: "text", at: [346.4, 474.3], text: String(k.modules) },
    { kind: "text", at: [353.8, 296.1], text: i.inverter_brand },
    { kind: "text", at: [353.8, 270.1], text: `Max - ${Math.round(i.kw * 1000)} W` },
    ...logos(i.module_brand, [["novasys", [261.7, 645.1]], ["navitas", [445.9, 643.6]]]),
    ...logos(i.inverter_brand, [["growatt", [269.1, 53.3]], ["sungrow", [453.3, 63.7]]]),
  ], fonts);
  // 6 — cable
  editPage(doc, pages[5], [
    { kind: "text", at: [153.3, 680], text: i.cable_brand, bold: true },
    ...logos(i.cable_brand, [["polycab", [142.2, 627.3]]]),
  ], fonts);
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
  ], fonts);
  // 8 — savings
  editPage(doc, pages[7], [
    { kind: "text", at: [98, 652.6], text: `${k.payback} Years`, align: "center" },
    { kind: "text", at: [268.1, 645.1], text: `${k.units} Units`, align: "center" },
    { kind: "amount", rupee: [457.6, 645.1], at: [467.8, 645.1], text: inr(k.savings), align: "center" },
    { kind: "amount", rupee: [93.7, 553], at: [103.9, 553], text: inr(k.total), align: "center" },
    { kind: "text", at: [290.9, 556], text: String(k.trees), align: "center" },
    { kind: "text", at: [458.5, 553], text: `${k.co2t} Tonnes`, align: "center" },
  ], fonts);
  drawChart(pages[7], k.chart, fonts);

  return doc.save();
}
