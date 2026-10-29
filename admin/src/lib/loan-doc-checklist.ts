// The documents a loan application needs before Doc Sent — ONE rule shared by
// the loan profile (Doc Sent gate + progress), the admin loan table's "x/y docs"
// badge and the Message-to-EPC table. Different screens store a document
// differently (a *_path column, or a user_application_docs row by category), so
// each document counts when EITHER is present. Keeping one rule here is what
// stops the table and the profile from disagreeing again.

import { aadhaarFaceCountsAsPhoto } from "./applicant-photo";

export type LoanDocCols = {
  created_at?: string | null;
  bill_on_applicant_name?: boolean | null;
  aadhaar_front_path?: string | null;
  aadhaar_back_path?: string | null;
  aadhaar_face_path?: string | null;
  customer_photo_path?: string | null;
  proforma_invoice_path?: string | null;
  ebill_path?: string | null;
  rooftop_photo_path?: string | null;
  bank_statement_path?: string | null;
  coapp_pan_path?: string | null;
  coapp_aadhaar_front_path?: string | null;
  coapp_aadhaar_back_path?: string | null;
};

// Every *_path column on epc_applications that stores a viewable document —
// the server whitelist for signing (sign-doc, doc-urls).
export const LOAN_PATH_COLUMNS = [
  "aadhaar_front_path",
  "aadhaar_back_path",
  "aadhaar_face_path",
  "ebill_path",
  "proforma_invoice_path",
  "bank_statement_path",
  "customer_photo_path",
  "rooftop_photo_path",
  "coapp_pan_path",
  "coapp_aadhaar_front_path",
  "coapp_aadhaar_back_path",
  "coapp_aadhaar_face_path",
] as const;

// user_application_docs category for each document stored as a row.
export const DOC_CATEGORY = {
  pan: "borrower_pan",
  photo: "customer_photo",
  quotation: "quotation",
  ebill: "electricity_bill",
  rooftop: "borrower_photo",
  bank: "bank_statement",
} as const;

export function loanDocChecklist(l: LoanDocCols, categories: Iterable<string>): { key: string; ok: boolean }[] {
  const cats = new Set(categories);
  const row = (k: keyof typeof DOC_CATEGORY) => cats.has(DOC_CATEGORY[k]);
  return [
    { key: "pan", ok: row("pan") },
    { key: "photo", ok: row("photo") || !!l.customer_photo_path || aadhaarFaceCountsAsPhoto(l) },
    { key: "aadhaar_front", ok: !!l.aadhaar_front_path },
    { key: "aadhaar_back", ok: !!l.aadhaar_back_path },
    { key: "quotation", ok: row("quotation") || !!l.proforma_invoice_path },
    { key: "ebill", ok: row("ebill") || !!l.ebill_path },
    { key: "rooftop", ok: row("rooftop") || !!l.rooftop_photo_path },
    { key: "bank", ok: row("bank") || !!l.bank_statement_path },
    // Co-applicant KYC only when there is a co-applicant.
    ...(l.bill_on_applicant_name === false ? [
      { key: "coapp_pan", ok: !!l.coapp_pan_path },
      { key: "coapp_aadhaar_front", ok: !!l.coapp_aadhaar_front_path },
      { key: "coapp_aadhaar_back", ok: !!l.coapp_aadhaar_back_path },
    ] : []),
  ];
}
