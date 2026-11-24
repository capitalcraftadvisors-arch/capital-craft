// Loan View · the Documents card's groups: every expected slot per step (missing
// ones shown empty), read from both document stores (doc rows + *_path columns).

import { aadhaarFaceCountsAsPhoto } from "@/lib/applicant-photo";

export type Loan = Record<string, any>;
export type Doc  = {
  id: string; category: string; storage_path: string; file_name: string | null; mime_type: string | null;
  created_at?: string | null;
};

// Slot key → epc_applications *_path column, for admin doc-removal (trash) on
// path-backed slots. Keys NOT listed here are doc-row backed (deleted by id).
export const PATH_COLUMN: Record<string, string> = {
  applicant_photo:     "customer_photo_path",
  aadhaar_front:       "aadhaar_front_path",
  aadhaar_back:        "aadhaar_back_path",
  quotation:           "proforma_invoice_path",
  ebill:               "ebill_path",
  rooftop:             "rooftop_photo_path",
  coapp_pan:           "coapp_pan_path",
  coapp_aadhaar_front: "coapp_aadhaar_front_path",
  coapp_aadhaar_back:  "coapp_aadhaar_back_path",
  bank_statement:      "bank_statement_path",
};

const DOC_LABEL: Record<string, string> = {
  customer_photo:   "Applicant photo",
  borrower_photo:   "Rooftop photo",
  rooftop_photo_extra: "Rooftop photo",
  borrower_pan:     "PAN card",
  borrower_aadhaar: "Aadhaar",
  quotation:        "Quotation / Proforma",
  electricity_bill: "Electricity bill",
  bank_statement:   "Bank statement",
  income_proof:     "Income proof",
  property_doc:     "Property document",
};

// ── Document grouping (missing-doc visibility) ───────────────────────

export type LoanSlot = {
  key: string; label: string; docId: string | null; path: string | null;
  // Viewer details (filled when the slot has a file).
  file?: string | null; mime?: string | null; at?: string | null;
};
export type LoanDocGroup = { title: string; slots: LoanSlot[] };

// Upload time of a *_path document: its *_uploaded_at column when there is one,
// else the Date.now() prefix every upload route puts in the object name.
const PATH_UPLOADED_AT: Record<string, string> = {
  quotation: "proforma_uploaded_at", ebill: "ebill_uploaded_at",
  rooftop: "rooftop_photo_uploaded_at", bank_statement: "bank_statement_uploaded_at",
};
function pathUploadedAt(loan: Loan, key: string, path: string): string | null {
  const col = PATH_UPLOADED_AT[key];
  if (col && loan[col]) return String(loan[col]);
  const m = /\/(\d{13})[_.]/.exec(path);
  return m ? new Date(Number(m[1])).toISOString() : null;
}

// Every user_application_docs category that a NAMED slot below owns. Any row in
// one of these categories belongs to its slot — never to "Other documents".
// This keeps a duplicate upload (e.g. a rooftop photo uploaded twice, or via
// both the chatbot and the classic form) from leaking a second "Rooftop photo" /
// "Applicant photo" card into the Other bucket. Extra copies are simply hidden;
// the slot shows the latest one.
const NAMED_SLOT_CATEGORIES = new Set<string>([
  "borrower_pan", "customer_photo", "borrower_photo", "quotation", "electricity_bill",
  "bank_statement", "sanction_letter", "disbursement_advice", "feasibility_report", "mmr_advance_receipt",
  "completion_invoice", "completion_panel_photo", "completion_inverter_photo",
  "completion_meter_photo", "completion_report", "rooftop_photo_extra",
]);

export function buildLoanDocGroups(loan: Loan, docsIn: Doc[]): LoanDocGroup[] {
  // Newest first, so a slot that matches by category shows the LATEST upload and
  // any older duplicate is superseded (not the stale first copy).
  const docs = [...docsIn].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const usedRowIds = new Set<string>();
  const fromRow = (key: string, label: string, d: Doc): LoanSlot => ({
    key, label, docId: d.id, path: null, file: d.storage_path, mime: d.mime_type, at: d.created_at ?? null,
  });
  const fromPath = (key: string, label: string, path: string | null | undefined): LoanSlot => ({
    key, label, docId: null, path: path ?? null, file: path ?? null, at: path ? pathUploadedAt(loan, key, path) : null,
  });
  const slot = (
    key: string, label: string, cats: string[], path: string | null | undefined,
  ): LoanSlot => {
    for (const cat of cats) {
      const row = docs.find((d) => d.category === cat && !usedRowIds.has(d.id));
      if (row) { usedRowIds.add(row.id); return fromRow(key, label, row); }
    }
    return fromPath(key, label, path);
  };

  const groups: LoanDocGroup[] = [];

  groups.push({
    title: "Identity (Steps 1–2)",
    slots: [
      slot("applicant_pan",   "Applicant PAN card", ["borrower_pan"],   null),
      slot("applicant_photo", "Applicant photo",    ["customer_photo"], loan.customer_photo_path ?? (aadhaarFaceCountsAsPhoto(loan) ? loan.aadhaar_face_path : null)),
      slot("aadhaar_front",   "Aadhaar (front)",    [], loan.aadhaar_front_path),
      slot("aadhaar_back",    "Aadhaar (back)",     [], loan.aadhaar_back_path),
    ],
  });

  groups.push({
    title: "Loan requirement (Step 3)",
    slots: [
      slot("quotation", "Quotation / Proforma invoice", ["quotation"],        loan.proforma_invoice_path),
      ...billSlots(),
      ...rooftopSlots(),
    ],
  });

  // Rooftop photos: the first (borrower_photo / rooftop_photo_path), then the
  // geo-tagged extra ones a commercial application adds (rooftop_photo_extra).
  function rooftopSlots(): LoanSlot[] {
    const out = [slot("rooftop", "Rooftop photo", ["borrower_photo"], loan.rooftop_photo_path)];
    const extra = docs.filter((d) => d.category === "rooftop_photo_extra" && !usedRowIds.has(d.id)).reverse();
    extra.forEach((d) => { usedRowIds.add(d.id); out.push(fromRow(`rooftop_${d.id}`, "Rooftop photo", d)); });
    if (out.length > 1) out.forEach((x, i) => { x.label = `Rooftop photo ${i + 1}`; });
    return out;
  }

  // Electricity bills: the read bill (ebill_path) first, then every other
  // electricity_bill row — a commercial customer may add more than one; the
  // classic form stores its bills as rows only. A row holding the same file as
  // the column is the same bill.
  function billSlots(): LoanSlot[] {
    const rows = docs.filter((d) => d.category === "electricity_bill" && !usedRowIds.has(d.id) && d.storage_path !== loan.ebill_path);
    docs.forEach((d) => { if (d.category === "electricity_bill") usedRowIds.add(d.id); });
    const out: LoanSlot[] = [];
    if (loan.ebill_path) out.push(fromPath("ebill", "Electricity bill", loan.ebill_path));
    rows.reverse().forEach((d) => out.push(fromRow(`ebill_${d.id}`, "Electricity bill", d)));
    if (out.length === 0) out.push(fromPath("ebill", "Electricity bill", null));
    if (out.length > 1) out.forEach((s, i) => { s.label = `Electricity bill ${i + 1}`; });
    return out;
  }

  const hasCoapp = loan.bill_on_applicant_name === false ||
    !!(loan.coapp_pan_path || loan.coapp_aadhaar_front_path || loan.coapp_aadhaar_back_path);
  if (hasCoapp) {
    groups.push({
      title: "Co-applicant (Step 3)",
      slots: [
        slot("coapp_pan",           "Co-applicant PAN card",        [], loan.coapp_pan_path),
        slot("coapp_aadhaar_front", "Co-applicant Aadhaar (front)", [], loan.coapp_aadhaar_front_path),
        slot("coapp_aadhaar_back",  "Co-applicant Aadhaar (back)",  [], loan.coapp_aadhaar_back_path),
      ],
    });
  }

  // Bank statements dual-read from BOTH stores: the legacy single column
  // (the OCR'd primary uploaded via Step-4's BankDocSlot) AND every
  // user_application_docs row in category "bank_statement" (the extra
  // statements added by the Step-4 multi-file uploader). Show them all —
  // taking only the first row (as slot() does) would hide the rest.
  // (A row holding the same file as the column is shown once.)
  const bankRows = docs.filter((d) => d.category === "bank_statement" && !usedRowIds.has(d.id) && d.storage_path !== loan.bank_statement_path);
  bankRows.forEach((d) => usedRowIds.add(d.id));
  const bankSlots: LoanSlot[] = [];
  if (loan.bank_statement_path) {
    bankSlots.push(fromPath("bank_statement", "Bank statement", loan.bank_statement_path));
  }
  bankRows.forEach((d) => {
    bankSlots.push(fromRow(`bank_statement_${d.id}`, "Bank statement", d));
  });
  if (bankSlots.length === 0) {
    bankSlots.push(fromPath("bank_statement", "Bank statement", null));
  }
  if (bankSlots.length > 1) {
    bankSlots.forEach((s, i) => { s.label = `Bank statement ${i + 1}`; });
  }
  groups.push({ title: "Financial (Step 4)", slots: bankSlots });

  groups.push({
    title: "Step 5 — Sanction Letter",
    slots: [
      slot("sanction_letter", "Sanction letter", ["sanction_letter"], null),
      slot("disbursement_advice", "Disbursement advice letter", ["disbursement_advice"], null),
    ],
  });

  // Solfin takes no advance receipt — its slot shows only if one was uploaded anyway.
  const receiptSlot = loan.approved_lender !== "solfin" || docs.some((d) => d.category === "mmr_advance_receipt");
  groups.push({
    title: "1st Tranche Docs",
    slots: [
      slot("feasibility_report",  "Feasibility Approval Report", ["feasibility_report"],  null),
      ...(receiptSlot ? [slot("mmr_advance_receipt", "MMR / Advance Receipt", ["mmr_advance_receipt"], null)] : []),
    ],
  });

  groups.push({
    title: "2nd Tranche Docs",
    slots: [
      slot("comp_invoice",  "Invoice / tax invoice",       ["completion_invoice"],        null),
      slot("comp_panel",    "Panel photo (geo-tagged)",    ["completion_panel_photo"],    null),
      slot("comp_inverter", "Inverter photo (geo-tagged)", ["completion_inverter_photo"], null),
      slot("comp_meter",    "Meter photo (geo-tagged)",    ["completion_meter_photo"],    null),
      slot("comp_report",   "Work completion report",      ["completion_report"],         null),
    ],
  });

  // "Other documents" = rows not consumed by a slot AND not owned by any named
  // category. A duplicate of a named category (borrower_photo / customer_photo /
  // borrower_pan / …) is never shown here — its slot already shows the latest.
  const others = docs.filter((d) => !usedRowIds.has(d.id) && !NAMED_SLOT_CATEGORIES.has(d.category));
  if (others.length > 0) {
    groups.push({
      title: "Other documents",
      // An "other" upload is shown by its file name — the EPC chatbot names it
      // after what the document is ("ITR 2024-25").
      slots: others.map((d) => fromRow(
        `other-${d.id}`,
        d.category === "other" && d.file_name ? d.file_name.replace(/\.[^.]+$/, "") : DOC_LABEL[d.category] ?? d.category.replace(/_/g, " "),
        d,
      )),
    });
  }

  return groups;
}
