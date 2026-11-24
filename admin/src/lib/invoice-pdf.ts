// Server-only. A GST tax invoice (epc_invoices, 0129) as an A4 PDF, in the look
// of the standard quotation (lib/quotation-standard): the EPC's letterhead (logo,
// name, address, GSTIN), "TAX INVOICE" with the number and date, the customer and
// the place of supply, the lines (HSN / SAC, taxable value, rate, CGST + SGST or
// IGST), the totals and the amount in words, bank details + UPI ID beside the
// signature and stamp. A cancelled invoice carries a big CANCELLED mark and its
// reason. Printed from the saved row, so the paper always matches the record.
// Read with the caller's client: RLS decides who may (Owner / Admin / Viewer /
// Sales; never Site staff). No subscription check: old invoices stay downloadable.

import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, degrees, rgb, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { embedHelvetica, printable, textWidth, type Fonts } from "./pdf-template";
import { safeName } from "./upload-rules";
import { ACCENTS, ORG_COLS, ORG_V2_COLS } from "./org-profile";
import type { StdOrg } from "./quotation-standard";
import { mark, stdOrgOf } from "./pdf-org-server";
import { CW, FOOTER_TOP, H, HEADER_END, M, PdfPen, W, hex3, mix, type Col } from "./pdf-pen";
import { GST_STATE_CODES } from "./india-states";
import { rupeesInWords } from "./numberToWords";
import { inrPlain } from "./money";
import { fmtDateIST } from "./dates";
import type { InvoiceLine } from "./invoice-calc";

const INV_COLS = "business_id, invoice_no, fy, invoice_date, customer_name, customer_address, customer_gstin, customer_state, " +
  "place_of_supply, lines, taxable, cgst, sgst, igst, total, status, cancelled_at, cancel_reason, replaces_id";
const ORG_SELECT = "trade_name, legal_name, gstin_number, gst_address, contact_name, contact_mobile, contact_email, " +
  `bank_name, bank_account_holder, bank_account_number, bank_ifsc, bank_branch, epc_org_profile(${ORG_COLS}, ${ORG_V2_COLS})`;

type Invoice = {
  business_id: string; invoice_no: string; fy: string; invoice_date: string;
  customer_name: string; customer_address: string | null; customer_gstin: string | null; customer_state: string | null;
  place_of_supply: string | null; lines: InvoiceLine[];
  taxable: number; cgst: number; sgst: number; igst: number; total: number;
  status: "issued" | "cancelled"; cancelled_at: string | null; cancel_reason: string | null; replaces_id: string | null;
};
type Org = StdOrg & { upi: string };

type SavedInvoicePdf = { bytes: Uint8Array; name: string };

/** The invoice's PDF, or null when the caller can't read it. */
export async function buildInvoicePdf(db: SupabaseClient, id: string): Promise<SavedInvoicePdf | null> {
  const { data: inv } = await db.from("epc_invoices").select(INV_COLS).eq("id", id).maybeSingle();
  if (!inv) return null;
  const v = inv as unknown as Invoice;
  const [{ data: b }, replaced] = await Promise.all([
    db.from("epc_business").select(ORG_SELECT).eq("id", v.business_id).maybeSingle(),
    v.replaces_id
      ? db.from("epc_invoices").select("invoice_no").eq("id", v.replaces_id).maybeSingle().then((r) => (r.data as { invoice_no?: string } | null)?.invoice_no ?? "")
      : Promise.resolve(""),
  ]);
  if (!b) return null;
  const biz = b as Record<string, any>;
  const { org: std, op } = await stdOrgOf(biz);
  const org: Org = { ...std, upi: op?.upi_id || "" };

  const bytes = await drawInvoice(v, replaced, org, mark());
  const name = `Invoice ${safeName(v.invoice_no, "invoice")} - ${safeName(v.customer_name || "customer", "customer")}.pdf`;
  return { bytes, name };
}

// ── Look (as the standard quotation; the page and the pen are lib/pdf-pen) ───
function palette(accent: string | null) {
  const a = hex3(/^#[0-9a-f]{6}$/i.test(accent || "") ? accent! : ACCENTS[0]);
  return {
    primary: rgb(...a), soft: mix(a, [1, 1, 1], 0.93),
    accent: rgb(0.949, 0.647, 0.086), warm: rgb(1, 0.961, 0.871),
    ink: rgb(0.122, 0.161, 0.216), muted: rgb(0.4, 0.439, 0.522), line: rgb(0.886, 0.902, 0.933), white: rgb(1, 1, 1),
    red: rgb(0.725, 0.11, 0.11), redSoft: rgb(0.996, 0.949, 0.949),
  };
}
type Palette = ReturnType<typeof palette>;
const amt = (n: number) => inrPlain(Number(n) || 0);
const rs = (n: number) => `Rs. ${amt(n)}`;
const pct = (n: number) => `${+Number(n).toFixed(2)}%`;
/** "Rajasthan (08)" — a state with its GST code. */
const withCode = (s: string | null | undefined) => (s ? (GST_STATE_CODES[s] ? `${s} (${GST_STATE_CODES[s]})` : s) : "");

// The drawing kit (lib/pdf-pen) on the invoice's one page.
class Pen extends PdfPen<Palette> {
  constructor(page: PDFPage, f: Fonts, c: Palette) { super(f, c); this.page = page; }
  /** A small bold accent-colour caption over a block ("BILL TO", "AMOUNT IN WORDS"). */
  caption(s: string, x: number, y: number) { this.text(s, x, y, { size: 7.8, bold: true, color: this.c.accent }); }
}

async function drawInvoice(v: Invoice, replaced: string, org: Org, ccMark: Buffer | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Tax invoice ${v.invoice_no} - ${v.customer_name}`);
  pdf.setAuthor(org.name);
  pdf.setProducer("Capital Craft");
  const f = await embedHelvetica(pdf);
  const png = (b: Buffer | null) => (b ? pdf.embedPng(b).catch(() => null) : Promise.resolve(null));
  const [logo, markImg, signature, stamp] = await Promise.all([png(org.logo), png(ccMark), png(org.signature), png(org.stamp)]);
  const c = palette(org.accent);
  const s = new Pen(pdf.addPage([W, H]), f, c);
  const cancelled = v.status === "cancelled";
  const intra = !(Number(v.igst) > 0);
  const lines = Array.isArray(v.lines) ? v.lines : [];

  // ── Letterhead ─────────────────────────────────────────────────────────────
  let x = M;
  if (logo) x += s.image(logo, x, 30, 110, 46) + 12;
  else {
    s.round(x, 30, 44, 44, 10, c.primary);
    s.text((org.name || "S").slice(0, 1).toUpperCase(), x + 22, 60, { size: 22, bold: true, color: c.white, align: "center" });
    x += 56;
  }
  const textW = W - M - 150 - x;
  s.text(org.name, x, 44, { size: 14.5, bold: true, color: c.primary, max: textW });
  const addr = s.lines(org.address, 7.8, textW).slice(0, 2);
  addr.forEach((l, n) => s.text(l, x, 57 + n * 10, { size: 7.8, color: c.muted }));
  const contact = [org.gstin && `GSTIN ${org.gstin}`, org.phone && `+91 ${org.phone}`, org.email, org.website].filter(Boolean).join("  ·  ");
  s.text(contact, x, 57 + addr.length * 10 + 1, { size: 7.8, color: c.muted, max: textW });
  s.text("TAX INVOICE", W - M, 46, { size: 15, bold: true, color: c.primary, align: "right" });
  s.text(v.invoice_no, W - M, 61, { size: 10.5, bold: true, color: c.ink, align: "right", max: 145 });
  s.text(fmtDateIST(v.invoice_date), W - M, 74, { size: 8.5, color: c.muted, align: "right" });
  s.rect(M, HEADER_END - 14, CW, 1.6, c.primary);
  s.rect(M, HEADER_END - 11.4, 70, 1.6, c.accent);
  let y = HEADER_END + 14;

  // ── Cancelled: when + why ──────────────────────────────────────────────────
  if (cancelled) {
    const why = s.lines(`Reason: ${v.cancel_reason || "-"}`, 8.8, CW - 24);
    const h = 26 + why.length * 12;
    s.round(M, y, CW, h, 8, c.redSoft, c.red);
    s.text(`CANCELLED${v.cancelled_at ? ` on ${fmtDateIST(v.cancelled_at)}` : ""}`, M + 12, y + 16, { size: 9.5, bold: true, color: c.red });
    why.forEach((l, n) => s.text(l, M + 12, y + 30 + n * 12, { size: 8.8, color: c.red }));
    y += h + 14;
  }

  // ── Bill to · Invoice details ──────────────────────────────────────────────
  const colW = (CW - 14) / 2;
  const billTo: [string, string][] = [
    ["Name", v.customer_name], ["Address", v.customer_address || ""], ["GSTIN", v.customer_gstin || "Unregistered"],
    ["State", withCode(v.customer_state)],
  ];
  const details: [string, string][] = [
    ["Invoice no.", v.invoice_no], ["Invoice date", fmtDateIST(v.invoice_date)], ["Financial year", v.fy],
    ["Place of supply", withCode(v.place_of_supply || v.customer_state)], ["Reverse charge", "No"],
    ...(replaced ? [["Replaces", replaced] as [string, string]] : []),
  ];
  const hA = infoBox(s, M, y, colW, "Bill to", billTo.filter(([, t]) => t));
  const hB = infoBox(s, M + colW + 14, y, colW, "Invoice details", details.filter(([, t]) => t));
  y += Math.max(hA, hB) + 18;

  // ── Lines ──────────────────────────────────────────────────────────────────
  const cols: Col[] = intra
    ? [{ w: 22, align: "center" }, { w: 165 }, { w: 50, align: "center" }, { w: 70, align: "right" }, { w: 34, align: "center" }, { w: 56, align: "right" }, { w: 56, align: "right" }, { w: CW - 453, align: "right" }]
    : [{ w: 22, align: "center" }, { w: 215 }, { w: 50, align: "center" }, { w: 76, align: "right" }, { w: 34, align: "center" }, { w: 56, align: "right" }, { w: CW - 453, align: "right" }];
  const head = intra
    ? ["#", "Description", "HSN/SAC", "Taxable value", "GST", "CGST", "SGST", "Amount"]
    : ["#", "Description", "HSN/SAC", "Taxable value", "GST", "IGST", "Amount"];
  // The tax cells of a row: CGST + SGST within the state, else IGST.
  const taxCells = (t: { cgst: number; sgst: number; igst: number }) => (intra ? [amt(t.cgst), amt(t.sgst)] : [amt(t.igst)]);
  const rows = lines.map((l, n) => [String(n + 1), l.description, l.hsn, amt(l.taxable), pct(l.rate), ...taxCells(l), amt(l.amount)]);
  rows.push(["", "Total", "", amt(v.taxable), "", ...taxCells(v), amt(v.total)]);
  y = table(s, y, cols, head, rows, (n) => n === rows.length - 1);
  y += 16;

  // ── Totals + amount in words ───────────────────────────────────────────────
  const totals: [string, string][] = [
    ["Taxable value", rs(v.taxable)],
    ...(intra ? [["CGST", rs(v.cgst)], ["SGST", rs(v.sgst)]] as [string, string][] : [["IGST", rs(v.igst)]] as [string, string][]),
    ["Total (incl. GST)", rs(v.total)],
  ];
  const tw = 220, tx = W - M - tw, top = y;
  totals.forEach(([l, t], n) => {
    const last = n === totals.length - 1;
    if (last) s.rect(tx, y - 4, tw, 22, c.warm);
    s.text(l, tx + 10, y + (last ? 11 : 8), { size: last ? 10 : 9, bold: last });
    s.text(t, W - M - 10, y + (last ? 11 : 8), { size: last ? 10.5 : 9, bold: true, align: "right" });
    y += last ? 22 : 16;
  });
  const words = s.lines(rupeesInWords(Number(v.total) || 0), 9, CW - tw - 24, true).slice(0, 4);
  s.caption("AMOUNT IN WORDS", M, top + 8);
  words.forEach((l, n) => s.text(l, M, top + 22 + n * 12.5, { size: 9, bold: true }));
  y = Math.max(y, top + 22 + words.length * 12.5) + 20;

  // ── Bank details + UPI · signature ─────────────────────────────────────────
  bankAndSign(s, y, org, signature, stamp);

  // ── The CANCELLED mark across the page ─────────────────────────────────────
  if (cancelled) {
    const word = "CANCELLED", size = 84, t = 35 * (Math.PI / 180);
    const w = textWidth(f.bold, word, size);
    s.page.drawText(word, {
      x: W / 2 - (w / 2) * Math.cos(t) + (size * 0.35) * Math.sin(t), y: H / 2 - (w / 2) * Math.sin(t) - (size * 0.35) * Math.cos(t),
      size, font: f.bold, color: c.red, opacity: 0.16, rotate: degrees(35),
    });
  }

  footer(s, markImg);
  return pdf.save();
}

// A titled box of label / value rows; returns its height.
function infoBox(s: Pen, x: number, y: number, w: number, title: string, rows: [string, string][]) {
  const size = 8.8, lead = 12.2;
  const lw = Math.min(w * 0.42, Math.max(...rows.map(([l]) => textWidth(s.f.reg, printable(s.f.reg, l), 8.2))) + 12);
  const vw = w - lw - 24;
  const wrapped = rows.map(([, t]) => s.lines(t, size, vw, true).slice(0, 4));
  const h = 30 + wrapped.reduce((a, l) => a + l.length * lead + 3, 0) + 6;
  s.round(x, y, w, h, 8, s.c.soft);
  s.caption(title.toUpperCase(), x + 12, y + 18);
  let yy = y + 32;
  rows.forEach(([l], n) => {
    s.text(l, x + 12, yy + size, { size: 8.2, color: s.c.muted });
    wrapped[n].forEach((t, k) => s.text(t, x + 12 + lw, yy + size + k * lead, { size, bold: true, max: vw }));
    yy += wrapped[n].length * lead + 3;
  });
  return h;
}

// A table: a header row in the accent colour, then rows with wrapped cells; `strong` rows bold on the warm shade. Returns the y below it.
function table(s: Pen, top: number, cols: Col[], head: string[], rows: string[][], strong: (n: number) => boolean) {
  const size = 8.6, pad = 5, lead = size * 1.3;
  const xs = cols.reduce<number[]>((a, _c, i) => [...a, i ? a[i - 1] + cols[i - 1].w : M], []);
  const cell = (t: string, i: number, y: number, bold: boolean, color: RGB) => {
    const c = cols[i];
    const at = c.align === "right" ? xs[i] + c.w - pad : c.align === "center" ? xs[i] + c.w / 2 : xs[i] + pad;
    s.text(t, at, y, { size, bold, color, align: c.align ?? "left", max: c.w - 2 * pad });
  };
  let y = top;
  s.rect(M, y, CW, 20, s.c.primary);
  head.forEach((h, i) => cell(h, i, y + 13.5, true, s.c.white));
  y += 20;
  rows.forEach((r, n) => {
    const bold = strong(n);
    const wrapped = r.map((t, i) => (cols[i].align ? [t] : s.lines(t, size, cols[i].w - 2 * pad, bold)));
    const h = Math.max(...wrapped.map((l) => l.length)) * lead + 2 * pad - (lead - size);
    s.rect(M, y, CW, h, bold ? s.c.warm : n % 2 ? s.c.soft : s.c.white);
    wrapped.forEach((l, i) => l.forEach((t, k) => cell(t, i, y + pad + size + k * lead - 1, bold, s.c.ink)));
    s.hline(M, y + h, CW);
    y += h;
  });
  return y;
}

// Bank details (+ UPI ID) beside the signatory's box (+ the signature and stamp images).
function bankAndSign(s: Pen, top: number, org: Org, signature: PDFImage | null, stamp: PDFImage | null) {
  const w = (CW - 14) / 2;
  const b = org.bank;
  const rows: [string, string][] = [
    ...(b ? [["Account name", b.holder || org.name], ["Bank", b.name], ["Account no.", b.account], ["IFSC", b.ifsc], ["Branch", b.branch]] as [string, string][] : []),
    ["UPI ID", org.upi],
  ].filter(([, t]) => t) as [string, string][];
  const h = Math.max(128, 30 + rows.length * 15 + 8);
  if (rows.length) {
    s.round(M, top, w, h, 8, s.c.soft);
    s.caption("BANK DETAILS FOR PAYMENT", M + 12, top + 18);
    rows.forEach(([l, t], n) => {
      s.text(l, M + 12, top + 36 + n * 15, { size: 8.2, color: s.c.muted });
      s.text(t, M + 92, top + 36 + n * 15, { size: 8.8, bold: true, max: w - 104 });
    });
  }
  const x = M + w + 14, half = w / 2;
  s.round(x, top, w, h, 8, s.c.white, s.c.line);
  s.text(`For ${org.name}`, x + 12, top + 20, { size: 9, bold: true, color: s.c.primary, max: w - 24 });
  if (signature) s.image(signature, x + 12, top + 40, half - 24, 40);
  if (stamp) s.image(stamp, x + half - 62, top + 26, 56, 56);
  s.hline(x + 12, top + h - 42, w - 24, s.c.muted, 0.6);
  s.text("Authorised signatory", x + 12, top + h - 30, { size: 7.8, color: s.c.muted });
}

function footer(s: Pen, markImg: PDFImage | null) {
  const y = H - FOOTER_TOP, p = s.page;
  p.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.6, color: s.c.line });
  let x = M;
  if (markImg) {
    const sc = 11 / markImg.height;
    p.drawImage(markImg, { x, y: y - 21, width: markImg.width * sc, height: 11 });
    x += markImg.width * sc + 5;
  }
  p.drawText("Powered by Capital Craft", { x, y: y - 18.5, size: 7.5, font: s.f.reg, color: s.c.muted });
}
