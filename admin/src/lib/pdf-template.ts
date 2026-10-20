// Server-only. Fills an EPC's own PDF (their quotation) in place: each original
// value's text operators are blanked out of the page and the new value is drawn
// at the same spot, size and colour (left / right / centre aligned like the
// original). Amounts keep the template's own ₹ glyph. Used by the Bijlee and
// Sarvatra quotation builders.

import zlib from "zlib";
import {
  PDFDocument, PDFName, PDFArray, PDFRawStream, PDFRef, PDFDict, PDFHexString, PDFPage, PDFFont,
  StandardFonts, rgb, beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingRgbColor,
} from "pdf-lib";

export type Fonts = { reg: PDFFont; bold: PDFFont };
export const embedHelvetica = async (doc: PDFDocument): Promise<Fonts> =>
  ({ reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) });

// Drawn width of text. pdf-lib's widthOfTextAtSize applies kerning, but drawText
// doesn't kern — measuring per character matches what's actually drawn.
export const textWidth = (font: PDFFont, text: string, size: number) =>
  Array.from(text).reduce((w, ch) => w + font.widthOfTextAtSize(ch, size), 0);

export const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
export const num = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

// ── content-stream reading ───────────────────────────────────────────────────
type Run = {
  text: string; start: number; end: number; operand: string; font: string; size: number;
  x: number; y: number; lin: [number, number, number, number]; pt: number; width: number;
  color: [number, number, number];
};
// map: code → text; rev: character → code (to write new text in the template's own font).
type FontMeta = { map: Record<number, string>; rev: Map<string, number>; width: number; fm: number; advance: (code: number) => number };
type ImageDraw = { start: number; end: number; x: number; y: number }; // "/Name Do", bottom-left corner
const BS = String.fromCharCode(92);
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
  const rev = new Map<string, number>();
  for (const [c, ch] of Object.entries(map)) if (ch.length === 1 && !rev.has(ch)) rev.set(ch, Number(c));
  const fmArr = f.get(PDFName.of("FontMatrix"));
  const fm = fmArr instanceof PDFArray ? Number(String(fmArr.get(0))) : 0.001;
  const n = (v: unknown) => Number(String(look(doc, v)));
  const descendants = look<PDFArray | undefined>(doc, f.get(PDFName.of("DescendantFonts")));
  if (descendants instanceof PDFArray) {
    // Type0 (CID) font: widths in the descendant's /W — [c [w1 w2 …]] or [c1 c2 w] — else /DW.
    const cid = look<PDFDict>(doc, descendants.get(0));
    const cw = new Map<number, number>();
    const w = look<PDFArray | undefined>(doc, cid.get(PDFName.of("W")));
    const items = w instanceof PDFArray ? w.asArray().map((v) => look<unknown>(doc, v)) : [];
    for (let k = 0; k < items.length;) {
      const c = n(items[k]);
      const next = items[k + 1];
      if (next instanceof PDFArray) { next.asArray().forEach((v, j) => cw.set(c + j, n(v))); k += 2; }
      else { for (let x = c; x <= n(next); x++) cw.set(x, n(items[k + 2])); k += 3; }
    }
    const dw = cid.get(PDFName.of("DW")) ? n(cid.get(PDFName.of("DW"))) : 1000;
    return { map, rev, width: 4, fm: 0.001, advance: (code) => cw.get(code) ?? dw };
  }
  const wArr = look<PDFArray | undefined>(doc, f.get(PDFName.of("Widths")));
  const widths = wArr instanceof PDFArray ? wArr.asArray().map(n) : [];
  const first = Number(String(f.get(PDFName.of("FirstChar")) ?? 0));
  return { map, rev, width, fm, advance: (code) => widths[code - first] ?? 0 };
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
  const bytes = literalBytes(tok);
  if (fm.width !== 4) return bytes;
  const out: number[] = []; // 2-byte codes (Type0)
  for (let k = 0; k + 1 < bytes.length; k += 2) out.push(bytes[k] * 256 + bytes[k + 1]);
  return out;
}

// `em` = glyph units per em of the template's fonts (1000 for most PDFs; 2048 when
// the Type3 glyphs are TrueType outlines) — sizes the replacement text correctly.
function readPage(doc: PDFDocument, page: PDFPage, em: number): { content: string; runs: Run[]; images: ImageDraw[]; fonts: Record<string, FontMeta> } {
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
    let text = "", adv = 0, lead = 0; // lead = advance of leading spaces (x is the first visible glyph)
    for (const c of codesList) {
      if (typeof c === "string") { adv -= (Number(c) / 1000); continue; }
      text += f.map[c] ?? "";
      adv += f.advance(c) * f.fm;
      if (!text.trim()) lead = adv;
    }
    if (!text.trim()) return;
    const trm = mul(tm, ctm);
    const hScale = Math.hypot(trm[0], trm[1]);
    runs.push({
      text, start, end, operand: operandTok, font, size,
      x: trm[4] + lead * size * hScale, y: trm[5], lin: [trm[0] * size, trm[1] * size, trm[2] * size, trm[3] * size],
      pt: Math.abs(size * f.fm * em * Math.hypot(trm[2], trm[3])),
      width: (adv - lead) * size * hScale, color,
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
  return { content, runs, images, fonts };
}

// ── edits ───────────────────────────────────────────────────────────────────
// `at` = the original value's first glyph position. `to` (optional) = the x where
// it ends, for values drawn glyph by glyph: every run on that line up to `to` is
// part of the value.
export type At = [number, number];
type Align = "left" | "right" | "center";
// fit: shrink to fit — `true` = the original's width, a number = that width (a form field's box).
// native: write in the template's own font when it has every character (else Helvetica).
type TextEdit = { kind: "text"; at: At; to?: number; text: string; bold?: boolean; align?: Align; fit?: boolean | number; native?: boolean };
type AmountEdit = { kind: "amount"; rupee: At; at: At; to?: number; text: string; bold?: boolean; align: Align };
// Line: one original line replaced by parts drawn one after another, each in the
// colour of the original text at `like` (default: the line's first glyph).
type LineEdit = { kind: "line"; at: At; to: number; parts: { text: string; like?: At; bold?: boolean }[]; fit?: number };
type AddEdit = { kind: "add"; x: number; y: number; text: string; bold?: boolean; like: At };
type HideEdit = { kind: "hide"; image: At };
// Check: a printed HTML-form checkbox (`at` = its bottom-left corner) redrawn ticked or empty.
type CheckEdit = { kind: "check"; at: At; on: boolean };
export type Edit = TextEdit | AmountEdit | LineEdit | AddEdit | HideEdit | CheckEdit;

const BOX = 9.75, BOX_BLUE = rgb(27 / 255, 62 / 255, 200 / 255), BOX_GREY = rgb(118 / 255, 118 / 255, 118 / 255);
const BOX_PATH = `M 1.6 0 H 8.15 Q 9.75 0 9.75 1.6 V 8.15 Q 9.75 9.75 8.15 9.75 H 1.6 Q 0 9.75 0 8.15 V 1.6 Q 0 0 1.6 0 Z`;
function drawCheck(page: PDFPage, [x, y]: At, on: boolean) {
  page.drawRectangle({ x: x - 0.8, y: y - 0.8, width: BOX + 1.6, height: BOX + 1.6, color: rgb(1, 1, 1) });
  const top = { x, y: y + BOX }; // drawSvgPath's origin is the path's top-left (y grows down)
  if (!on) { page.drawSvgPath(BOX_PATH, { ...top, color: rgb(1, 1, 1), borderColor: BOX_GREY, borderWidth: 0.75 }); return; }
  page.drawSvgPath(BOX_PATH, { ...top, color: BOX_BLUE });
  page.drawSvgPath("M 2.3 5 L 4.2 6.9 L 7.6 3", { ...top, borderColor: rgb(1, 1, 1), borderWidth: 1.3 });
}

// Brand logos: each [maker, image corner] stays only when the chosen brand names that maker.
export const logos = (brand: string, list: [string, At][]): Edit[] =>
  list.filter(([maker]) => !brand.toLowerCase().includes(maker)).map(([, image]) => ({ kind: "hide", image }));

type Span = { runs: Run[]; x: number; y: number; width: number; pt: number; color: [number, number, number] };
function findSpan(runs: Run[], at: At, to?: number): Span {
  const first = runs.find((q) => Math.abs(q.x - at[0]) < 1.5 && Math.abs(q.y - at[1]) < 1.5);
  if (!first) throw new Error(`Quotation template changed: no text at ${at.join(",")}`);
  const part = to === undefined ? [first] : runs.filter((q) => Math.abs(q.y - first.y) < 1.5 && q.x >= first.x - 0.5 && q.x <= to);
  const end = Math.max(...part.map((q) => q.x + q.width));
  return { runs: part, x: first.x, y: first.y, width: end - first.x, pt: first.pt, color: first.color };
}

// Show glyph codes (hex) in the font of `like` (an original run), at x on its baseline, scaled by s.
function drawNative(page: PDFPage, like: Run, hex: string, x: number, s = 1) {
  const m = like.lin.map((v) => (v / like.size) * s) as [number, number, number, number];
  page.pushOperators(
    setFillingRgbColor(...like.color), beginText(), setFontAndSize(like.font.replace(/^\//, ""), like.size),
    setTextMatrix(m[0], m[1], m[2], m[3], x, like.y), showText(PDFHexString.of(hex)), endText(),
  );
}

export function editPage(doc: PDFDocument, page: PDFPage, edits: Edit[], fonts: Fonts, em = 1000) {
  const { content, runs, images, fonts: own } = readPage(doc, page, em);
  // Keep only what Helvetica can print (’ é – stay; other scripts would make drawText throw).
  const printable = new Set(fonts.reg.getCharacterSet());
  const clean = (s: string) => Array.from(s.replace(/\s+/g, " ")).filter((c) => printable.has(c.codePointAt(0) ?? 0)).join("").trim();
  const cut: [number, number][] = [];
  const draws: (() => void)[] = [];
  const draw = (text: string, x: number, y: number, pt: number, color: [number, number, number], bold?: boolean) =>
    draws.push(() => page.drawText(text, { x, y, size: pt, font: bold ? fonts.bold : fonts.reg, color: rgb(...color) }));

  for (const e of edits) {
    if (e.kind === "check") { draws.push(() => drawCheck(page, e.at, e.on)); continue; }
    if (e.kind === "hide") {
      const img = images.find((q) => Math.abs(q.x - e.image[0]) < 1.5 && Math.abs(q.y - e.image[1]) < 1.5);
      if (!img) throw new Error(`Quotation template changed: no image at ${e.image.join(",")}`);
      cut.push([img.start, img.end]);
      continue;
    }
    if (e.kind === "add") {
      const ref = findSpan(runs, e.like);
      draw(clean(e.text), e.x, e.y, ref.pt, ref.color, e.bold);
      continue;
    }
    const r = findSpan(runs, e.at, e.to);
    for (const q of r.runs) cut.push([q.start, q.end]);
    if (e.kind === "line") {
      const parts = e.parts.map((p) => ({ ...p, text: p.text.replace(/\s+/g, " ").split(" ").map(clean).join(" ") })); // keeps the spaces between parts
      const width = (pt: number) => parts.reduce((w, p) => w + textWidth(p.bold ? fonts.bold : fonts.reg, p.text, pt), 0);
      const pt = e.fit && width(r.pt) > e.fit ? (r.pt * e.fit) / width(r.pt) : r.pt;
      let x = r.x;
      for (const p of parts) {
        draw(p.text, x, r.y, pt, p.like ? findSpan(runs, p.like).color : r.color, p.bold);
        x += textWidth(p.bold ? fonts.bold : fonts.reg, p.text, pt);
      }
      continue;
    }
    const text = clean(e.text);
    const f = e.bold ? fonts.bold : fonts.reg;
    const w = textWidth(f, text, r.pt);
    if (e.kind === "text") {
      const max = e.fit === true ? r.width : typeof e.fit === "number" ? e.fit : Infinity;
      const place = (width: number) => e.align === "center" ? r.x + r.width / 2 - width / 2 : e.align === "right" ? r.x + r.width - width : r.x;
      const like = r.runs[0], fm = own[like.font];
      const codes = e.native && fm ? Array.from(e.text.replace(/\s+/g, " ").trim()).map((ch) => fm.rev.get(ch)) : [];
      if (codes.length && codes.every((c) => c !== undefined)) {
        const nw = codes.reduce((s, c) => s + fm.advance(c!) * fm.fm, 0) * Math.hypot(like.lin[0], like.lin[1]);
        const s = nw > max ? max / nw : 1;
        const hex = codes.map((c) => c!.toString(16).padStart(fm.width, "0")).join("");
        const x = place(nw * s);
        draws.push(() => drawNative(page, like, hex, x, s));
        continue;
      }
      const pt = w > max ? (r.pt * max) / w : r.pt;
      draw(text, place(Math.min(w, max)), r.y, pt, r.color, e.bold);
      continue;
    }
    // Amount: the template's own ₹ glyph + the new number, aligned like the original group.
    const rr = findSpan(runs, e.rupee).runs[0];
    cut.push([rr.start, rr.end]);
    const gap = r.x - (rr.x + rr.width);
    const groupW = rr.width + gap + w;
    const left = e.align === "right" ? r.x + r.width - groupW
      : e.align === "center" ? (rr.x + r.x + r.width) / 2 - groupW / 2
      : rr.x;
    const hex = literalOrHexToHex(rr.operand);
    draws.push(() => drawNative(page, rr, hex, left));
    draw(text, left + rr.width + gap, r.y, r.pt, r.color, e.bold);
  }

  // Remove the original value operators, write the page back as one stream —
  // wrapped in q/Q so its scaling doesn't leak into the new text drawn after it.
  let out = content;
  for (const [s, eIdx] of cut.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + " ".repeat(eIdx - s) + out.slice(eIdx);
  const stream = doc.context.flateStream(Buffer.from(`q\n${out}\nQ\n`, "latin1"));
  const replaced = contentRefs(doc, page);
  page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  // The replaced stream still holds the template's sample values — delete it, or
  // save() writes it into the file (unreferenced, but extractable).
  const shared = new Set(doc.getPages().filter((p) => p !== page).flatMap((p) => contentRefs(doc, p)).map(String));
  for (const r of replaced) if (!shared.has(String(r))) doc.context.delete(r);
  for (const d of draws) d();
}

function contentRefs(doc: PDFDocument, page: PDFPage): PDFRef[] {
  const c = page.node.get(PDFName.of("Contents"));
  const v = look<unknown>(doc, c);
  return [c, ...(v instanceof PDFArray ? v.asArray() : [])].filter((r): r is PDFRef => r instanceof PDFRef);
}

function literalOrHexToHex(tok: string): string {
  const inner = tok.startsWith("[") ? tok.slice(1, -1).trim() : tok;
  const m = inner.match(/<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)/);
  if (!m) return "";
  if (m[0].startsWith("<")) return m[0].slice(1, -1).replace(/\s/g, "");
  return literalBytes(m[0]).map((b) => b.toString(16).padStart(2, "0")).join("");
}
