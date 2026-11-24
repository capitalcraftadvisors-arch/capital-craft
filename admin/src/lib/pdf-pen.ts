// Server-only. The A4 page and the small top-down drawing kit over pdf-lib
// (y = distance from the top) shared by the standard quotation
// (lib/quotation-standard, its Sheet) and the tax invoice (lib/invoice-pdf).
// Each keeps its own palette; the pen only needs its ink and line colours.

import { rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { printable, textWidth, wrap, type Fonts } from "./pdf-template";

// ── The page ────────────────────────────────────────────────────────────────
export const W = 595.28, H = 841.89, M = 40, CW = W - 2 * M;
export const HEADER_END = 104, FOOTER_TOP = H - 44;

// ── Colours ─────────────────────────────────────────────────────────────────
export type Rgb3 = [number, number, number];
export const hex3 = (h: string): Rgb3 => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
export const mix = (a: Rgb3, b: Rgb3, t: number): RGB => rgb(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

export type TextOpts = { size?: number; bold?: boolean; color?: RGB; align?: "left" | "right" | "center"; max?: number };
export type Col = { w: number; align?: "left" | "right" | "center" };

/** The palette colours the pen itself uses: text (`ink`) and rules (`line`). */
export type PenInk = { ink: RGB; line: RGB };

/** Draws on `page` (set by the subclass) with the fonts `f` and the palette `c`. */
export class PdfPen<C extends PenInk> {
  page!: PDFPage;
  constructor(readonly f: Fonts, readonly c: C) {}

  font(bold?: boolean): PDFFont { return bold ? this.f.bold : this.f.reg; }
  text(s: string, x: number, y: number, o: TextOpts = {}) {
    const font = this.font(o.bold);
    let size = o.size ?? 9.5;
    const t = printable(font, s);
    let w = textWidth(font, t, size);
    if (o.max && w > o.max) { size = (size * o.max) / w; w = o.max; }
    const left = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    this.page.drawText(t, { x: left, y: H - y, size, font, color: o.color ?? this.c.ink });
    return w;
  }
  lines(s: string, size: number, max: number, bold = false) {
    const font = this.font(bold);
    return String(s ?? "").split(/\r?\n/).flatMap((p) => wrap(printable(font, p), (t) => textWidth(font, t, size), max, 999));
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
}
