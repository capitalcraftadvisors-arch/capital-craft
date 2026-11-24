// Server-only. The email pipeline shared by the two "Send to lender" routes
// (/api/admin/loan-app/[id]/send-to-lender and /api/admin/epc/[id]/send-to-lender):
//   readSendFields  — the composer's send fields, cleaned (TO / CC / BCC, subject, detail rows)
//   sendLenderPack  — summary.xlsx from the detail rows → a flat ZIP of it + every
//                     document → the ZIP uploaded → the email (detail table, a link per
//                     document, the ZIP link, summary.xlsx attached) → the addresses
//                     saved to email_contacts for the composer's autocomplete.
//                     `summarySheet: false` leaves summary.xlsx out (ZIP + attachment);
//                     `downloadButtons` adds a Download button beside each document.
// Each route keeps its own lookups, checks, wording and activity log.

import type { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import archiver from "archiver";
import { sendMail, mailConfigured } from "@/lib/mailer";
import { err } from "@/lib/api";
import { EMAIL_RE } from "@/lib/validators";
import { esc } from "@/lib/html";
import { uploadBuffer, downloadBuffer } from "@/lib/gcs";
import { fileLinkUrl } from "@/lib/file-links";
import { publicOrigin } from "@/lib/login-password-server";

type DetailRows = [string, string][];
type PackDoc = { label: string; path: string };

/** The JSON body both routes accept. */
export type ComposerBody = {
  mode?: string; lender?: string; to?: string; toName?: string;
  cc?: string[]; bcc?: string[]; subject?: string; detail?: DetailRows;
};

type SendFields = { to: string; cc: string[]; bcc: string[]; subject: string; toName: string; detail: DetailRows };

function extOf(p: string): string { const m = p.split("/").pop()?.match(/\.[a-z0-9]+$/i); return m ? m[0] : ""; }
function safe(s: string): string { return s.replace(/[^\w .-]+/g, "_").slice(0, 80); }
function cleanEmails(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map((x) => String(x).trim().toLowerCase()).filter((x) => EMAIL_RE.test(x))));
}

/** A document category as a label: "bank_statement" → "Bank Statement". */
export function titleCaseCategory(c: string): string {
  return c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

async function saveContacts(supabase: SupabaseClient, emails: string[]) {
  const now = new Date().toISOString();
  for (const email of emails) {
    try { await supabase.from("email_contacts").upsert({ email, last_used_at: now }, { onConflict: "email" }); } catch { /* non-blocking */ }
  }
}

/** The send-mode fields (edited in the composer, defaults when left empty), or the error reply. */
export function readSendFields(body: ComposerBody, defaultSubject: string, defaultDetail: DetailRows): SendFields | NextResponse {
  if (!mailConfigured()) return err("Email isn't configured yet (app password missing).", 500);
  const to = String(body.to ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return err("Enter a valid recipient (TO) email.", 400);
  const cc = cleanEmails(body.cc);
  const bcc = cleanEmails(body.bcc);
  const subject = String(body.subject ?? "").trim() || defaultSubject;
  const toName = String(body.toName ?? "").trim();
  const detail = Array.isArray(body.detail) && body.detail.length
    ? body.detail.map((r) => [String(r?.[0] ?? ""), String(r?.[1] ?? "")] as [string, string])
    : defaultDetail;
  return { to, cc, bcc, subject, toName, detail };
}

/** Builds the pack, emails it and saves the addresses. Answers how many document links went out. */
export async function sendLenderPack(req: NextRequest, supabase: SupabaseClient, p: {
  mail: SendFields;
  /** summary.xlsx: the worksheet name and the title row. */
  sheetName: string;
  sheetTitle: string;
  docs: PackDoc[];
  /** Who the pack is for (borrower / EPC): each file in the ZIP is "<label> - <name>", the ZIP "<name>_<lender>.zip". */
  name: string;
  lenderLabel: string;
  /** The storage folder the ZIP is uploaded to. */
  zipFolder: string;
  /** The opening paragraph's HTML (already escaped). */
  introHtml: string;
  /** The console-log tag, e.g. "send-to-lender". */
  logTag: string;
  /** summary.xlsx in the ZIP + attached (default true). */
  summarySheet?: boolean;
  /** A Download button beside each document link (default false). */
  downloadButtons?: boolean;
}): Promise<number> {
  const { to, cc, bcc, subject, toName, detail } = p.mail;

  // summary.xlsx built from the (edited) detail rows.
  let xlsxBuffer: Buffer | null = null;
  if (p.summarySheet !== false) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(p.sheetName);
    ws.columns = [{ width: 34 }, { width: 50 }];
    const title = ws.addRow([p.sheetTitle, ""]);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    for (const [k, v] of detail) { const r = ws.addRow([k, v]); r.getCell(1).font = { bold: true, color: { argb: "FF0F3D2E" } }; }
    xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());
  }
  // Each document's name in the ZIP (and when downloaded): "<label> - <name>.<ext>".
  const fileName = (d: PackDoc) => `${safe(`${d.label} - ${p.name}`)}${extOf(d.path)}`;

  // flat ZIP + per-doc signed links.
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c: Buffer) => chunks.push(c));
  archive.on("warning", (e) => console.warn(`[${p.logTag}] zip warn:`, e));
  const zipDone = new Promise<void>((resolve, reject) => { archive.on("end", () => resolve()); archive.on("error", reject); });
  if (xlsxBuffer) archive.append(xlsxBuffer, { name: "summary.xlsx" });
  const buffers = new Map<string, Buffer>();
  for (const d of p.docs) {
    try { const buf = await downloadBuffer(d.path); buffers.set(d.path, buf); archive.append(buf, { name: fileName(d) }); }
    catch (e) { console.warn(`[${p.logTag}] skip ${d.path}:`, e); }
  }
  void archive.finalize();
  await zipDone;
  const zipBuffer = Buffer.concat(chunks);

  const zipName = `${safe(`${p.name}_${p.lenderLabel}`)}.zip`;
  const zipPath = `${p.zipFolder}/${Date.now()}_${zipName}`;
  await uploadBuffer(zipPath, zipBuffer, "application/zip");
  // Links go through the portal so they outlive Google's 7-day cap (lib/file-links).
  const origin = publicOrigin(req);
  const zipUrl = fileLinkUrl(origin, zipPath);

  const links: Array<{ label: string; url: string; download: string | null }> = [];
  for (const d of p.docs) {
    if (!buffers.has(d.path)) continue;
    links.push({ label: d.label, url: fileLinkUrl(origin, d.path), download: p.downloadButtons ? fileLinkUrl(origin, d.path, { download: fileName(d) }) : null });
  }

  // Some lenders can't save an image that opens in the browser — Download saves it.
  const downloadHtml = (url: string) =>
    ` <a href="${esc(url)}" style="display:inline-block;margin-left:10px;padding:1px 10px;border:1px solid #178a5c;border-radius:6px;color:#178a5c;font-size:12px;font-weight:600;text-decoration:none">Download</a>`;
  const linksHtml = links.map((l) => `<li style="margin:6px 0"><a href="${esc(l.url)}" style="color:#178a5c">${esc(l.label)}</a>${l.download ? downloadHtml(l.download) : ""}</li>`).join("");
  const detailHtml = `<table style="border-collapse:collapse;margin:8px 0 18px;font-size:13px">${detail
    .map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#5a8a76;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:3px 0;font-weight:600;color:#12271f">${esc(v || "—")}</td></tr>`)
    .join("")}</table>`;
  const html = `
      <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#12271f;line-height:1.55">
        <p>Dear ${esc(toName || "Team")},</p>
        <p>${p.introHtml}</p>
        ${detailHtml}
        <p style="margin:16px 0 6px"><b>Documents</b></p>
        <ul style="margin:0 0 16px;padding-left:20px">${linksHtml || "<li>(no documents on file)</li>"}</ul>
        <p><b>Download all as a single ZIP:</b> <a href="${esc(zipUrl)}" style="color:#178a5c">${esc(zipName)}</a></p>
        ${xlsxBuffer ? `<p style="color:#5a8a76;font-size:12.5px">A summary sheet is attached.</p>` : ""}
        <p style="margin-top:18px">Regards,<br/>Capital Craft Advisors</p>
      </div>`;

  await sendMail({
    to,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    subject,
    html,
    ...(xlsxBuffer ? { attachments: [{ filename: "summary.xlsx", content: xlsxBuffer }] } : {}),
  });

  await saveContacts(supabase, [to, ...cc, ...bcc]);
  return links.length;
}
