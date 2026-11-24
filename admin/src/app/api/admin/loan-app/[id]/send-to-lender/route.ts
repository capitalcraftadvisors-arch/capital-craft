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
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { fmtRupees } from "@/lib/money";
import { isMainAdmin } from "@/lib/hierarchy";
import { creditFairEmailRows } from "@/lib/lender-summary";
import { readSendFields, sendLenderPack, titleCaseCategory, type ComposerBody } from "@/lib/lender-pack";
import { esc } from "@/lib/html";
import { fetchLenders, lenderLabelIn } from "@/lib/loan-lenders";
import { logLoanActivityServer } from "@/lib/loan-activity-server";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const LOAN_CC_DEFAULT = ["malvikasaxena323@gmail.com"];

const CATEGORY_LABEL: Record<string, string> = {
  borrower_pan: "PAN", customer_photo: "Applicant photo", electricity_bill: "Electricity bill",
  bank_statement: "Bank statement", quotation: "Quotation", income_proof: "Income proof",
  property_doc: "Property document", sanction_letter: "Sanction letter", other: "Other document",
};
function prettyCategory(c: string): string {
  return CATEGORY_LABEL[c] || titleCaseCategory(c);
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
    ["Sanctioned amount", loan.sanctioned_amount != null ? fmtRupees(Math.round(Number(loan.sanctioned_amount))) : "—"],
    ["1st disbursement", loan.first_disbursement_amount != null ? fmtRupees(Math.round(Number(loan.first_disbursement_amount))) : "—"],
  ];
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const body = (await req.json().catch(() => ({}))) as ComposerBody & { scope?: string };
    const mode = body.mode === "send" ? "send" : "preview";
    // scope "completion" = email the 2nd-tranche completion documents (to the
    // lender who approved the loan); default = the full loan application.
    const scope = body.scope === "completion" ? "completion" : "application";
    const lender = String(body.lender ?? "").toLowerCase();

    const supabase = dbAs(token);
    // Any lender the portal works with (the registry) — not a fixed list.
    const lenders = await fetchLenders(supabase);
    const isLender = (k: string) => lenders.some((l) => l.key === k);
    if (!isLender(lender)) return err("Pick a lender.", 400);
    const lenderLabel = lenderLabelIn(lenders, lender);

    const [{ data: loan, error: loadErr }, { data: docs }] = await Promise.all([
      supabase.from("epc_applications").select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)").eq("id", appId).maybeSingle(),
      supabase.from("user_application_docs").select("id, category, storage_path, file_name").eq("application_id", appId),
    ]);
    if (loadErr) return err(loadErr.message, 500);
    if (!loan) return err("Loan application not found.", 404);
    // Pendings: the 2nd tranche (its completion pack included) opens for the team
    // only once the main admin has approved the approval details and the 1st
    // disbursement (lib/review — NULL = legacy, open).
    if (scope === "completion" && !isMainAdmin(claims)) {
      const open = (s: unknown) => s == null || s === "approved";
      if (!open(loan.approval_review_status)) return err("Locked — waiting for the admin to approve the approval details.", 403);
      if (!open(loan.disb1_review_status)) return err("Locked — waiting for the admin to approve the 1st disbursement.", 403);
    }

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
          .filter(isLender);
      } catch { /* best effort — fall back to all lenders in the composer */ }

      // Completion docs go to the lender who APPROVED this loan — lock the picker
      // to that lender so the 2nd-tranche pack can't be sent to the wrong one.
      const approvedLender = String(loan.approved_lender ?? "").toLowerCase();
      if (isCompletion && isLender(approvedLender)) {
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
    const mail = readSendFields(body, defaultSubject, defaultDetail);
    if (mail instanceof Response) return mail;
    const { to } = mail;
    const documents = await sendLenderPack(req, supabase, {
      mail,
      sheetName: "Application",
      sheetTitle: "Capital Craft — Loan Application",
      docs: docList,
      name: borrowerName,
      lenderLabel,
      zipFolder: `lender-packs/${appId}`,
      introHtml: isCompletion
        ? `Please find the completion (2nd tranche) documents for <b>${esc(borrowerName)}</b> below. Kindly review and release the second tranche.`
        : `Please find the applicant details for <b>${esc(borrowerName)}</b> below, along with the supporting documents. Kindly review and revert at the earliest.`,
      logTag: "send-to-lender",
    });

    await logLoanActivityServer(supabase, appId, "email_sent", claims.business_id ?? null, { detail: `Emailed ${isCompletion ? "completion documents" : "to"} ${lenderLabel} — ${to}` });

    return NextResponse.json({ ok: true, sent_to: to, documents });
  } catch (e) {
    const msg = errText(e);
    console.error("[send-to-lender] error:", msg);
    return err(msg, 500);
  }
}
