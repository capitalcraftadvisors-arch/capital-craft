// POST /api/admin/loan-app/[id]/send-to-lender
//
// Two modes (JSON body `mode`):
//   • "preview" → returns the editable email content (subject, detail table,
//     document labels, default CC/BCC) WITHOUT sending. The composer shows it so
//     the admin can see exactly what's going and fix any missing field first.
//   • "send"    → sends the email from capitalcraftadvisors@gmail.com using the
//     (possibly edited) `detail` rows for the body, a link to every document, a
//     single ZIP link, and the summary attached. Recipients (to/cc/bcc) are
//     saved to email_contacts for future autocomplete.
//
// Admin-only. Keeps the Download-ZIP button untouched.

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import archiver from "archiver";
import nodemailer from "nodemailer";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { uploadBuffer, downloadBuffer, getSignedReadUrl } from "@/lib/gcs";
import { creditFairEmailRows, LENDER_LABEL, type LenderKey } from "@/lib/lender-summary";
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
const LOAN_CC_DEFAULT = ["malvikasaxena323@gmail.com"];

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
function cleanEmails(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map((x) => String(x).trim().toLowerCase()).filter((x) => EMAIL_RE.test(x))));
}

const CATEGORY_LABEL: Record<string, string> = {
  borrower_pan: "PAN", customer_photo: "Applicant photo", electricity_bill: "Electricity bill",
  bank_statement: "Bank statement", quotation: "Quotation", income_proof: "Income proof",
  property_doc: "Property document", sanction_letter: "Sanction letter", other: "Other document",
};
function prettyCategory(c: string): string {
  return CATEGORY_LABEL[c] || c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// Every attachable document for a loan, de-duplicated by path.
function loanDocList(loan: Record<string, any>, docs: Array<{ category: string; storage_path: string }>): Array<{ label: string; path: string }> {
  const seen = new Set<string>();
  const list: Array<{ label: string; path: string }> = [];
  const add = (label: string, path: string | null | undefined) => { if (!path || seen.has(path)) return; seen.add(path); list.push({ label, path }); };
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
  for (const d of docs ?? []) add(prettyCategory(d.category), d.storage_path);
  return list;
}

// 2nd-tranche completion documents (uploaded in the disbursement section). Sent
// to the lender who APPROVED the loan, so they can release the 2nd tranche.
const COMPLETION_LABELS: Record<string, string> = {
  completion_invoice: "Final invoice",
  completion_report: "Completion report",
  completion_panel_photo: "Customer with panel",
  completion_inverter_photo: "Customer with inverter",
  completion_meter_photo: "Customer with meter",
  completion_plant_photo: "Plant photo",
};
function completionDocList(docs: Array<{ category: string; storage_path: string }>): Array<{ label: string; path: string }> {
  const seen = new Set<string>();
  const list: Array<{ label: string; path: string }> = [];
  for (const d of docs ?? []) {
    const label = COMPLETION_LABELS[d.category];
    if (!label || !d.storage_path || seen.has(d.storage_path)) continue;
    seen.add(d.storage_path);
    list.push({ label, path: d.storage_path });
  }
  return list;
}
function completionDetail(loan: Record<string, any>, epcName: string): [string, string][] {
  return [
    ["Applicant", loan.borrower_name || loan.aadhaar_name || "—"],
    ["Loan ID", loan.loan_display_id || "—"],
    ["EPC Partner", epcName || "—"],
    ["Sanctioned amount", loan.sanctioned_amount != null ? "₹" + Math.round(Number(loan.sanctioned_amount)).toLocaleString("en-IN") : "—"],
    ["1st disbursement", loan.first_disbursement_amount != null ? "₹" + Math.round(Number(loan.first_disbursement_amount)).toLocaleString("en-IN") : "—"],
  ];
}

async function saveContacts(supabase: SupabaseClient, emails: string[]) {
  const now = new Date().toISOString();
  for (const email of emails) {
    try { await supabase.from("email_contacts").upsert({ email, last_used_at: now }, { onConflict: "email" }); } catch { /* non-blocking */ }
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const body = (await req.json().catch(() => ({}))) as {
      mode?: string; lender?: string; scope?: string; to?: string; toName?: string;
      cc?: string[]; bcc?: string[]; subject?: string; detail?: [string, string][];
    };
    const mode = body.mode === "send" ? "send" : "preview";
    // scope "completion" = email the 2nd-tranche completion documents (to the
    // lender who approved the loan); default = the full loan application.
    const scope = body.scope === "completion" ? "completion" : "application";
    const lender = String(body.lender ?? "").toLowerCase() as LenderKey;
    if (!LENDER_KEYS.includes(lender)) return err("Pick a lender.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: loan, error: loadErr }, { data: docs }] = await Promise.all([
      supabase.from("epc_applications").select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)").eq("id", appId).maybeSingle(),
      supabase.from("user_application_docs").select("id, category, storage_path, file_name").eq("application_id", appId),
    ]);
    if (loadErr) return err(loadErr.message, 500);
    if (!loan) return err("Loan application not found.", 404);

    const borrowerName: string = loan.borrower_name || loan.aadhaar_name || "applicant";
    const epcName: string =
      loan.epc_business?.trade_name || loan.epc_business?.legal_name || loan.epc_business?.contact_name || "";
    const allDocs = (docs ?? []) as Array<{ category: string; storage_path: string }>;
    const isCompletion = scope === "completion";
    const docList = isCompletion ? completionDocList(allDocs) : loanDocList(loan, allDocs);
    const defaultSubject = isCompletion
      ? `Completion documents (2nd tranche) — ${borrowerName}`
      : `Loan application — ${borrowerName}`;
    const defaultDetail = isCompletion ? completionDetail(loan, epcName) : creditFairEmailRows(loan, epcName);

    // ── PREVIEW ──
    if (mode === "preview") {
      // Lenders that have APPROVED this application's EPC — the only ones this
      // file can be sent to. The composer filters its dropdown to these.
      let allowedLenders: string[] = [];
      try {
        const { data: ls } = await supabase
          .from("epc_lender_status")
          .select("lender")
          .eq("business_id", loan.epc_business_id)
          .eq("approved", true);
        allowedLenders = ((ls ?? []) as { lender: string }[])
          .map((r) => r.lender)
          .filter((l): l is LenderKey => LENDER_KEYS.includes(l as LenderKey));
      } catch { /* best effort — fall back to all lenders in the composer */ }

      // Completion docs go to the lender who APPROVED this loan — lock the picker
      // to that lender so the 2nd-tranche pack can't be sent to the wrong one.
      const approvedLender = String(loan.approved_lender ?? "").toLowerCase();
      if (isCompletion && LENDER_KEYS.includes(approvedLender as LenderKey)) {
        allowedLenders = [approvedLender];
      }

      return NextResponse.json({
        ok: true,
        subject: defaultSubject,
        toName: "",
        detail: defaultDetail,
        docLabels: docList.map((d) => d.label),
        ccDefault: LOAN_CC_DEFAULT,
        bccDefault: [],
        allowedLenders,
      });
    }

    // ── SEND ──
    if (!GMAIL_PASS) return err("Email isn't configured yet (app password missing).", 500);
    const to = String(body.to ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return err("Enter a valid recipient (TO) email.", 400);
    const cc = cleanEmails(body.cc);
    const bcc = cleanEmails(body.bcc);
    const subject = String(body.subject ?? "").trim() || defaultSubject;
    const toName = String(body.toName ?? "").trim();
    const detail = Array.isArray(body.detail) && body.detail.length
      ? body.detail.map((r) => [String(r?.[0] ?? ""), String(r?.[1] ?? "")] as [string, string])
      : defaultDetail;

    // summary.xlsx built from the (edited) detail rows.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Application");
    ws.columns = [{ width: 34 }, { width: 50 }];
    const title = ws.addRow(["Capital Craft — Loan Application", ""]);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    for (const [k, v] of detail) { const r = ws.addRow([k, v]); r.getCell(1).font = { bold: true, color: { argb: "FF0F3D2E" } }; }
    const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

    // flat ZIP + per-doc signed links.
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (c: Buffer) => chunks.push(c));
    archive.on("warning", (e) => console.warn("[send-to-lender] zip warn:", e));
    const zipDone = new Promise<void>((resolve, reject) => { archive.on("end", () => resolve()); archive.on("error", reject); });
    archive.append(xlsxBuffer, { name: "summary.xlsx" });
    const buffers = new Map<string, Buffer>();
    for (const d of docList) {
      try { const buf = await downloadBuffer(d.path); buffers.set(d.path, buf); archive.append(buf, { name: `${safe(`${d.label} - ${borrowerName}`)}${extOf(d.path)}` }); }
      catch (e) { console.warn(`[send-to-lender] skip ${d.path}:`, e); }
    }
    void archive.finalize();
    await zipDone;
    const zipBuffer = Buffer.concat(chunks);

    const zipName = `${safe(`${borrowerName}_${LENDER_LABEL[lender]}`)}.zip`;
    const zipPath = `lender-packs/${appId}/${Date.now()}_${zipName}`;
    await uploadBuffer(zipPath, zipBuffer, "application/zip");
    const zipUrl = await getSignedReadUrl(zipPath, LINK_TTL);

    const links: Array<{ label: string; url: string }> = [];
    for (const d of docList) { if (!buffers.has(d.path)) continue; try { links.push({ label: d.label, url: await getSignedReadUrl(d.path, LINK_TTL) }); } catch { /* skip */ } }

    const linksHtml = links.map((l) => `<li style="margin:4px 0"><a href="${esc(l.url)}" style="color:#178a5c">${esc(l.label)}</a></li>`).join("");
    const detailHtml = `<table style="border-collapse:collapse;margin:8px 0 18px;font-size:13px">${detail
      .map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#5a8a76;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:3px 0;font-weight:600;color:#12271f">${esc(v || "—")}</td></tr>`)
      .join("")}</table>`;
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#12271f;line-height:1.55">
        <p>Dear ${esc(toName || "Team")},</p>
        <p>${isCompletion
          ? `Please find the completion (2nd tranche) documents for <b>${esc(borrowerName)}</b> below. Kindly review and release the second tranche.`
          : `Please find the applicant details for <b>${esc(borrowerName)}</b> below, along with the supporting documents. Kindly review and revert at the earliest.`}</p>
        ${detailHtml}
        <p style="margin:16px 0 6px"><b>Documents</b></p>
        <ul style="margin:0 0 16px;padding-left:20px">${linksHtml || "<li>(no documents on file)</li>"}</ul>
        <p><b>Download all as a single ZIP:</b> <a href="${esc(zipUrl)}" style="color:#178a5c">${esc(zipName)}</a></p>
        <p style="color:#5a8a76;font-size:12.5px">A summary sheet is attached.</p>
        <p style="margin-top:18px">Regards,<br/>Capital Craft Advisors</p>
      </div>`;

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: SENDER, pass: GMAIL_PASS } });
    await transporter.sendMail({
      from: `"Capital Craft" <${SENDER}>`,
      to,
      ...(cc.length ? { cc } : {}),
      ...(bcc.length ? { bcc } : {}),
      subject,
      html,
      attachments: [{ filename: "summary.xlsx", content: xlsxBuffer }],
    });

    await saveContacts(supabase, [to, ...cc, ...bcc]);
    await logLoanActivityServer(supabase, appId, "email_sent", claims.business_id ?? null, { detail: `Emailed ${isCompletion ? "completion documents" : "to"} ${LENDER_LABEL[lender]} — ${to}` });

    return NextResponse.json({ ok: true, sent_to: to, documents: links.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[send-to-lender] error:", msg);
    return err(msg, 500);
  }
}
