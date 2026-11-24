// Loan chat · the script: every turn of the apply flow in order, the edit-mode
// intro and labels, and the message id / clock helpers the page and docks share.

import type { Choice, Form } from "@/components/chat/types";
import { toIsoDate } from "@/lib/dates";
import { eligibility, idNamesMatch } from "@/lib/loan-roles";
import { nameReadable } from "@/lib/name-match";
import { CATEGORY_LABEL } from "@/lib/loan-form";
import { MOBILE_RE, EMAIL_RE } from "@/lib/validators";
import { billName, decide, finalDecision, firstDecision, hasCoapp, n1, n2, ownerCheck, p1Of, p2Of, type Step } from "./roles";
import { finalRows, firstRows, secondRows, type Row } from "./doc-rows";
import type { ExtraKey } from "./ExtraDocs";

export type Turn = {
  id: string;
  bot: string | ((f: Form) => string); // a function renders the person's name from the form when the turn opens
  kind: "text" | "pincode" | "choice" | "consent" | "doc_table" | "coapp_docs" | "doc_review" | "quotation" | "number" | "tenure" | "confirm_edit" | "edit_picker" | "decision";
  field?: string;
  rows?: Row[] | ((f: Form) => Row[]); // edit mode: limits a doc_table / coapp_docs to only the selected documents
  placeholder?: string;
  choices?: Choice[];
  validate?: (v: string) => string | null;
  when?: (f: Form) => boolean; // conditional turn — skipped when this returns false
  next?: (f: Form) => string | undefined; // choice turn: the turn an answer jumps to (none → the next turn)
  decide?: (f: Form) => Step; // decision turn — runs on arrival, takes no input
  extras?: ExtraKey[]; // edit mode: the any-number uploads this step opens (other docs, more bills / rooftop photos)
};
// A turn's table rows (a function builds them from the form when the turn opens).
export const rowsOf = (t: Turn, f: Form) => (typeof t.rows === "function" ? t.rows(f) : t.rows);

const mobileErr = (v: string) => (MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile number.");
export const dobErr = (v: string) => (toIsoDate(v) ? null : "Enter the date of birth as DD/MM/YYYY.");

const YES_NO: Choice[] = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
const IDS_CHOICES: Choice[] = [{ value: "replace", label: "Replace" }, { value: "same", label: "Same person, continue" }];
const RELATIONS: Choice[] = ["Father", "Mother", "Spouse", "Son", "Daughter", "Brother", "Sister", "Other"].map((v) => ({ value: v, label: v }));
const MOBILE_OF: Choice[] = [{ value: "applicant", label: "Applicant" }, { value: "coapp", label: "Co-applicant" }];
const CATEGORY_CHOICES: Choice[] = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }));
const idsText = (a?: string, b?: string) => `Aadhaar shows ${a}, PAN shows ${b}.`;

// Docs-first flow: the mobile creates the draft, then each person's documents
// decide the applicant / co-applicant (names, ages, the bill owner are read from
// them), then the quotation, then only the things NOT on any document are
// asked, and consent is last.
export const SCRIPT: Turn[] = [
  { id: "borrower_mobile", bot: "Customer's mobile number.", kind: "text", field: "borrower_mobile", placeholder: "10-digit mobile", validate: mobileErr },
  // Asked first: commercial customers may add more than one electricity bill
  // in the document table that follows.
  { id: "plant_use_type", bot: "Residential or commercial use?", kind: "choice", field: "plant_use_type", choices: [
    { value: "residential", label: "Residential", sub: "Home / society" },
    { value: "commercial", label: "Commercial", sub: "Shop / office / factory" },
  ] },
  // First person — Aadhaar + PAN with the bill and rooftop (+ any other
  // documents); checks only when needed.
  { id: "doc_table", bot: "Please upload the documents below.", kind: "doc_table", rows: firstRows },
  { id: "p1_ids", bot: (f) => idsText(f.aadhaar_name, f._pan_name), kind: "choice", field: "_p1_ids", choices: IDS_CHOICES, when: (f) => f._p1_ids !== "same" && !idNamesMatch(p1Of(f)), next: (f) => (f._p1_ids === "replace" ? "doc_table" : undefined) },
  { id: "p1_owner", bot: (f) => `Is the electricity bill in ${n1(f)}'s name?`, kind: "choice", field: "_p1_owner", choices: YES_NO, when: (f) => !nameReadable(f.ebill_name) },
  { id: "p1_dob", bot: (f) => `Date of birth of ${n1(f)}.`, kind: "text", field: "borrower_dob", placeholder: "DD/MM/YYYY", validate: dobErr, when: (f) => eligibility(p1Of(f)).needDob },
  { id: "p1_earning", bot: (f) => `Is ${n1(f)} earning?`, kind: "choice", field: "applicant_earning", choices: YES_NO },
  { id: "p1_decision", bot: "", kind: "decision", decide: firstDecision },
  // Second person — only when the first can't be the sole applicant.
  { id: "p2_docs", bot: (f) => `Please upload ${f._p2_role === "owner" ? `${billName(f)}'s` : "the applicant's"} Aadhaar and PAN.`, kind: "doc_table", rows: secondRows },
  { id: "p2_ids", bot: (f) => idsText(f.coapp_aadhaar_name, f._coapp_pan_name), kind: "choice", field: "_p2_ids", choices: IDS_CHOICES, when: (f) => f._p2_ids !== "same" && !idNamesMatch(p2Of(f)), next: (f) => (f._p2_ids === "replace" ? "p2_docs" : undefined) },
  { id: "p2_check", bot: "", kind: "decision", decide: ownerCheck },
  { id: "p2_dob", bot: (f) => `Date of birth of ${n2(f)}.`, kind: "text", field: "coapp_dob", placeholder: "DD/MM/YYYY", validate: dobErr, when: (f) => { const d = decide(f, true); return d.kind === "need_dob" && d.who === "p2"; } },
  { id: "p2_earning", bot: (f) => `Is ${n2(f)} earning?`, kind: "choice", field: "coapp_earning", choices: YES_NO },
  { id: "p2_decision", bot: "", kind: "decision", decide: finalDecision },
  // With a co-applicant: relation, then whose the first mobile is — only the
  // other person's number is asked. A sole applicant keeps the first mobile.
  { id: "coapp_relation", bot: (f) => `Relation of ${f.coapp_name || "the co-applicant"} to ${f.borrower_name || "the applicant"}?`, kind: "choice", field: "coapp_relation", choices: RELATIONS, when: hasCoapp },
  { id: "mobile_of", bot: (f) => `Whose number is ${f.borrower_mobile}?`, kind: "choice", field: "_mobile_of", choices: MOBILE_OF, when: hasCoapp },
  { id: "mobile_move", bot: "", kind: "decision", decide: (f) => ({ form: f._mobile_of === "coapp" ? { ...f, coapp_mobile: f.borrower_mobile, borrower_mobile: "" } : f }) },
  { id: "applicant_mobile", bot: (f) => `Mobile number of ${f.borrower_name || "the applicant"}.`, kind: "text", field: "borrower_mobile", placeholder: "10-digit mobile", validate: mobileErr, when: (f) => hasCoapp(f) && f._mobile_of === "coapp" },
  { id: "coapp_mobile", bot: (f) => `Mobile number of ${f.coapp_name || "the co-applicant"}.`, kind: "text", field: "coapp_mobile", placeholder: "10-digit mobile", when: (f) => hasCoapp(f) && f._mobile_of !== "coapp", validate: mobileErr },
  // Edit-only (opened from Capital Craft's Message to EPC).
  { id: "coapp_email", bot: (f) => `Email address of ${f.coapp_name || "the co-applicant"}?`, kind: "text", field: "coapp_email", placeholder: "name@example.com", when: () => false,
    validate: (v) => (EMAIL_RE.test(v.trim()) ? null : "Enter a valid email address.") },
  { id: "final_docs", bot: (f) => `Please upload ${f.borrower_name ? `${f.borrower_name}'s` : "the applicant's"} photo and bank statement.`, kind: "doc_table", rows: finalRows },
  { id: "quotation", bot: "Please upload the quotation / proforma invoice.", kind: "quotation" },
  // Everything uploaded so far, in one editable table (incl. the quotation) —
  // the EPC can review, open, replace, or fix any read-out value before moving on.
  { id: "doc_review", bot: "Here's everything you've uploaded. Check it, fix anything, then continue.", kind: "doc_review" },
  { id: "borrower_email", bot: "Applicant's email address?", kind: "text", field: "borrower_email", placeholder: "name@example.com" },
  { id: "install_pincode", bot: "Installation pincode?", kind: "pincode", field: "install_pincode", placeholder: "6-digit pincode" },
  { id: "system_type", bot: "Type of solar system?", kind: "choice", field: "system_type", choices: [
    { value: "on_grid", label: "On-Grid", sub: "Connected to the grid" },
    { value: "off_grid", label: "Off-Grid", sub: "Battery / standalone" },
    { value: "hybrid", label: "Hybrid", sub: "Grid + battery" },
  ] },
  { id: "connection_category", bot: "Type of category?", kind: "choice", field: "connection_category", choices: CATEGORY_CHOICES },
  { id: "loan_amount", bot: "Loan amount required?", kind: "number", field: "loan_amount_required", placeholder: "Amount in ₹" },
  { id: "tenure", bot: "Finally, the loan configuration — subsidy and tenure.", kind: "tenure" },
  // Lead owner — the EPC's team member who brought this lead, asked just before
  // consent. Phone is optional but, when given, must be a valid mobile.
  { id: "lead_owner_name", bot: "Who is the lead owner on your team?", kind: "text", field: "lead_owner_name", placeholder: "Lead owner's name" },
  { id: "lead_owner_phone", bot: "Lead owner's phone number?", kind: "text", field: "lead_owner_phone", placeholder: "10-digit mobile", validate: (v) => (!v.trim() || MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile number.") },
  { id: "consent", bot: "Does the customer agree to the Terms, Privacy & Cookie policies and allow a credit check?", kind: "consent" },
];

// ── Edit mode ────────────────────────────────────────────────────────────────
// The SAME chatbot serves editing: the dashboard "Edit" button opens
// /dashboard/apply/chat?id=<app>&edit=1. We greet, confirm intent, then show a
// pick-what-to-edit table (multi-select) built from what's already on file, and
// re-ask ONLY the ticked items (each pre-filled with the current value). Submit
// pushes straight into the same pipeline the Capital Craft team sees.
export const EDIT_INTRO: Turn[] = [
  { id: "confirm_edit", bot: "Do you want to edit this application?", kind: "confirm_edit" },
  { id: "edit_picker", bot: "What would you like to change? Tick everything you want to update, then continue.", kind: "edit_picker" },
];
// Short labels for the "Editing: …" summary bubble + picker rows.
export const PICK_LABEL: Record<string, string> = {
  aadhaar: "Aadhaar", pan: "PAN card", ebill: "Electricity bill", rooftop: "Rooftop photo",
  selfie: "Applicant photo", bank: "Bank statement",
  coapp_aadhaar: "Co-applicant Aadhaar", coapp_pan: "Co-applicant PAN", coapp_mobile: "Co-applicant mobile",
  borrower_email: "Email", install_pincode: "Pincode", system_type: "System type", plant_use_type: "Property use", connection_category: "Category",
  quotation: "Quotation", loan_amount: "Loan amount", loan_config: "Loan configuration",
  lead_owner_name: "Lead owner name", lead_owner_phone: "Lead owner phone",
  other_docs: "Other documents", extra_bills: "More electricity bills", extra_rooftops: "More rooftop photos",
};

// Message ids, and the time under a message (this chat's own "04:05 pm" clock).
export const uidGen = () => "m" + Math.random().toString(36).slice(2, 9);
export const nowLabel = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
