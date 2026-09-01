// POST /api/admin/loan-app/[id]/send-to-lender
//
// Body: { lender, recipient_name, recipient_email }
//
// Emails the loan application to a lender FROM capitalcraftadvisors@gmail.com
// (Gmail SMTP + app password in Secret Manager). The email carries:
//   • a 2-line greeting,
//   • a named link to EVERY document (14-day signed GCS URLs),
//   • a single "Download all (ZIP)" link (flat, clean names — no folders),
//   • the summary.xlsx attached (Credit Fair layout for Credit Fair; the
//     general layout for Solfin / Aerem — shared with the Download-ZIP).
//
// Admin-only. Keeps the existing Download-ZIP button untouched.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import archiver from "archiver";
import nodemailer from "nodemailer";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer, downloadBuffer, getSignedReadUrl } from "@/lib/gcs";
import { summaryRows, creditFairEmailRows, LENDER_LABEL, type LenderKey } from "@/lib/lender-summary";
import { logLoanActivityServer } from "@/lib/loan-activity-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const SENDER = process.env.GMAIL_SENDER || "capitalcraftadvisors@gmail.com";
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || "";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LENDER_KEYS: LenderKey[] = ["creditfair", "aerem", "solfin"];
const LINK_TTL = 7 * 24 * 3600; // 7 days — GCS V4 signed-URL max (604800s)

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function extOf(p: string): string { const m = p.split("/").pop()?.match(/\.[a-z0-9]+$/i); return m ? m[0] : ""; }
function safe(s: string): string { return s.replace(/[^\w .-]+/g, "_").slice(0, 80); }
function esc(s: string): string { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string)); }

const CATEGORY_LABEL: Record<string, string> = {
  borrower_pan: "PAN", customer_photo: "Applicant photo", electricity_bill: "Electricity bill",
  bank_statement: "Bank statement", quotation: "Quotation", income_proof: "Income proof",
  property_doc: "Property document", sanction_letter: "Sanction letter", other: "Other document",
};
function prettyCategory(c: string): string {
  return CATEGORY_LABEL[c] || c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const body = (await req.json().catch(() => ({}))) as { lender?: string; recipient_name?: string; recipient_email?: string; cc?: string; bcc?: string };
    const lender = String(body.lender ?? "").toLowerCase() as LenderKey;
    const recipientName = String(body.recipient_name ?? "").trim();
    const recipientEmail = String(body.recipient_email ?? "").trim();
    const cc = String(body.cc ?? "").trim();
    const bcc = String(body.bcc ?? "").trim();
    const okEmails = (s: string) => !s || s.split(",").map((x) => x.trim()).filter(Boolean).every((x) => EMAIL_RE.test(x));
    if (!LENDER_KEYS.includes(lender)) return err("Pick a lender.", 400);
    if (!EMAIL_RE.test(recipientEmail)) return err("Enter a valid recipient email.", 400);
    if (!okEmails(cc)) return err("A CC address is invalid.", 400);
    if (!okEmails(bcc)) return err("A BCC address is invalid.", 400);
    if (!GMAIL_PASS) return err("Email isn't configured yet (app password missing).", 500);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: loan, error: loadErr }, { data: docs }] = await Promise.all([
      supabase.from("epc_applications")
        .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
        .eq("id", appId).maybeSingle(),
      supabase.from("user_application_docs").select("id, category, storage_path, file_name").eq("application_id", appId),
    ]);
    if (loadErr) return err(loadErr.message, 500);
    if (!loan) return err("Loan application not found.", 404);

    const displayId: string = loan.loan_display_id || "LA-" + appId.replace(/-/g, "").slice(0, 8).toUpperCase();
    const borrowerName: string = loan.borrower_name || loan.aadhaar_name || "applicant";
    const epcName: string = loan.epc_business?.trade_name || loan.epc_business?.legal_name || loan.epc_business?.contact_name || "—";

    // ── summary.xlsx (shared builder — Credit Fair layout when applicable) ──
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Application");
    ws.columns = [{ width: 34 }, { width: 50 }];
    const title = ws.addRow(["Capital Craft — Loan Application", ""]);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    for (const [k, v] of summaryRows(loan, { displayId, epcName, epcDisplayId: loan.epc_business?.epc_display_id }, lender)) {
      const r = ws.addRow([k, v]);
      r.getCell(1).font = { bold: true, color: { argb: "FF0F3D2E" } };
    }
    const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

    // ── gather every document (labeled), de-duplicated by path ──
    const seen = new Set<string>();
    const docList: Array<{ label: string; path: string }> = [];
    const add = (label: string, path: string | null | undefined) => {
      if (!path || seen.has(path)) return;
      seen.add(path); docList.push({ label, path });
    };
    add("Aadhaar (front)", loan.aadhaar_front_path);
    add("Aadhaar (back)", loan.aadhaar_back_path);
    add("Applicant photo", loan.customer_photo_path);
    add("Co-applicant Aadhaar (front)", loan.coapp_aadhaar_front_path);
    add("Co-applicant Aadhaar (back)", loan.coapp_aadhaar_back_path);
    add("Co-applicant PAN", loan.coapp_pan_path);
    add("Quotation / Proforma", loan.proforma_invoice_path);
    add("Electricity bill", loan.ebill_path);
    add("Bank statement", loan.bank_statement_path);
    add("Rooftop photo", loan.rooftop_photo_path);
    for (const d of (docs ?? []) as Array<{ category: string; storage_path: string; file_name: string | null }>) {
      add(prettyCategory(d.category), d.storage_path);
    }

    // ── build a flat, clean-named ZIP into a buffer ──
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (c: Buffer) => chunks.push(c));
    archive.on("warning", (e) => console.warn("[send-to-lender] zip warn:", e));
    const zipDone = new Promise<void>((resolve, reject) => { archive.on("end", () => resolve()); archive.on("error", reject); });
    archive.append(xlsxBuffer, { name: "summary.xlsx" });
    const buffers = new Map<string, Buffer>();
    for (const d of docList) {
      try {
        const buf = await downloadBuffer(d.path);
        buffers.set(d.path, buf);
        archive.append(buf, { name: `${safe(`${d.label} - ${borrowerName}`)}${extOf(d.path)}` });
      } catch (e) { console.warn(`[send-to-lender] skip ${d.path}:`, e); }
    }
    void archive.finalize();
    await zipDone;
    const zipBuffer = Buffer.concat(chunks);

    // ── upload ZIP → 14-day signed link ──
    const zipName = `${safe(`${borrowerName}_${LENDER_LABEL[lender]}`)}.zip`;
    const zipPath = `lender-packs/${appId}/${Date.now()}_${zipName}`;
    await uploadBuffer(zipPath, zipBuffer, "application/zip");
    const zipUrl = await getSignedReadUrl(zipPath, LINK_TTL);

    // ── per-document signed links (only those that actually downloaded) ──
    const links: Array<{ label: string; url: string }> = [];
    for (const d of docList) {
      if (!buffers.has(d.path)) continue;
      try { links.push({ label: d.label, url: await getSignedReadUrl(d.path, LINK_TTL) }); } catch { /* skip */ }
    }

    // ── compose + send ──
    const linksHtml = links.map((l) => `<li style="margin:4px 0"><a href="${esc(l.url)}" style="color:#178a5c">${esc(l.label)}</a></li>`).join("");

    // Credit Fair gets a DIFFERENT email body — the applicant-detail table it
    // asked for, embedded in the message. Solfin / Aerem keep the standard
    // document-forwarding text. The attached summary.xlsx is the same general
    // sheet for all three.
    const isCF = lender === "creditfair";
    const detailsHtml = isCF
      ? `<table style="border-collapse:collapse;margin:8px 0 18px;font-size:13px">${creditFairEmailRows(loan)
          .map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#5a8a76;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:3px 0;font-weight:600;color:#12271f">${esc(v || "—")}</td></tr>`)
          .join("")}</table>`
      : "";
    const intro = isCF
      ? `<p>Please find the applicant details for <b>${esc(borrowerName)}</b> below, along with the supporting documents. Kindly review and revert at the earliest.</p>`
      : `<p>Please find the loan application documents for <b>${esc(borrowerName)}</b>, submitted for your review. Kindly review and revert at the earliest.</p>`;
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#12271f;line-height:1.55">
        <p>Dear ${esc(recipientName || "Team")},</p>
        ${intro}
        ${detailsHtml}
        <p style="margin:16px 0 6px"><b>Documents</b></p>
        <ul style="margin:0 0 16px;padding-left:20px">${linksHtml || "<li>(no documents on file)</li>"}</ul>
        <p><b>Download all as a single ZIP:</b> <a href="${esc(zipUrl)}" style="color:#178a5c">${esc(zipName)}</a></p>
        <p style="color:#5a8a76;font-size:12.5px">A summary sheet is attached.</p>
        <p style="margin-top:18px">Regards,<br/>Capital Craft Advisors</p>
      </div>`;

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: SENDER, pass: GMAIL_PASS } });
    await transporter.sendMail({
      from: `"Capital Craft" <${SENDER}>`,
      to: recipientEmail,
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
      subject: `Loan application — ${borrowerName}`,
      html,
      attachments: [{ filename: "summary.xlsx", content: xlsxBuffer }],
    });

    await logLoanActivityServer(supabase, appId, "status_change", claims.business_id ?? null, { detail: `Documents emailed to ${LENDER_LABEL[lender]} — ${recipientEmail}` });

    return NextResponse.json({ ok: true, sent_to: recipientEmail, documents: links.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[send-to-lender] error:", msg);
    return err(msg, 500);
  }
}
