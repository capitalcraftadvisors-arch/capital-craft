"use client";

// EPC-facing loan-application chatbot — the partner fills their OWN loan
// application from their portal. This is SEPARATE from the internal team
// chatbot (admin/app/intake): it never asks which EPC (the logged-in partner
// is known), and it persists through the EPC-only routes:
//   • create   → POST /api/epc/loan-apply { phase:"register" }  (auto-tags EPC)
//   • docs     → /api/admin/loan-app/[id]/extract-* + /api/upload (EPC-allowed
//                for the owning EPC), read into the in-memory form
//   • submit   → POST /api/epc/loan-apply { phase:"submit", ...all fields }
//
// Flow: greeting → customer mobile (creates the draft) → residential / commercial
// → document TABLE (e-bill — more than one for commercial — Aadhaar, PAN,
// rooftop, any other documents) → earning (Yes / No) → role decision (lib/loan-roles):
// a second person's Aadhaar + PAN only when the first can't be the sole
// applicant (bill owner over 60 / under 21 / not earning, or the bill in someone
// else's name) → the roles, stated in one line → relation + whose mobile (only
// with a co-applicant) → applicant photo + bank statement → quotation → review →
// the details not on any document (email, pincode, system type) → loan
// amount → tenure → lead owner → consent → success. Swapping roles is the
// Capital Craft team's (admin profile), not the EPC's. All uploads/OCR run
// against the EPC's own token; RLS scopes writes. Roles are decided here and
// written in the ONE submit.

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { getBusiness, getToken } from "@/lib/auth";
import { fetchEpcName } from "@/lib/epc-name";
import { deleteDocument, getDocumentUrl } from "@/lib/storage";
import { nameDocument } from "@/lib/ocr";
import { hydrateLoanForm } from "@/lib/loan-form";
import { numberToWordsIndian } from "@/lib/numberToWords";
import { nameReadable } from "@/lib/name-match";
import { fmtDate, toIsoDate } from "@/lib/dates";
import { coappReasonText, decideRoles, eligibility, idNamesMatch, isBillOwner, personName, type IneligibleReason, type PersonFacts, type RoleDecision } from "@/lib/loan-roles";
import EditTable from "@/components/EditTable";
import { computeCentralSubsidy, computeEmi, DEFAULT_INDICATIVE_ROI, TENURES, formatRupees } from "@/lib/emi";

const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^[1-9]\d{5}$/;

type Form = Record<string, string>;
type Msg = { id: string; _id?: string; from: "bot" | "user"; text?: string; time: string; files?: { name: string; thumb: string | null }[]; turnId?: string; pass?: string; value?: string /* the answer as stored, for ✎ Edit */ };
type Choice = { value: string; label: string; sub?: string };
// What an automatic (decision) turn does: an optional one-line bot message, the
// next form, and the turn to jump to (none → the next turn).
type Step = { say?: string; form: Form; goto?: string };
type Turn = {
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
};

const mobileErr = (v: string) => (MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile number.");

// The lead owner this EPC last used on this device — pre-fills the lead-owner
// inputs only (never written into the form on its own). Saved after a submit.
const leadOwnerKey = () => `cc.leadOwner.${getBusiness()?.id ?? ""}`;
function lastLeadOwner(field: string): string {
  try { return (JSON.parse(localStorage.getItem(leadOwnerKey()) || "{}") as Form)[field] || ""; } catch { return ""; }
}
const dobErr = (v: string) => (toIsoDate(v) ? null : "Enter the date of birth as DD/MM/YYYY.");

// ── Applicant / co-applicant roles ───────────────────────────────────────────
// p1 (the first person uploaded) reads into the APPLICANT keys and p2 into the
// CO-APPLICANT keys. The two lists are index-aligned, so the automatic
// assignment can swap the two people. "_" keys stay in the browser (never
// submitted).
const APPLICANT_KEYS = [
  "aadhaar_name", "aadhaar_dob", "aadhaar_gender", "aadhaar_number", "aadhaar_care_of", "aadhaar_address",
  "aadhaar_front_path", "aadhaar_back_path", "aadhaar_face_path",
  "borrower_pan", "borrower_father_name", "_pan_name", "borrower_dob", "borrower_pan_path", "borrower_pan_mime", "borrower_pan_file_name", "_pan_url",
  "applicant_earning",
];
const COAPP_KEYS = [
  "coapp_aadhaar_name", "coapp_aadhaar_dob", "coapp_aadhaar_gender", "coapp_aadhaar_number", "coapp_aadhaar_care_of", "coapp_aadhaar_address",
  "coapp_aadhaar_front_path", "coapp_aadhaar_back_path", "coapp_aadhaar_face_path",
  "coapp_pan", "coapp_father_name", "_coapp_pan_name", "coapp_dob", "coapp_pan_path", "_coapp_pan_mime", "_coapp_pan_file_name", "_coapp_pan_url",
  "coapp_earning",
];
// Everything about one person, cleared when they must be re-uploaded.
const P1_RESET = [...APPLICANT_KEYS, "_p1_ids", "_p1_owner", "_p1_pan_required"];
const P2_RESET = [...COAPP_KEYS, "_p2_ids"];

const without = (f: Form, keys: string[]): Form => { const g = { ...f }; for (const k of keys) delete g[k]; return g; };
function swapPersons(f: Form): Form {
  const g = without(f, [...APPLICANT_KEYS, ...COAPP_KEYS]);
  APPLICANT_KEYS.forEach((a, i) => {
    const c = COAPP_KEYS[i];
    if (f[c] !== undefined) g[a] = f[c];
    if (f[a] !== undefined) g[c] = f[a];
  });
  return g;
}

const yesNo = (v?: string): boolean | null => (v === "true" ? true : v === "false" ? false : null);
const p1Of = (f: Form): PersonFacts => ({ aadhaarName: f.aadhaar_name, panName: f._pan_name, aadhaarDob: f.aadhaar_dob, panDob: f.borrower_dob, earning: yesNo(f.applicant_earning) });
const p2Of = (f: Form): PersonFacts => ({ aadhaarName: f.coapp_aadhaar_name, panName: f._coapp_pan_name, aadhaarDob: f.coapp_aadhaar_dob, panDob: f.coapp_dob, earning: yesNo(f.coapp_earning) });
const billName = (f: Form) => (nameReadable(f.ebill_name) ? f.ebill_name.trim() : "the bill owner");
const n1 = (f: Form) => personName(p1Of(f)) || "the customer";
const n2 = (f: Form) => personName(p2Of(f)) || (f._p2_role === "owner" ? billName(f) : "the applicant");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// The file has a co-applicant: the role decision, or (editing a filed
// application) the roles on file — else any co-applicant data already on it.
const hasCoapp = (f: Form) => (f._has_coapp ? f._has_coapp === "1"
  : f.bill_on_applicant_name ? f.bill_on_applicant_name === "false"
  : !!(f.coapp_pan || f.coapp_aadhaar_number || f.coapp_pan_path || f.coapp_aadhaar_front_path));
// The EPC's "Is the bill in <name>'s name?" answer counts only while the bill
// name is unreadable — once a readable bill is uploaded, the names decide.
const p1OwnerAnswer = (f: Form) => (nameReadable(f.ebill_name) ? null : yesNo(f._p1_owner));
const decide = (f: Form, withP2: boolean) => decideRoles({ ebillName: f.ebill_name, p1: p1Of(f), p2: withP2 ? p2Of(f) : null, p1IsOwner: p1OwnerAnswer(f) });

const WHY: Record<IneligibleReason, string> = { over_60: "is over 60", under_21: "is under 21", not_earning: "is not earning", dob_unknown: "has no readable date of birth" };

// Final roles from a decision: the applicant ends in the applicant keys, the
// co-applicant (pair only) in the co-applicant keys; a dropped person is cleared.
// In a pair the co-applicant is always the bill owner; alone, the applicant is.
function assignRoles(f: Form, d: Extract<RoleDecision, { kind: "single" | "pair" }>): Form {
  const pair = d.kind === "pair";
  const g = d.applicant === "p2" ? swapPersons(f) : f;
  const h = pair ? g : without(g, [...P2_RESET, "coapp_mobile", "coapp_relation"]);
  return {
    ...h,
    borrower_name: personName(p1Of(h)),
    coapp_name: pair ? personName(p2Of(h)) : "",
    coapp_role_reason: pair ? coappReasonText(d.reason) : "",
    _has_coapp: pair ? "1" : "0",
  };
}

// After the first person's documents + earning: they apply alone, or who the
// second person must be (an applicant beside the bill owner, or the bill owner).
function firstDecision(f: Form): Step {
  // The bill owner's documents are mandatory: no PAN → back to the table with the PAN row required.
  if (!f.borrower_pan_path && (p1OwnerAnswer(f) ?? isBillOwner(p1Of(f), f.ebill_name))) {
    return { say: `${cap(n1(f))}'s PAN is required.`, form: { ...f, _p1_pan_required: "1" }, goto: "doc_table" };
  }
  const d = decide(f, false);
  if (d.kind === "single") return { say: `${cap(n1(f))} will be the applicant.`, form: assignRoles(f, d), goto: "coapp_relation" };
  if (d.kind === "need_p2") {
    // Replacing the applicant while the bill owner is already on file → straight to the final decision.
    if (d.p2Role === "owner" && f._p2_role === "owner" && f.coapp_aadhaar_front_path) return { form: f, goto: "p2_decision" };
    return d.p2Role === "owner"
      ? { say: nameReadable(f.ebill_name) ? `The electricity bill is in ${billName(f)}'s name.` : undefined, form: { ...f, _p2_role: "owner" } }
      : { say: `${cap(n1(f))} ${WHY[d.reason.slice(6) as IneligibleReason]} and will be the co-applicant.`, form: { ...f, _p2_role: "applicant" } };
  }
  if (d.kind === "ask_owner") return { form: f, goto: "p1_owner" };
  if (d.kind === "need_dob") return { form: f, goto: "p1_dob" };
  return { form: f };
}

// The second person was asked for as the bill owner — their name must match the bill.
const notOwner = (f: Form): Step => ({ say: `This isn't ${billName(f)}.`, form: without(f, P2_RESET), goto: "p2_docs" });
function ownerCheck(f: Form): Step {
  return f._p2_role === "owner" && isBillOwner(p2Of(f), f.ebill_name) === false ? notOwner(f) : { form: f };
}

// With both people: assign the roles, or ask for a different person (that
// person's keys are cleared, so the table needs a new upload).
function finalDecision(f: Form): Step {
  const d = decide(f, true);
  if (d.kind === "single" || d.kind === "pair") {
    const g = assignRoles(f, d);
    return {
      say: d.kind === "single"
        ? `${cap(g.borrower_name || "the applicant")} will be the sole applicant.`
        : `${cap(g.borrower_name || "the applicant")} will be the applicant and ${g.coapp_name || "the bill owner"} the co-applicant.`,
      form: g,
    };
  }
  if (d.kind === "need_new_applicant") {
    return d.replace === "p2"
      ? { say: `${cap(n2(f))} ${WHY[d.reason]} and can't be the applicant.`, form: without(f, P2_RESET), goto: "p2_docs" }
      : { say: `Neither ${n1(f)} nor ${n2(f)} can be the applicant.`, form: without(f, P1_RESET), goto: "doc_table" };
  }
  if (d.kind === "p2_not_owner") return notOwner(f);
  if (d.kind === "need_dob") return { form: f, goto: d.who === "p1" ? "p1_dob" : "p2_dob" };
  if (d.kind === "ask_owner") return { form: f, goto: "p1_owner" };
  return { form: f, goto: "p2_docs" };
}

const YES_NO: Choice[] = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
const IDS_CHOICES: Choice[] = [{ value: "replace", label: "Replace" }, { value: "same", label: "Same person, continue" }];
const RELATIONS: Choice[] = ["Father", "Mother", "Spouse", "Son", "Daughter", "Brother", "Sister", "Other"].map((v) => ({ value: v, label: v }));
const MOBILE_OF: Choice[] = [{ value: "applicant", label: "Applicant" }, { value: "coapp", label: "Co-applicant" }];
const idsText = (a?: string, b?: string) => `Aadhaar shows ${a}, PAN shows ${b}.`;

// Docs-first flow: the mobile creates the draft, then each person's documents
// decide the applicant / co-applicant (names, ages, the bill owner are read from
// them), then the quotation, then only the things NOT on any document are
// asked, and consent is last.
const SCRIPT: Turn[] = [
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
const EDIT_INTRO: Turn[] = [
  { id: "confirm_edit", bot: "Do you want to edit this application?", kind: "confirm_edit" },
  { id: "edit_picker", bot: "What would you like to change? Tick everything you want to update, then continue.", kind: "edit_picker" },
];
// Short labels for the "Editing: …" summary bubble + picker rows.
const PICK_LABEL: Record<string, string> = {
  aadhaar: "Aadhaar", pan: "PAN card", ebill: "Electricity bill", rooftop: "Rooftop photo",
  selfie: "Applicant photo", bank: "Bank statement",
  coapp_aadhaar: "Co-applicant Aadhaar", coapp_pan: "Co-applicant PAN", coapp_mobile: "Co-applicant mobile",
  borrower_email: "Email", install_pincode: "Pincode", system_type: "System type", plant_use_type: "Property use",
  quotation: "Quotation", loan_amount: "Loan amount", loan_config: "Loan configuration",
  lead_owner_name: "Lead owner name", lead_owner_phone: "Lead owner phone",
};

// Fields whose typed amount is echoed in Indian words under the input.
const AMOUNT_FIELDS = new Set(["loan_amount_required"]);
// Integer → Indian words (lakh / crore). Empty for non-positive / invalid.
// Words only (no "Rupees Only" suffix — callers append " rupees" in the UI).
function amountInWords(n: number): string {
  return Number.isFinite(n) && n > 0 ? numberToWordsIndian(Math.floor(n)) : "";
}

const uidGen = () => "m" + Math.random().toString(36).slice(2, 9);
const nowLabel = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

// Falling confetti pieces for the success screen (celebratory motion).
const CONFETTI = Array.from({ length: 18 }).map((_, i) => ({
  left: `${(i * 5.6 + 2) % 98}%`,
  color: ["#1db877", "#5b8def", "#f0b429", "#ffffff", "#93b4ff", "#ff8fb0"][i % 6],
  delay: `${((i * 0.31) % 3).toFixed(2)}s`,
  dur: `${(3 + (i % 5) * 0.7).toFixed(1)}s`,
}));

export default function EpcLoanChatPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <ChatInner />
    </AuthGuard>
  );
}

function ChatInner() {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [form, setForm] = useState<Form>({});
  const [appId, setAppId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ loanId: string | null; borrowerName: string; edit: boolean } | null>(null);
  const [epcName, setEpcName] = useState("");
  // Edit mode: the active script is stateful (apply = SCRIPT; edit = intro then a
  // dynamically-built subset). `ready` gates the first question until the mount
  // effect has decided the mode (and hydrated an existing application for edit).
  const [script, setScript] = useState<Turn[]>(SCRIPT);
  const [editMode, setEditMode] = useState(false);
  const [ready, setReady] = useState(false);
  const [docRows, setDocRows] = useState<{ id: string; category: string; storage_path: string | null }[]>([]);
  // Documents the EPC was asked to fix (from a "Message to EPC" deep-link) — the
  // edit picker opens with them pre-ticked.
  const [editDocs, setEditDocs] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<{ msgs: Msg[]; form: Form; idx: number }[]>([]);
  // Loan-config step (subsidy + tenure), mirroring the team chatbot's last step.
  const [subsidyCase, setSubsidyCase] = useState<"subsidy" | "non_subsidy">("subsidy");
  const [centralSub, setCentralSub] = useState("");
  const [stateSub, setStateSub] = useState("");
  const [tenure, setTenure] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  // The consent bubble is echoed at most once even across submit retries.
  const consentSent = useRef(false);

  const turn = script[idx] ?? null;

  const pushBot = (text: string, id?: string) =>
    setMsgs((m) => (id && m.some((x) => x.from === "bot" && x._id === id) ? m : [...m, { id: uidGen(), _id: id, from: "bot", text, time: nowLabel() }]));
  const pushUser = (text: string, files?: Msg["files"], turnId?: string, value?: string) =>
    setMsgs((m) => [...m, { id: uidGen(), from: "user", text, time: nowLabel(), files, turnId, pass: form._pass, value }]);
  const prefillRef = useRef("");

  // Warm greeting on mount, then the first question. In edit mode (?id&edit=1)
  // we adopt the existing application first (hydrate every field + which docs are
  // on file) and switch to the edit script before the first question is asked.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const q = new URLSearchParams(window.location.search);
      const editing = q.get("edit") === "1" && !!q.get("id");
      if (editing) {
        const qid = q.get("id")!;
        setEditMode(true);
        setAppId(qid);
        const allow = await hydrate(qid);
        const dtag = q.get("doc");
        const urlKeys = dtag ? dtag.split(",").map((s) => s.trim()).filter(Boolean) : [];
        // Capital Craft's grant (edit_allow on the profile) is authoritative and
        // limits the edit to exactly those rows; the deep-link's doc keys are a
        // fallback. With no grant (an unlocked draft) the full picker shows.
        const grant = allow.length ? allow : urlKeys;
        if (grant.length) {
          setEditDocs(grant);
          setScript(buildGrantedScript(grant));
        } else {
          setScript(EDIT_INTRO);
        }
      }
      const epcName = await fetchEpcName();
      if (epcName && epcName !== "there") setEpcName(epcName);
      const name = epcName && epcName !== "there" ? ` ${epcName}` : "";
      pushBot(`नमस्ते${name}! 🙏`, "g1");
      setTimeout(() => pushBot(
        editing
          ? "Let's update this application. I'll take you through the details, then you can re-submit."
          : "Welcome to Capital Craft. I'll help you complete your loan application in a few quick steps.",
        "g2"), 250);
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask the active turn's question (deduped). The very first question waits for
  // the two greeting bubbles so the order is greeting → welcome → question.
  useEffect(() => {
    if (!ready || !turn || done) return;
    // Skip a conditional turn (e.g. the co-applicant docs when the names match).
    if (turn.when && !turn.when(form)) { setIdx((i) => i + 1); return; }
    // The prompt is deduped per pass, so a turn reached again by a backward
    // jump asks again while an undo/edit restore doesn't repeat it.
    const pid = `${turn.id}:${form._pass || 0}`;
    // A decision turn takes no input: act on the role decision and move on.
    if (turn.kind === "decision") {
      const s = turn.decide!(form);
      if (s.say) pushBot(s.say, pid);
      goTo(s.goto, s.form);
      return;
    }
    const t = setTimeout(() => pushBot(typeof turn.bot === "function" ? turn.bot(form) : turn.bot, pid), idx === 0 ? 800 : 300);
    setError(null);
    // Pre-fill the box: an explicit edit-jump value wins; otherwise, when editing,
    // seed from the value already on the application (email loses its @gmail.com).
    let pre = prefillRef.current; prefillRef.current = "";
    if (!pre && turn.field && form[turn.field] && (turn.kind === "text" || turn.kind === "pincode" || turn.kind === "number")) {
      pre = String(form[turn.field]);
    }
    if (!pre && turn.field && (turn.id === "lead_owner_name" || turn.id === "lead_owner_phone")) pre = lastLeadOwner(turn.field);
    setInput(pre);
    if ((turn.kind === "text" || turn.kind === "pincode" || turn.kind === "number")) setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, done, ready]);

  // Keep pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, done]);

  // Seed the loan-config defaults on arrival. When editing, prefer the values
  // already on the application (subsidy / state subsidy / tenure); otherwise
  // compute the central subsidy from the plant size, as in a fresh application.
  useEffect(() => {
    if (turn?.id !== "tenure") return;
    const commercial = form.plant_use_type === "commercial";
    const existingCentral = form.central_subsidy != null && form.central_subsidy !== "" ? Number(form.central_subsidy) : null;
    setCentralSub(String(commercial ? 0 : (existingCentral ?? computeCentralSubsidy(Number(form.project_size) || 0))));
    if (form.state_subsidy) setStateSub(String(form.state_subsidy));
    const t = Number(form.selected_tenure_years);
    if (Number.isFinite(t) && (TENURES as readonly number[]).includes(t)) setTenure(t);
    if (commercial) setSubsidyCase("non_subsidy");
    else if (existingCentral != null) setSubsidyCase(existingCentral > 0 ? "subsidy" : "non_subsidy");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn?.id]);

  const merge = (patch: Form) => setForm((f) => ({ ...f, ...patch }));
  const advance = () => setIdx((i) => i + 1);
  // Set the form and move to a turn by id (none → the next turn). A backward
  // jump starts a new pass (`_pass`), so the turns from there are asked again.
  function goTo(id: string | undefined, f: Form) {
    const ti = id ? script.findIndex((t) => t.id === id) : -1;
    if (ti < 0) { setForm(f); advance(); return; }
    setForm(ti < idx ? { ...f, _pass: String((Number(f._pass) || 0) + 1) } : f);
    setIdx(ti);
  }
  const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });

  // ── Edit mode: hydrate an existing application into the form ────────────────
  // Loads every persisted field + which documents are on file, so re-asked
  // questions come pre-filled and the picker can show current values + View.
  async function hydrate(id: string): Promise<string[]> {
    try {
      const { form: p, docRows: rows, row } = await hydrateLoanForm(id);
      setDocRows(rows);
      setForm((f) => ({ ...f, ...p }));
      // The Capital-Craft-granted edit scope (0085) — empty for an unlocked draft.
      return Array.isArray(row.edit_allow) ? (row.edit_allow as string[]).filter((k) => typeof k === "string") : [];
    } catch { return []; /* leave the form empty; the picker still lets them re-add docs */ }
  }

  // A when-stripped clone of a SCRIPT turn (edit mode always asks a chosen turn).
  const cloneTurn = (id: string): Turn => { const t = SCRIPT.find((x) => x.id === id)!; return { ...t, when: undefined }; };
  // Build the edit script from the ticked picker keys: intro → selected docs →
  // co-applicant → quotation → details → loan → consent.
  function buildEditScript(keys: string[]): Turn[] {
    const has = (k: string) => keys.includes(k);
    // Aadhaar is read front + back together — either side opens the pair.
    const unitOn = (u: Unit) => has(u) || has(u + "_front") || has(u + "_back");
    const turns: Turn[] = [...EDIT_INTRO];
    const appUnits = (["aadhaar", "pan", "ebill", "rooftop", "selfie", "bank"] as Unit[]).filter(unitOn);
    if (appUnits.length) turns.push({ id: "doc_table", bot: "Re-upload the selected document(s) — details are read again automatically.", kind: "doc_table", rows: APPLICANT_ROWS.filter((r) => appUnits.includes(r.unit)) });
    const coUnits = (["coapp_aadhaar", "coapp_pan"] as Unit[]).filter(unitOn);
    if (coUnits.length) turns.push({ id: "coapp_docs", bot: "Re-upload the co-applicant document(s).", kind: "coapp_docs", rows: COAPP_ROWS.filter((r) => coUnits.includes(r.unit)) });
    if (has("coapp_mobile")) turns.push(cloneTurn("coapp_mobile"));
    if (has("coapp_email")) turns.push(cloneTurn("coapp_email"));
    if (has("quotation")) turns.push(cloneTurn("quotation"));
    if (has("borrower_email")) turns.push(cloneTurn("borrower_email"));
    if (has("install_pincode")) turns.push(cloneTurn("install_pincode"));
    if (has("system_type")) turns.push(cloneTurn("system_type"));
    if (has("plant_use_type")) turns.push(cloneTurn("plant_use_type"));
    if (has("loan_amount")) turns.push(cloneTurn("loan_amount"));
    if (has("loan_config")) turns.push(cloneTurn("tenure"));
    if (has("lead_owner_name")) turns.push(cloneTurn("lead_owner_name"));
    if (has("lead_owner_phone")) turns.push(cloneTurn("lead_owner_phone"));
    turns.push(cloneTurn("consent"));
    return turns;
  }
  // When Capital Craft has opened specific rows (a grant), skip the pick-what-to-
  // edit table and go straight into editing exactly those: confirm → the granted
  // fields → consent.
  function buildGrantedScript(keys: string[]): Turn[] {
    return buildEditScript(keys).filter((t) => t.id !== "edit_picker");
  }

  // Undo — snapshot the state before each step so the RM can step back one
  // question and fix an answer. The created draft (appId) is kept.
  function pushUndo() { setUndoStack((s) => [...s.slice(-24), { msgs, form, idx }]); }
  function undo() {
    setUndoStack((s) => {
      if (!s.length) return s;
      const snap = s[s.length - 1];
      setMsgs(snap.msgs); setForm(snap.form); setIdx(snap.idx);
      setError(null); setInput("");
      return s.slice(0, -1);
    });
  }

  // ── Register: create the draft as soon as we have the mobile, so the
  // document uploads that follow have an application to attach to. ────────────
  async function register(f: Form): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/epc/loan-apply", {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "register", borrower_mobile: f.borrower_mobile }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't start the application."); return false; }
      setAppId(j.id);
      if (j.loan_display_id) merge({ loan_display_id: j.loan_display_id });
      // Non-blocking duplicate warning — a profile with this mobile already exists.
      if (Array.isArray(j.duplicates) && j.duplicates.length) {
        const names = j.duplicates
          .map((d: { borrower_name: string | null; loan_display_id: string | null }) =>
            `${d.borrower_name || "a profile"}${d.loan_display_id ? ` (${d.loan_display_id})` : ""}`)
          .join(", ");
        pushBot(`⚠️ This mobile already has ${j.duplicates.length} application${j.duplicates.length > 1 ? "s" : ""} on file — ${names}. You can continue, but please check this isn't a duplicate.`);
      }
      return true;
    } catch (e) {
      setError((e as Error)?.message || "Network error."); return false;
    } finally { setBusy(false); }
  }

  // ── Answer handlers ───────────────────────────────────────────────────────
  async function submitText() {
    if (!turn) return;
    let v = input.trim();
    if (!v) { setError("This field is required."); return; }
    // Email: a full address is entered as-is (no @gmail.com default — the EPC's
    // customer may use any provider).
    if (turn.id === "borrower_email") {
      if (!EMAIL_RE.test(v)) { setError("Enter a valid email address."); return; }
    } else if (turn.validate) {
      const e = turn.validate(v); if (e) { setError(e); return; }
    }
    // A typed DOB is kept as DD/MM/YYYY (coapp_dob is a text column).
    if (turn.validate === dobErr) v = fmtDate(toIsoDate(v));
    if (turn.id === "coapp_mobile" && v === form.borrower_mobile) { setError("Co-applicant mobile can't be the same as the applicant's."); return; }
    if (turn.id === "applicant_mobile" && v === form.coapp_mobile) { setError("Applicant mobile can't be the same as the co-applicant's."); return; }
    const next = turn.field ? { ...form, [turn.field]: v } : form;
    // The mobile creates the draft (once) before the document step.
    if (turn.id === "borrower_mobile" && !appId) {
      const ok = await register(next);
      if (!ok) return; // stay on the mobile turn; error shown, input kept
    }
    pushUndo();
    pushUser(v, undefined, turn.id, v);
    if (turn.field) setForm(next);
    advance();
  }

  async function submitNumber() {
    if (!turn) return;
    const n = Number(input.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) { setError("Enter a valid amount."); return; }
    const cost = Number(form.total_project_cost) || 0;
    if (cost > 0 && n > cost) { setError(`Loan amount can't exceed the project cost (₹${cost.toLocaleString("en-IN")}).`); return; }
    pushUndo();
    pushUser(`₹${n.toLocaleString("en-IN")}`, undefined, turn.id, String(n));
    if (turn.field) merge({ [turn.field]: String(n) });
    advance();
  }

  async function submitPincode() {
    if (!turn) return;
    const pin = input.trim();
    if (!PIN_RE.test(pin)) { setError("Enter a valid 6-digit pincode."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/pincode-lookup?pin=${pin}`, { headers: auth() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok || !String(j.state ?? "").trim()) {
        setError(j?.error || "Couldn't find that pincode — please check and try again.");
        return;
      }
      pushUndo();
      pushUser(pin, undefined, turn.id, pin);
      merge({ install_pincode: pin, install_state: String(j.state), install_district: String(j.district ?? ""), install_city: String(j.city ?? "") });
      pushBot(`Got it — ${[j.city, j.state].filter(Boolean).join(", ")}.`);
      advance();
    } catch {
      setError("Lookup failed — please try again.");
    } finally { setBusy(false); }
  }

  async function choose(c: Choice) {
    if (!turn?.field) return;
    pushUndo();
    pushUser(c.label, undefined, turn.id);
    const next = { ...form, [turn.field]: c.value };
    goTo(turn.next?.(next), next);
  }

  // Edit an earlier answer: jump back to that step (prefilled) via the undo
  // stack. Steps after it are re-asked (their answers may depend on this one).
  // The pass picks the right snapshot when the step was asked more than once.
  function editAnswer(turnId: string, pass?: string, value?: string) {
    const ti = script.findIndex((t) => t.id === turnId);
    if (ti < 0) return;
    setUndoStack((s) => {
      const i = s.findIndex((snap) => snap.idx === ti && snap.form._pass === pass);
      if (i < 0) return s;
      const snap = s[i];
      // Prefill the box with the answer given (the live form may hold the other
      // person's value once the roles are assigned or swapped).
      if (script[ti].kind === "text" || script[ti].kind === "pincode" || script[ti].kind === "number") {
        prefillRef.current = value || "";
      }
      setMsgs(snap.msgs); setForm(snap.form); setIdx(snap.idx);
      setError(null);
      return s.slice(0, i);
    });
  }

  async function giveConsent() {
    // Guard against a double-tap (a laggy click firing twice before the dock
    // hides) — never submit or echo the consent bubble more than once.
    if (busy) return;
    // A blank profile can't be submitted — the Aadhaar (front & back) is the
    // minimum. Block here with a clear message before consent/submit.
    if (!form.aadhaar_front_path || !form.aadhaar_back_path) {
      setError("Please upload the applicant's Aadhaar (front & back) before submitting.");
      return;
    }
    // Echo the consent only once; a retry after a failed submit reuses it rather
    // than stacking another "Yes, the customer consents." bubble.
    if (!consentSent.current) { pushUser("Yes, the customer consents."); consentSent.current = true; }
    await submitApplication();
  }

  function finishDocTable() {
    // Keep the table only — no filename receipt bubble in the chat.
    pushUndo();
    advance();
  }

  async function submitApplication() {
    if (!appId) { setError("Application not created."); return; }
    setBusy(true); setError(null);
    try {
      const commercial = form.plant_use_type === "commercial";
      const loanAmt = Number(form.loan_amount_required) || 0;
      const tenure = Number(form.selected_tenure_years) || 0;
      // Subsidy is chosen in the loan-config step; commercial (C&I) is always 0.
      const central = commercial ? 0 : (Number(form.central_subsidy) || 0);
      const stateSubsidy = commercial ? 0 : (Number(form.state_subsidy) || 0);
      const monthlyEmi = tenure ? computeEmi(loanAmt, DEFAULT_INDICATIVE_ROI, tenure) : 0;
      const subsidyEmi = tenure ? computeEmi(Math.max(0, loanAmt - central - stateSubsidy), DEFAULT_INDICATIVE_ROI, tenure) : 0;
      const res = await fetch("/api/epc/loan-apply", {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "submit", id: appId,
          // Edit re-submit: the server then only validates/writes what's in scope,
          // never blocking on project/loan fields outside the granted rows.
          edit: editMode,
          // Consent (collected at the very end) + the non-document details.
          consented: true,
          // Names are set when the roles are assigned; the ID name is the fallback.
          borrower_name: form.borrower_name || personName(p1Of(form)) || null,
          // Keys added for the role decision are sent ONLY when present (the
          // route writes them only then) — undefined drops out of the JSON. The
          // applicant's mobile is asked only when applying (edit keeps the one on file).
          borrower_mobile: editMode ? undefined : form.borrower_mobile || undefined,
          borrower_email: form.borrower_email || null,
          install_pincode: form.install_pincode || null,
          install_state: form.install_state || null,
          install_district: form.install_district || null,
          install_city: form.install_city || null,
          system_type: form.system_type || null,
          plant_use_type: form.plant_use_type || null,
          // Applicant docs
          borrower_pan: form.borrower_pan || null,
          borrower_father_name: form.borrower_father_name || null,
          aadhaar_name: form.aadhaar_name || null,
          aadhaar_dob: form.aadhaar_dob || null,
          aadhaar_gender: form.aadhaar_gender || null,
          aadhaar_number: form.aadhaar_number || null,
          aadhaar_care_of: form.aadhaar_care_of || null,
          aadhaar_address: form.aadhaar_address || null,
          aadhaar_front_path: form.aadhaar_front_path || null,
          aadhaar_back_path: form.aadhaar_back_path || null,
          aadhaar_face_path: form.aadhaar_face_path || null,
          borrower_dob: form.borrower_dob || undefined,
          // Applicant PAN file — the route files it as the borrower_pan doc row.
          borrower_pan_path: form.borrower_pan_path || undefined,
          borrower_pan_mime: form.borrower_pan_mime || undefined,
          borrower_pan_file_name: form.borrower_pan_file_name || undefined,
          applicant_earning: yesNo(form.applicant_earning) ?? undefined,
          // E-bill
          ebill_path: form.ebill_path || null,
          monthly_bill_amount: form.monthly_bill_amount || null,
          discom_name: form.discom_name || null,
          ca_number: form.ca_number || null,
          ebill_address_line: form.ebill_address_line || null,
          ebill_name: form.ebill_name || null,
          // Quotation + rooftop
          proforma_invoice_path: form.proforma_invoice_path || null,
          rooftop_photo_path: form.rooftop_photo_path || null,
          // Co-applicant — from the role decision (edit: from what's on file).
          has_coapp: hasCoapp(form),
          coapp_mobile: form.coapp_mobile || null,
          // The submit writes coapp_email — send what's on file so it's never wiped.
          coapp_email: form.coapp_email || null,
          coapp_pan: form.coapp_pan || null,
          coapp_name: form.coapp_name || (hasCoapp(form) ? personName(p2Of(form)) : "") || null,
          coapp_father_name: form.coapp_father_name || undefined,
          coapp_aadhaar_face_path: form.coapp_aadhaar_face_path || undefined,
          coapp_relation: form.coapp_relation || undefined,
          coapp_earning: yesNo(form.coapp_earning) ?? undefined,
          coapp_role_reason: form.coapp_role_reason || undefined,
          coapp_dob: form.coapp_dob || null,
          coapp_pan_path: form.coapp_pan_path || null,
          coapp_aadhaar_name: form.coapp_aadhaar_name || null,
          coapp_aadhaar_dob: form.coapp_aadhaar_dob || null,
          coapp_aadhaar_gender: form.coapp_aadhaar_gender || null,
          coapp_aadhaar_number: form.coapp_aadhaar_number || null,
          coapp_aadhaar_care_of: form.coapp_aadhaar_care_of || null,
          coapp_aadhaar_address: form.coapp_aadhaar_address || null,
          coapp_aadhaar_front_path: form.coapp_aadhaar_front_path || null,
          coapp_aadhaar_back_path: form.coapp_aadhaar_back_path || null,
          // Project + loan
          project_size: form.project_size || null,
          total_project_cost: form.total_project_cost || null,
          loan_amount_required: form.loan_amount_required || null,
          central_subsidy: central,
          selected_tenure_years: tenure || null,
          selected_monthly_emi: tenure ? monthlyEmi : null,
          selected_subsidy_emi: tenure ? subsidyEmi : null,
          // Lead owner (asked just before consent).
          lead_owner_name: form.lead_owner_name || undefined,
          lead_owner_phone: form.lead_owner_phone || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't submit the application."); return; }
      if (form.lead_owner_name) {
        try { localStorage.setItem(leadOwnerKey(), JSON.stringify({ lead_owner_name: form.lead_owner_name, lead_owner_phone: form.lead_owner_phone || "" })); } catch { /* storage unavailable */ }
      }
      setDone({ loanId: form.loan_display_id || null, borrowerName: form.borrower_name || form.aadhaar_name || "your customer", edit: editMode });
    } catch (e) {
      // A network-level failure (server unreachable / dropped connection) throws
      // "Failed to fetch". Show a human message; the consent button stays so the
      // EPC can retry without re-answering anything.
      const raw = (e as Error)?.message || "";
      setError(/failed to fetch|networkerror|load failed/i.test(raw)
        ? "Couldn't reach the server. Check your connection and tap “Yes, the customer consents” again."
        : (raw || "Network error."));
    } finally { setBusy(false); }
  }

  const progress = done ? 100 : Math.round((idx / Math.max(script.length, 1)) * 100);

  // ── Success screen (premium + animated) ─────────────────────────────────────
  if (done) {
    const title = done.edit ? "Application updated" : "Application filed successfully";
    return (
      <div className="relative h-screen grid place-items-center px-5 overflow-hidden" style={{ background: "linear-gradient(160deg,#14235c 0%,#1e3a8a 55%,#2a4bb8 100%)" }}>
        {/* Falling confetti */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {CONFETTI.map((c, i) => (
            <span key={i} className="cc-confetti" style={{ left: c.left, background: c.color, animationDelay: c.delay, animationDuration: c.dur }} />
          ))}
        </div>

        <div className="cc-card relative w-full max-w-[460px] bg-white rounded-[28px] shadow-2xl px-8 py-10 text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <span className="absolute inset-0 rounded-full opacity-25 animate-ping" style={{ background: "#1db877" }} />
            <div className="relative w-20 h-20 rounded-full grid place-items-center shadow-[0_12px_30px_-8px_rgba(23,138,92,0.6)]" style={{ background: "linear-gradient(135deg,#1db877,#0f7a52)" }}>
              <svg className="cc-check" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
          </div>
          <div className="text-[11px] uppercase tracking-[0.22em] font-bold text-[#178a5c]">{title}</div>
          <h1 className="mt-2 font-display text-[27px] font-bold text-[#14235c] leading-tight">{done.borrowerName}</h1>
          {done.loanId && (
            <div className="mt-3 inline-flex items-center gap-1.5 bg-[#eef3fc] text-[#1e3a8a] font-mono text-[13px] font-semibold px-3.5 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1db877]" /> {done.loanId}
            </div>
          )}
          <p className="text-[14px] text-text-mid mt-4 leading-relaxed">
            {done.edit ? "The changes were submitted" : "This application has been successfully created"} by{" "}
            <span className="font-semibold text-[#14235c]">{epcName || "your team"}</span>.<br />
            Our team will reach out to you shortly.
          </p>
          <button onClick={() => router.push("/dashboard")} className="mt-7 w-full px-5 py-3 rounded-xl bg-[#1e3a8a] text-white text-[15px] font-semibold hover:bg-[#17307a] transition-colors">
            Back to dashboard
          </button>
        </div>

        <style jsx>{`
          .cc-card { animation: ccUp .5s cubic-bezier(.2,.8,.2,1) both; }
          @keyframes ccUp { from { opacity: 0; transform: translateY(18px) scale(.97); } to { opacity: 1; transform: none; } }
          .cc-check { stroke-dasharray: 30; stroke-dashoffset: 30; animation: ccDraw .5s .25s ease-out forwards; }
          @keyframes ccDraw { to { stroke-dashoffset: 0; } }
          .cc-confetti { position: absolute; top: -20px; width: 9px; height: 15px; border-radius: 2px; opacity: .9; animation-name: ccFall; animation-timing-function: linear; animation-iteration-count: infinite; }
          @keyframes ccFall { 0% { transform: translateY(-12vh) rotate(0deg); } 100% { transform: translateY(112vh) rotate(560deg); } }
        `}</style>
      </div>
    );
  }

  const showDock = !!turn && !busy;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "linear-gradient(160deg,#f5f8fe 0%,#e9f0fc 100%)" }}>
      {/* Header */}
      <header className="shrink-0 px-4 sm:px-5 py-2.5 bg-[#14235c] text-white flex items-center gap-3 shadow-sm">
        <button onClick={() => router.push("/dashboard")} className="p-1 -ml-1 text-white/80 hover:text-white text-[20px] leading-none" aria-label="Back">←</button>
        <img src="/brand/capital-craft-mark.png" alt="" className="w-9 h-9 rounded-full bg-white object-contain p-1 shadow-sm" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[15px] leading-tight truncate">Capital Craft · {editMode ? "Edit loan application" : "New loan application"}</div>
          <div className="text-[11.5px] text-white/70 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#93b4ff]" /> {editMode ? "updating the application" : "building the application"}</div>
        </div>
        <span className="text-[11px] text-white/60 tabular-nums">{progress}%</span>
        <button onClick={undo} disabled={!undoStack.length || busy || !!done}
          className="w-8 h-8 rounded-full hover:bg-white/10 grid place-items-center text-white/80 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent text-[17px] leading-none"
          aria-label="Undo last step" title="Undo last step">↶</button>
      </header>
      <div className="h-1.5 bg-black/15 shrink-0"><div className="h-1.5 bg-[#5b8def] rounded-r-full transition-all duration-500" style={{ width: progress + "%" }} /></div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4">
        <div className="max-w-xl mx-auto py-4 flex flex-col gap-1.5">
          {msgs.map((m) => (
            <div key={m.id} className={m.from === "bot" ? "self-start max-w-[88%]" : "self-end max-w-[88%]"}>
              <div className={[
                "rounded-2xl px-3.5 py-2 text-[14px] shadow-sm whitespace-pre-wrap break-words",
                m.from === "bot" ? "bg-white rounded-tl-md border border-[#c7d5f0] text-text" : "bg-[#1e3a8a] rounded-tr-md text-white",
              ].join(" ")}>
                {m.text}
                {m.files && m.files.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.files.map((f, i) => f.thumb
                      ? <img key={i} src={f.thumb} alt="" className="w-11 h-11 rounded-lg object-cover border border-white/30" />
                      : <span key={i} className="text-[11px] px-2 py-1 rounded-md bg-white/15">{f.name}</span>)}
                  </div>
                )}
              </div>
              {m.from === "user" && m.turnId && !done && (
                <div className="text-right mt-0.5 pr-1">
                  <button onClick={() => editAnswer(m.turnId!, m.pass, m.value)} disabled={busy} className="text-[11px] text-text-muted hover:text-[#1e3a8a] disabled:opacity-40" title="Edit this answer">✎ Edit</button>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="self-start">
              <div className="rounded-2xl rounded-tl-md bg-white border border-[#c7d5f0] px-4 py-3 shadow-sm flex gap-1">
                <span className="w-2 h-2 rounded-full bg-[#1e3a8a]/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-[#1e3a8a]/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-[#1e3a8a]/40 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          {error && <div className="self-center text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 my-1">{error}</div>}
          <div className="h-2" />
        </div>
      </div>

      {/* Dock */}
      {showDock && turn && (
        <div className="shrink-0 max-h-[75vh] overflow-y-auto bg-white/85 backdrop-blur border-t border-line">
          <div className="max-w-xl mx-auto px-3 sm:px-4 py-3">
            {(turn.kind === "text" || turn.kind === "pincode" || turn.kind === "number") && (() => {
              const send = () => void (turn.kind === "pincode" ? submitPincode() : turn.kind === "number" ? submitNumber() : submitText());
              const amt = turn.field && AMOUNT_FIELDS.has(turn.field) ? Number(input.replace(/[^\d]/g, "")) : 0;
              return (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center border border-line rounded-full bg-white overflow-hidden focus-within:border-[#1e3a8a] focus-within:ring-2 focus-within:ring-[#1e3a8a]/15">
                      <input
                        ref={inputRef} autoFocus value={input}
                        inputMode={turn.kind === "text" ? "text" : "numeric"}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                        placeholder={turn.placeholder || "Type your answer…"}
                        className="flex-1 min-w-0 px-4 py-2.5 text-[14px] bg-transparent focus:outline-none" />
                    </div>
                    <button onClick={send} className="w-11 h-11 shrink-0 rounded-full bg-[#1e3a8a] text-white grid place-items-center hover:bg-[#17307a] shadow-sm" aria-label="Send">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                    </button>
                  </div>
                  {amt > 0 && amountInWords(amt) && (
                    <div className="text-[11.5px] text-[#14235c] px-4">₹{amt.toLocaleString("en-IN")} — <span className="font-medium">{amountInWords(amt)} rupees</span></div>
                  )}
                </div>
              );
            })()}

            {turn.kind === "choice" && (
              <div className="grid sm:grid-cols-2 gap-2">
                {turn.choices!.map((c) => {
                  // In edit mode, highlight + tag the value already on the application.
                  const current = !!turn.field && form[turn.field!] === c.value;
                  return (
                    <button key={c.value || c.label} onClick={() => void choose(c)} className={["text-left px-4 py-3 rounded-xl border bg-white hover:border-[#1e3a8a] hover:bg-[#f4f7fd] transition", current ? "border-[#1e3a8a] bg-[#f4f7fd]" : "border-line"].join(" ")}>
                      <div className="text-[14px] font-semibold text-text flex items-center gap-2">{c.label}{current && <span className="text-[10px] font-semibold text-[#1e3a8a] bg-[#e8effc] rounded-full px-2 py-0.5">Current</span>}</div>{c.sub && <div className="text-[12px] text-text-muted">{c.sub}</div>}
                    </button>
                  );
                })}
              </div>
            )}

            {turn.kind === "consent" && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => void giveConsent()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-[#1e3a8a] text-white text-[14px] font-semibold hover:bg-[#17307a] disabled:opacity-60">Yes, the customer consents</button>
                <button onClick={() => router.push("/dashboard")} className="px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid hover:bg-bg-soft">Cancel</button>
              </div>
            )}

            {turn.kind === "confirm_edit" && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => { pushUser("Yes, edit this application"); advance(); }} className="flex-1 px-4 py-2.5 rounded-xl bg-[#1e3a8a] text-white text-[14px] font-semibold hover:bg-[#17307a]">Yes, edit</button>
                <button onClick={() => router.push("/dashboard")} className="px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid hover:bg-bg-soft">No, go back</button>
              </div>
            )}

            {turn.kind === "edit_picker" && appId && (
              <EditPicker
                appId={appId} form={form} docRows={docRows} preselect={editDocs}
                onPick={(keys) => {
                  const built = buildEditScript(keys);
                  pushUndo();
                  pushUser(`Editing: ${keys.map((k) => PICK_LABEL[k] ?? k).join(", ")}`);
                  setScript(built);
                  setIdx(2); // skip past the intro (confirm + picker) to the first chosen step
                }}
              />
            )}

            {turn.kind === "doc_table" && appId && (
              <DocTable
                key={"applicant-docs-" + idx} appId={appId} form={form} docRows={docRows} rows={rowsOf(turn, form) ?? APPLICANT_ROWS} onPatch={merge} onDone={finishDocTable}
                // The first table (applying) also takes any other documents, and more bills for commercial.
                extras={!editMode && turn.id === "doc_table" ? { bills: form.plant_use_type === "commercial" } : undefined}
              />
            )}

            {turn.kind === "coapp_docs" && appId && (
              <DocTable key={"coapp-docs-" + idx} appId={appId} form={form} docRows={docRows} rows={rowsOf(turn, form) ?? COAPP_ROWS} onPatch={merge} onDone={() => { pushUndo(); advance(); }} />
            )}

            {turn.kind === "doc_review" && appId && (
              <DocTable
                key={"doc-review-" + idx} appId={appId} form={form} docRows={docRows}
                rows={[
                  ...APPLICANT_ROWS,
                  ...(hasCoapp(form) ? COAPP_ROWS : []),
                  QUOTATION_ROW,
                ]}
                review onPatch={merge} onDone={() => { pushUndo(); advance(); }}
              />
            )}

            {turn.kind === "quotation" && appId && (
              <QuotationDock appId={appId} form={form} onPatch={merge} onDone={() => { pushUndo(); advance(); }} />
            )}

            {turn.kind === "tenure" && (
              <LoanConfigDock
                loanAmt={Number(form.loan_amount_required) || 0}
                subsidyCase={subsidyCase} setSubsidyCase={setSubsidyCase}
                centralSub={centralSub} setCentralSub={setCentralSub}
                stateSub={stateSub} setStateSub={setStateSub}
                tenure={tenure} setTenure={setTenure}
                onFinish={() => {
                  const central = subsidyCase === "non_subsidy" ? 0 : (Number(centralSub) || 0);
                  const st = subsidyCase === "non_subsidy" ? 0 : (Number(stateSub) || 0);
                  merge({ selected_tenure_years: String(tenure), central_subsidy: String(central), state_subsidy: String(st) });
                  pushUndo(); advance();
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Document table ────────────────────────────────────────────────────────────
type Slot = "aadhaar_front" | "aadhaar_back" | "pan" | "ebill" | "rooftop" | "selfie" | "bank" | "coapp_aadhaar_front" | "coapp_aadhaar_back" | "coapp_pan" | "quotation";
type Unit = "aadhaar" | "pan" | "ebill" | "rooftop" | "selfie" | "bank" | "coapp_aadhaar" | "coapp_pan" | "quotation";
type Row = { slot: Slot; label: string; unit: Unit; parts: Slot[]; lastOfUnit?: boolean; coappOnly?: boolean; required?: boolean /* no "Don't have it" */ };

const APPLICANT_ROWS: Row[] = [
  { slot: "aadhaar_front", label: "Applicant Aadhaar — front", unit: "aadhaar", parts: ["aadhaar_front", "aadhaar_back"] },
  { slot: "aadhaar_back", label: "Applicant Aadhaar — back", unit: "aadhaar", parts: ["aadhaar_front", "aadhaar_back"], lastOfUnit: true },
  { slot: "pan", label: "Applicant PAN", unit: "pan", parts: ["pan"], lastOfUnit: true },
  { slot: "ebill", label: "Electricity bill", unit: "ebill", parts: ["ebill"], lastOfUnit: true },
  { slot: "rooftop", label: "Rooftop photo", unit: "rooftop", parts: ["rooftop"], lastOfUnit: true },
  { slot: "selfie", label: "Applicant photo", unit: "selfie", parts: ["selfie"], lastOfUnit: true },
  { slot: "bank", label: "Bank statement", unit: "bank", parts: ["bank"], lastOfUnit: true },
];
const COAPP_ROWS: Row[] = [
  { slot: "coapp_aadhaar_front", label: "Co-applicant Aadhaar — front", unit: "coapp_aadhaar", parts: ["coapp_aadhaar_front", "coapp_aadhaar_back"] },
  { slot: "coapp_aadhaar_back", label: "Co-applicant Aadhaar — back", unit: "coapp_aadhaar", parts: ["coapp_aadhaar_front", "coapp_aadhaar_back"], lastOfUnit: true },
  { slot: "coapp_pan", label: "Co-applicant PAN", unit: "coapp_pan", parts: ["coapp_pan"], lastOfUnit: true },
];
// Quotation row — used in the review table so the uploaded quotation / proforma
// is visible (View + Replace) with its read-out project size & cost editable.
const QUOTATION_ROW: Row = { slot: "quotation", label: "Quotation / proforma invoice", unit: "quotation", parts: ["quotation"], lastOfUnit: true };

// Apply-mode tables. The first person's documents carry neutral labels (roles
// aren't known yet); the second person's are labelled for the role they're
// asked for; the photo + bank statement are the final applicant's. The PAN is
// required once the first person turned out to be the bill owner.
function firstRows(f: Form): Row[] {
  const pick = (u: Unit) => APPLICANT_ROWS.filter((r) => r.unit === u);
  return [...pick("ebill"), ...pick("aadhaar"), ...pick("pan"), ...pick("rooftop")]
    .map((r) => ({ ...r, label: r.label.replace("Applicant ", ""), required: r.unit === "aadhaar" || (r.unit === "pan" && f._p1_pan_required === "1") }));
}
function secondRows(f: Form): Row[] {
  const who = f._p2_role !== "owner" ? "Applicant" : nameReadable(f.ebill_name) ? `${billName(f)} (bill owner)` : "Bill owner";
  return COAPP_ROWS.map((r) => ({ ...r, label: r.label.replace("Co-applicant", who), required: true }));
}
function finalRows(f: Form): Row[] {
  const whose = f.borrower_name ? `${f.borrower_name}'s` : "Applicant's";
  return APPLICANT_ROWS.filter((r) => r.unit === "selfie" || r.unit === "bank")
    .map((r) => ({ ...r, label: `${whose} ${r.unit === "selfie" ? "photo" : "bank statement"}` }));
}
const rowsOf = (t: Turn, f: Form) => (typeof t.rows === "function" ? t.rows(f) : t.rows);

// Form keys that mark each unit already read (for prefill/done).
const UNIT_DONE_KEY: Record<Unit, string[]> = {
  aadhaar: ["aadhaar_front_path"], pan: ["borrower_pan_path", "borrower_pan"], ebill: ["ebill_path"],
  rooftop: ["rooftop_photo_path"], selfie: ["customer_photo_path"], bank: ["bank_statement_path"],
  coapp_aadhaar: ["coapp_aadhaar_front_path"], coapp_pan: ["coapp_pan_path"],
  quotation: ["proforma_invoice_path"],
};
// The PAN's read-out name: the name read off the card (it feeds the Aadhaar ≠
// PAN check) until the person's name is on file — set when the roles are
// assigned, or hydrated when editing (roles fixed), so a fix there is submitted.
const panNameField = (f: Form, read: string, onFile: string) => (!(onFile in f) && read in f ? read : onFile);
// Editable read-out fields shown under a unit once read.
const UNIT_FIELDS: Partial<Record<Unit, (f: Form) => { label: string; field: string }[]>> = {
  aadhaar: () => [{ label: "Name", field: "aadhaar_name" }, { label: "DOB", field: "aadhaar_dob" }, { label: "Aadhaar", field: "aadhaar_number" }, { label: "Address", field: "aadhaar_address" }],
  pan: (f) => [{ label: "PAN", field: "borrower_pan" }, { label: "Name", field: panNameField(f, "_pan_name", "borrower_name") }, { label: "Father", field: "borrower_father_name" }],
  ebill: () => [{ label: "Monthly bill (₹)", field: "monthly_bill_amount" }, { label: "DISCOM", field: "discom_name" }, { label: "Bill name", field: "ebill_name" }],
  coapp_aadhaar: () => [{ label: "Name", field: "coapp_aadhaar_name" }, { label: "DOB", field: "coapp_aadhaar_dob" }, { label: "Aadhaar", field: "coapp_aadhaar_number" }],
  coapp_pan: (f) => [{ label: "PAN", field: "coapp_pan" }, { label: "Name", field: panNameField(f, "_coapp_pan_name", "coapp_name") }, { label: "Father", field: "coapp_father_name" }],
  quotation: () => [{ label: "Project size (kW)", field: "project_size" }, { label: "Total project cost (₹)", field: "total_project_cost" }],
};

type SlotFile = { file: File; thumb: string | null };

function DocTable({ appId, form, rows, docRows = [], review = false, extras, onPatch, onDone }: { appId: string; form: Form; rows: Row[]; docRows?: { id: string; category: string; storage_path: string | null }[]; review?: boolean; extras?: { bills: boolean }; onPatch: (p: Form) => void; onDone: (r: { name: string; thumb: string | null }[]) => void }) {
  const [extrasBusy, setExtrasBusy] = useState(false);
  const [files, setFiles] = useState<Partial<Record<Slot, SlotFile>>>({});
  const [skipped, setSkipped] = useState<Partial<Record<Slot, boolean>>>({});
  // Slots the user re-opened via "Replace" — shows the file picker again even
  // though a document is already on file (editing). The existing path is kept
  // until a new file is actually picked, so backing out never wipes a document.
  const [reopened, setReopened] = useState<Partial<Record<Slot, boolean>>>({});
  const [reads, setReads] = useState<Partial<Record<Unit, { status: "reading" | "done" | "error"; error?: string }>>>({});
  const filesRef = useRef<Partial<Record<Slot, SlotFile>>>({});
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });
  // Open the document already on file for a unit (so editors can see what they
  // uploaded before). Path-based docs go via sign-doc; the PAN image is a row,
  // and a PAN read here opens by the signed URL its read returned.
  async function view(path?: string | null, rowId?: string, url?: string) {
    try {
      if (url) { window.open(url, "_blank", "noopener"); return; }
      if (path) {
        const res = await fetch(`/api/admin/loan-app/${appId}/sign-doc`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const j = await res.json().catch(() => ({}));
        if (j?.ok && j.url) { window.open(j.url as string, "_blank", "noopener"); return; }
      }
      if (rowId) { const url = await getDocumentUrl(rowId); if (url) { window.open(url, "_blank", "noopener"); return; } }
      alert("Couldn't open the document.");
    } catch { alert("Couldn't open the document."); }
  }
  const unitTarget = (u: Unit): { path?: string; rowId?: string; url?: string } => {
    switch (u) {
      case "aadhaar":       return { path: form.aadhaar_front_path };
      case "pan":           return { url: form._pan_url, path: form.borrower_pan_path, rowId: docRows.find((d) => d.category === "borrower_pan")?.id };
      case "ebill":         return { path: form.ebill_path };
      case "rooftop":       return { path: form.rooftop_photo_path };
      case "selfie":        return { path: form.customer_photo_path };
      case "bank":          return { path: form.bank_statement_path };
      case "coapp_aadhaar": return { path: form.coapp_aadhaar_front_path };
      case "coapp_pan":     return { url: form._coapp_pan_url, path: form.coapp_pan_path };
      case "quotation":     return { path: form.proforma_invoice_path };
      default:              return {};
    }
  };
  const unitPrefilled = (u: Unit) => UNIT_DONE_KEY[u].some((k) => !!(form[k] && String(form[k]).trim()));
  const unitDone = (u: Unit) => reads[u]?.status === "done" || unitPrefilled(u);
  const rowOpen = (slot: Slot, u: Unit) => !files[slot] && !skipped[slot] && (!!reopened[slot] || !unitPrefilled(u));
  // A row is settled once its read is done (or it was on file, or skipped), and
  // nothing continues while any read is running — the next turns act on it.
  const rowSettled = (r: Row) => !!skipped[r.slot] || (!!files[r.slot] && reads[r.unit]?.status === "done") || unitPrefilled(r.unit);
  const reading = Object.values(reads).some((x) => x?.status === "reading");
  // In review mode every row is already uploaded (or optional), so Continue is
  // always available — the table is for checking/fixing, not forced completion.
  const allSettled = review || (!reading && !extrasBusy && rows.every(rowSettled));

  async function callRoute(unit: Unit, f: Partial<Record<Slot, SlotFile>>): Promise<Form> {
    const fileOf = (s: Slot) => { const x = f[s]?.file; if (!x) throw new Error("File missing — re-attach it."); return x; };
    // Aadhaar (applicant / co-app) — front + back in one extract-aadhaar call.
    if (unit === "aadhaar" || unit === "coapp_aadhaar") {
      const co = unit === "coapp_aadhaar";
      const fd = new FormData();
      fd.append("front", fileOf(co ? "coapp_aadhaar_front" : "aadhaar_front"));
      fd.append("back", fileOf(co ? "coapp_aadhaar_back" : "aadhaar_back"));
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-aadhaar`, { method: "POST", headers: auth(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the Aadhaar.");
      const x = j.fields ?? {}, p = j.storage_paths ?? {};
      // Names (borrower_name / coapp_name) are set when the roles are assigned.
      if (co) return { coapp_aadhaar_name: x.name ?? "", coapp_aadhaar_dob: x.dob ?? "", coapp_aadhaar_gender: x.gender ?? "", coapp_aadhaar_number: x.aadhaar_number ?? "", coapp_aadhaar_care_of: x.care_of ?? "", coapp_aadhaar_address: x.address ?? "", coapp_aadhaar_front_path: p.front ?? "", coapp_aadhaar_back_path: p.back ?? "", coapp_aadhaar_face_path: p.face ?? "" };
      return { aadhaar_name: x.name ?? "", aadhaar_dob: x.dob ?? "", aadhaar_gender: x.gender ?? "", aadhaar_number: x.aadhaar_number ?? "", aadhaar_care_of: x.care_of ?? "", aadhaar_address: x.address ?? "", aadhaar_front_path: p.front ?? "", aadhaar_back_path: p.back ?? "", aadhaar_face_path: p.face ?? "" };
    }
    // PAN (either person) — extract-coapp-pan, read-only (no `applicant=1`, so
    // no doc row yet): who the applicant is isn't final until the roles are
    // decided. The submit files the final applicant's PAN (borrower_pan_path)
    // as the borrower_pan row; the co-applicant's goes in coapp_pan_path.
    if (unit === "pan" || unit === "coapp_pan") {
      const applicant = unit === "pan";
      const file = fileOf(applicant ? "pan" : "coapp_pan");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-coapp-pan`, { method: "POST", headers: auth(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the PAN.");
      const x = j.fields ?? {};
      const mime = file.type.startsWith("image/") ? "image/jpeg" : file.type; // the route stores images as JPEG
      // A PAN with no readable date keeps the date of birth already on file.
      if (applicant) return { borrower_pan: x.pan ?? "", borrower_father_name: x.father_name ?? "", _pan_name: x.name ?? "", ...(x.dob ? { borrower_dob: x.dob } : {}), borrower_pan_path: j.storage_path ?? "", borrower_pan_mime: mime, borrower_pan_file_name: file.name, _pan_url: j.signed_url ?? "" };
      return { coapp_pan: x.pan ?? "", coapp_father_name: x.father_name ?? "", _coapp_pan_name: x.name ?? "", ...(x.dob ? { coapp_dob: x.dob } : {}), coapp_pan_path: j.storage_path ?? "", _coapp_pan_mime: mime, _coapp_pan_file_name: file.name, _coapp_pan_url: j.signed_url ?? "" };
    }
    // E-bill — extract-loan-docs (ebill side).
    if (unit === "ebill") {
      const fd = new FormData();
      fd.append("ebill", fileOf("ebill"));
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-loan-docs`, { method: "POST", headers: auth(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the bill.");
      const e = j.ebill?.fields ?? {}; const path = j.ebill?.storage_path ?? "";
      // The bill's pincode pre-fills the installation pincode question.
      const pin = String(e.pincode ?? "").trim();
      return { ebill_path: path, monthly_bill_amount: e.monthly_bill_amount != null ? String(e.monthly_bill_amount) : "", discom_name: e.discom_name ?? "", ca_number: e.ca_number ?? "", ebill_address_line: e.ebill_address_line ?? "", ebill_name: e.ebill_name ?? "", ...(PIN_RE.test(pin) ? { install_pincode: pin } : {}) };
    }
    // Quotation / proforma — extract-loan-docs (proforma side); reads project
    // size + total cost. Used in the review table's Replace.
    if (unit === "quotation") {
      const fd = new FormData();
      fd.append("proforma", fileOf("quotation"));
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-loan-docs`, { method: "POST", headers: auth(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the quotation.");
      const p = j.proforma?.fields ?? {}; const path = j.proforma?.storage_path ?? "";
      return {
        proforma_invoice_path: path,
        ...(p.total_project_cost != null ? { total_project_cost: String(p.total_project_cost) } : {}),
        ...(p.project_size != null ? { project_size: String(p.project_size) } : {}),
        ...(p.project_size_unit ? { project_size_unit: String(p.project_size_unit) } : {}),
      };
    }
    // Photos + bank statement — upload only (no OCR); replace keeps one row/slot.
    const category = unit === "rooftop" ? "borrower_photo" : unit === "selfie" ? "customer_photo" : "bank_statement";
    const pathField = unit === "rooftop" ? "rooftop_photo_path" : unit === "selfie" ? "customer_photo_path" : "bank_statement_path";
    const fd = new FormData();
    fd.append("file", fileOf(unit as Slot));
    fd.append("table", "user_application_docs");
    fd.append("category", category);
    fd.append("application_id", appId);
    fd.append("uploaded_by", "epc");
    fd.append("replace", "true");
    const res = await fetch("/api/upload", { method: "POST", headers: auth(), body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't upload the file.");
    return { [pathField]: j.storage_path };
  }

  async function run(unit: Unit, f: Partial<Record<Slot, SlotFile>>) {
    setReads((s) => ({ ...s, [unit]: { status: "reading" } }));
    try {
      const patch = await callRoute(unit, f);
      onPatch(patch);
      if (mounted.current) setReads((s) => ({ ...s, [unit]: { status: "done" } }));
    } catch (e) {
      if (mounted.current) setReads((s) => ({ ...s, [unit]: { status: "error", error: e instanceof Error ? e.message : "Couldn't read that." } }));
    }
  }

  function pick(slot: Slot, unit: Unit, file: File) {
    if (!(file.type.startsWith("image/") || file.type.includes("pdf"))) return;
    const thumb = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    const next = { ...filesRef.current, [slot]: { file, thumb } };
    filesRef.current = next; setFiles(next);
    if (skipped[slot]) setSkipped((s) => { const n = { ...s }; delete n[slot]; return n; });
    const parts = rows.find((r) => r.slot === slot)!.parts;
    if (parts.every((p) => next[p])) void run(unit, next);
  }
  function toggleSkip(slot: Slot) {
    const now = !skipped[slot];
    setSkipped((s) => ({ ...s, [slot]: now }));
    if (now) { const n = { ...filesRef.current }; delete n[slot]; filesRef.current = n; setFiles(n); }
  }
  function replace(slot: Slot, unit: Unit) {
    const parts = rows.find((r) => r.slot === slot)!.parts;
    const n = { ...filesRef.current };
    for (const p of parts) delete n[p];
    filesRef.current = n; setFiles(n);
    setReads((s) => { const x = { ...s }; delete x[unit]; return x; });
    // Re-open the picker for every part of this unit (front + back for Aadhaar).
    setReopened((s) => { const x = { ...s }; for (const p of parts) x[p] = true; return x; });
  }
  function done() {
    const receipt = rows.filter((r) => files[r.slot]).map((r) => ({ name: files[r.slot]!.file.name, thumb: files[r.slot]!.thumb }));
    onDone(receipt);
  }

  function cell(r: Row) {
    if (skipped[r.slot]) return <span className="text-[11.5px] text-text-muted italic">skipped</span>;
    if (rowOpen(r.slot, r.unit)) {
      return (
        <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) pick(r.slot, r.unit, f); }}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line hover:border-[#1e3a8a] bg-white px-2.5 py-1.5 cursor-pointer text-[11.5px] font-semibold text-[#1e3a8a]">
          <span className="text-[13px] leading-none">＋</span> Add
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(r.slot, r.unit, f); e.currentTarget.value = ""; }} />
        </label>
      );
    }
    const live = files[r.slot];
    return (
      <span className="inline-flex items-center gap-1.5">
        {live?.thumb ? <img src={live.thumb} alt="" className="w-8 h-8 rounded-md object-cover border border-line" /> : <span className="w-8 h-8 rounded-md bg-[#f4f7fd] border border-[#c7d5f0] grid place-items-center text-[13px]">📄</span>}
        <button onClick={() => replace(r.slot, r.unit)} className="text-[#1e3a8a] text-[11px] font-semibold hover:underline">Replace</button>
      </span>
    );
  }

  function strip(unit: Unit) {
    const rd = reads[unit];
    if (rd?.status === "reading") return <span className="flex items-center gap-2 text-[11.5px] text-text-muted"><span className="w-3.5 h-3.5 rounded-full border-2 border-[#1e3a8a]/30 border-t-[#1e3a8a] animate-spin" /> Reading…</span>;
    if (rd?.status === "error") {
      const canRetry = rows.find((r) => r.unit === unit)!.parts.every((p) => filesRef.current[p]);
      return <span className="flex flex-wrap items-center gap-2 text-[11.5px]"><span className="text-red-600">{rd.error || "Couldn't read that."}</span>{canRetry && <button onClick={() => void run(unit, filesRef.current)} className="text-[#1e3a8a] font-semibold hover:underline">Try again</button>}</span>;
    }
    if (unitDone(unit)) {
      const build = UNIT_FIELDS[unit];
      const tgt = unitTarget(unit);
      const viewLink = (tgt.url || tgt.path || tgt.rowId)
        ? <button onClick={() => void view(tgt.path, tgt.rowId, tgt.url)} className="text-[#1e3a8a] text-[11px] font-semibold hover:underline">View current file</button>
        : null;
      return build
        ? <div className="flex flex-col gap-1.5">{viewLink}<FieldRows fields={build(form).map((x) => ({ ...x, value: form[x.field] || "" }))} onEdit={(field, value) => onPatch({ [field]: value })} /></div>
        : <span className="flex items-center gap-2 text-[11.5px] text-[#1e3a8a] font-medium">Uploaded ✓{viewLink && <>· {viewLink}</>}</span>;
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#eef3fc] border-b border-[#dbe4f6] text-[11px] font-semibold text-[#14235c]">
              <th className="text-left font-semibold px-3 py-2 w-full">Document</th>
              <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">Upload</th>
              <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Don&apos;t have it</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const s = r.lastOfUnit ? strip(r.unit) : null;
              return (
                <Fragment key={r.slot}>
                  <tr className={i > 0 ? "border-t border-line/70" : ""}>
                    <td className="px-3 py-2 align-middle text-[12.5px] text-text leading-snug">{r.label}</td>
                    <td className="px-2 py-2 align-middle whitespace-nowrap">{cell(r)}</td>
                    <td className="px-3 py-2 align-middle text-right">{!r.required && <input type="checkbox" checked={!!skipped[r.slot]} onChange={() => toggleSkip(r.slot)} className="w-4 h-4 accent-[#1e3a8a] cursor-pointer align-middle" aria-label={`Don't have ${r.label}`} />}</td>
                  </tr>
                  {s && <tr><td colSpan={3} className="px-3 pb-2.5 pt-0">{s}</td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {extras && <ExtraDocs appId={appId} form={form} bills={extras.bills} onPatch={onPatch} onBusy={setExtrasBusy} />}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={done} disabled={!allSettled} className="px-4 py-2 rounded-lg bg-[#1e3a8a] text-white text-[13px] font-semibold hover:bg-[#17307a] disabled:opacity-50">Continue →</button>
        {!allSettled && <span className="text-[11px] text-text-muted">Add or tick “Don&apos;t have it” for every row to continue.</span>}
      </div>
    </div>
  );
}

// ── Extra documents (first table) ────────────────────────────────────────────
// Any number of other documents — each named by the AI reader from what it is
// ("ITR 2024-25"), else its file name — and, for a commercial customer, more
// electricity bills (the first bill in the table stays the one that's read).
// Each file uploads on pick as its own user_application_docs row (other /
// electricity_bill). The lists live in the form (`_extra_docs` / `_extra_bills`,
// never submitted) so they're still shown on coming back to this table.
type ExtraDoc = { id: string; name: string };
type ExtraKey = "_extra_docs" | "_extra_bills";
const extraList = (f: Form, key: ExtraKey): ExtraDoc[] => { try { return JSON.parse(f[key] || "[]") as ExtraDoc[]; } catch { return []; } };

function ExtraDocs({ appId, form, bills, onPatch, onBusy }: { appId: string; form: Form; bills: boolean; onPatch: (p: Form) => void; onBusy: (busy: boolean) => void }) {
  const [lists, setLists] = useState<Record<ExtraKey, ExtraDoc[]>>(() => ({ _extra_docs: extraList(form, "_extra_docs"), _extra_bills: extraList(form, "_extra_bills") }));
  const [pending, setPending] = useState<{ key: string; list: ExtraKey; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    onPatch({ _extra_docs: JSON.stringify(lists._extra_docs), _extra_bills: JSON.stringify(lists._extra_bills) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists]);
  useEffect(() => { onBusy(pending.length > 0); }, [pending.length, onBusy]);

  async function upload(list: ExtraKey, file: File) {
    const key = uidGen();
    setPending((p) => [...p, { key, list, name: file.name }]);
    try {
      const named = list === "_extra_docs" ? await nameDocument(file) : null;
      const ext = /\.[^.]+$/.exec(file.name)?.[0] ?? "";
      const fd = new FormData();
      fd.append("file", named ? new File([file], `${named}${ext}`, { type: file.type }) : file);
      fd.append("table", "user_application_docs");
      fd.append("category", list === "_extra_bills" ? "electricity_bill" : "other");
      fd.append("application_id", appId);
      fd.append("uploaded_by", "epc");
      const res = await fetch("/api/upload", { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok || !j.id) { setError(j?.error || `Couldn't upload ${file.name}.`); return; }
      const doc = { id: String(j.id), name: named ?? file.name.replace(/\.[^.]+$/, "") };
      setLists((l) => ({ ...l, [list]: [...l[list], doc] }));
    } catch {
      setError(`Couldn't upload ${file.name}.`);
    } finally {
      setPending((p) => p.filter((x) => x.key !== key));
    }
  }
  function add(list: ExtraKey, files: FileList | null) {
    setError(null);
    for (const f of Array.from(files ?? [])) {
      if (f.type.startsWith("image/") || f.type.includes("pdf")) void upload(list, f);
    }
  }
  async function remove(list: ExtraKey, d: ExtraDoc) {
    if (!window.confirm(`Delete "${d.name}"? This can't be undone.`)) return;
    if (!(await deleteDocument(d.id))) { setError(`Couldn't delete ${d.name}.`); return; }
    setLists((l) => ({ ...l, [list]: l[list].filter((x) => x.id !== d.id) }));
  }

  const block = (list: ExtraKey, title: string, label: (d: ExtraDoc, i: number) => string, top: boolean) => {
    const waiting = pending.filter((p) => p.list === list);
    return (
      <div className={top ? "" : "border-t border-line/70"}>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-[12.5px] text-text leading-snug">{title}</span>
          <label className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line hover:border-[#1e3a8a] bg-white px-2.5 py-1.5 cursor-pointer text-[11.5px] font-semibold text-[#1e3a8a] whitespace-nowrap">
            <span className="text-[13px] leading-none">＋</span> Add
            <input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => { add(list, e.target.files); e.currentTarget.value = ""; }} />
          </label>
        </div>
        {(lists[list].length > 0 || waiting.length > 0) && (
          <ul className="px-3 pb-2.5 flex flex-col gap-1.5">
            {lists[list].map((d, i) => (
              <li key={d.id} className="flex items-center gap-2 text-[12px] text-text min-w-0">
                <span className="w-6 h-6 rounded-md bg-[#f4f7fd] border border-[#c7d5f0] grid place-items-center text-[11px] shrink-0">📄</span>
                <span className="truncate flex-1">{label(d, i)}</span>
                <button onClick={() => void remove(list, d)} aria-label={`Delete ${label(d, i)}`} className="text-[#9aa5a0] hover:text-red-600 text-[13px] leading-none px-1">✕</button>
              </li>
            ))}
            {waiting.map((p) => (
              <li key={p.key} className="flex items-center gap-2 text-[11.5px] text-text-muted min-w-0">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-[#1e3a8a]/30 border-t-[#1e3a8a] animate-spin shrink-0" />
                <span className="truncate">{p.name} · {list === "_extra_docs" ? "Reading…" : "Uploading…"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        {bills && block("_extra_bills", "More electricity bills", (_d, i) => `Electricity bill ${i + 2}`, true)}
        {block("_extra_docs", "Other documents", (d) => d.name, !bills)}
      </div>
      {error && <span className="text-[11.5px] text-red-600">{error}</span>}
    </div>
  );
}

// ── Edit picker ──────────────────────────────────────────────────────────────
// The multi-select "what do you want to change?" table shown in edit mode.
// Each row shows the current value (or On file · View for documents); ticked
// rows become the edit script. Documents already on file get a View button.
function EditPicker({ appId, form, docRows, preselect = [], onPick }: {
  appId: string; form: Form;
  docRows: { id: string; category: string; storage_path: string | null }[];
  preselect?: string[];
  onPick: (keys: string[]) => void;
}) {
  const [sel, setSel] = useState<string[]>(() => [...preselect]);
  return (
    <div className="flex flex-col gap-2">
      <EditTable appId={appId} form={form} docRows={docRows} value={sel} onChange={setSel} />
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => sel.length > 0 && onPick(sel)} disabled={sel.length === 0} className="px-4 py-2 rounded-lg bg-[#1e3a8a] text-white text-[13px] font-semibold hover:bg-[#17307a] disabled:opacity-50">
          Edit selected{sel.length ? ` (${sel.length})` : ""} →
        </button>
        {sel.length === 0 && <span className="text-[11px] text-text-muted">Tick the fields or documents you want to change.</span>}
      </div>
    </div>
  );
}

// Inline editable read-out rows.
function FieldRows({ fields, onEdit }: { fields: { label: string; field: string; value: string }[]; onEdit: (field: string, value: string) => void }) {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [val, setVal] = useState("");
  return (
    <div className="flex flex-col gap-1.5">
      {fields.map((f) => (
        <div key={f.field} className="flex items-center justify-between gap-3 text-[12.5px] min-h-[22px]">
          <span className="text-text-muted shrink-0">{f.label}</span>
          {editKey === f.field ? (
            <span className="flex items-center gap-1.5">
              <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onEdit(f.field, val.trim()); setEditKey(null); } if (e.key === "Escape") setEditKey(null); }} className="border border-[#1e3a8a] rounded-lg px-2.5 py-1 text-[12.5px] w-40 text-right outline-none" />
              <button onClick={() => { onEdit(f.field, val.trim()); setEditKey(null); }} className="text-[#1e3a8a] text-[11.5px] font-semibold">Save</button>
            </span>
          ) : (
            <span className="flex items-center gap-2 min-w-0">
              {f.value ? <span className="text-text font-medium text-right break-words">{f.value}</span> : <span className="text-amber-600 text-[11.5px] italic">not found</span>}
              <button onClick={() => { setEditKey(f.field); setVal(f.value); }} className="opacity-60 hover:opacity-100 text-[#1e3a8a] text-[11px] hover:underline shrink-0" aria-label="Edit">✎</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Quotation ──────────────────────────────────────────────────────────────
function QuotationDock({ appId, form, onPatch, onDone }: { appId: string; form: Form; onPatch: (p: Form) => void; onDone: () => void }) {
  const [status, setStatus] = useState<"idle" | "reading" | "done" | "error">(form.proforma_invoice_path ? "done" : "idle");
  const [err, setErr] = useState<string | null>(null);
  const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });

  async function read(file: File) {
    if (!(file.type.startsWith("image/") || file.type.includes("pdf"))) return;
    setStatus("reading"); setErr(null);
    try {
      const fd = new FormData();
      fd.append("proforma", file);
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-loan-docs`, { method: "POST", headers: auth(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the quotation.");
      const p = j.proforma?.fields ?? {}; const path = j.proforma?.storage_path ?? "";
      onPatch({
        proforma_invoice_path: path,
        ...(p.total_project_cost != null ? { total_project_cost: String(p.total_project_cost) } : {}),
        ...(p.project_size != null ? { project_size: String(p.project_size) } : {}),
        ...(p.project_size_unit ? { project_size_unit: String(p.project_size_unit) } : {}),
      });
      setStatus("done");
    } catch (e) {
      setStatus("error"); setErr(e instanceof Error ? e.message : "Couldn't read the quotation.");
    }
  }

  const canContinue = (Number(form.project_size) || 0) > 0 && (Number(form.total_project_cost) || 0) > 0;

  return (
    <div className="flex flex-col gap-2.5">
      <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void read(f); }}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#1e3a8a] bg-[#f4f7fd] px-4 py-3 cursor-pointer text-[13px] font-semibold text-[#1e3a8a] hover:bg-[#eef3fc]">
        {status === "reading" ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-[#1e3a8a]/30 border-t-[#1e3a8a] animate-spin" /> Reading…</> : <>＋ {status === "done" ? "Re-upload quotation" : "Upload quotation / proforma"}</>}
        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.currentTarget.value = ""; }} />
      </label>
      {err && <div className="text-[11.5px] text-red-600">{err}</div>}
      <div className="rounded-xl border border-line bg-white p-3">
        <FieldRows
          fields={[
            { label: "Project size (kW)", field: "project_size", value: form.project_size || "" },
            { label: "Total project cost (₹)", field: "total_project_cost", value: form.total_project_cost || "" },
          ]}
          onEdit={(field, value) => onPatch({ [field]: value.replace(/[^\d.]/g, "") })}
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onDone} disabled={!canContinue} className="px-4 py-2 rounded-lg bg-[#1e3a8a] text-white text-[13px] font-semibold hover:bg-[#17307a] disabled:opacity-50">Continue →</button>
        {!canContinue && <span className="text-[11px] text-text-muted">Add the project size and cost to continue.</span>}
      </div>
    </div>
  );
}

// ── Tenure + submit ────────────────────────────────────────────────────────
// Loan configuration — subsidy case + central/state subsidy + tenure with a
// live EMI, mirroring the team chatbot's last step.
function LoanConfigDock({ loanAmt, subsidyCase, setSubsidyCase, centralSub, setCentralSub, stateSub, setStateSub, tenure, setTenure, onFinish }: {
  loanAmt: number; subsidyCase: "subsidy" | "non_subsidy"; setSubsidyCase: (s: "subsidy" | "non_subsidy") => void;
  centralSub: string; setCentralSub: (s: string) => void; stateSub: string; setStateSub: (s: string) => void;
  tenure: number | null; setTenure: (n: number) => void; onFinish: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 max-h-[56vh] overflow-y-auto pr-0.5">
      <div>
        <div className="text-[12px] text-text-muted mb-1">Subsidy</div>
        <div className="flex gap-2">
          {(["subsidy", "non_subsidy"] as const).map((s) => (
            <button key={s} onClick={() => setSubsidyCase(s)} className={["px-3.5 py-1.5 rounded-lg text-[13px] font-semibold border", subsidyCase === s ? "bg-[#1e3a8a] text-white border-[#1e3a8a]" : "bg-white border-line text-text-mid hover:border-[#1e3a8a]"].join(" ")}>{s === "subsidy" ? "With subsidy" : "No subsidy"}</button>
          ))}
        </div>
      </div>
      {subsidyCase === "subsidy" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[12px] text-text-muted">Central subsidy (₹)
            <input value={centralSub} inputMode="numeric" onChange={(e) => setCentralSub(e.target.value.replace(/[^\d]/g, ""))} className="mt-1 w-full border border-line rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-[#1e3a8a]" /></label>
          <label className="text-[12px] text-text-muted">State subsidy (₹)
            <input value={stateSub} inputMode="numeric" onChange={(e) => setStateSub(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className="mt-1 w-full border border-line rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-[#1e3a8a]" /></label>
        </div>
      )}
      <div>
        <div className="text-[12px] text-text-muted mb-1">Tenure — live EMI on ₹{loanAmt.toLocaleString("en-IN")}</div>
        <div className="grid grid-cols-5 gap-1.5">
          {TENURES.map((t) => (
            <button key={t} onClick={() => setTenure(t)} className={["px-1 py-2 rounded-lg text-center border transition", tenure === t ? "bg-[#1e3a8a] text-white border-[#1e3a8a]" : "bg-white border-line text-text-mid hover:border-[#1e3a8a]"].join(" ")}>
              <div className="text-[13px] font-bold">{t}y</div>
              <div className="text-[10px] opacity-80">{loanAmt > 0 ? formatRupees(computeEmi(loanAmt, DEFAULT_INDICATIVE_ROI, t)) : "—"}</div>
            </button>
          ))}
        </div>
      </div>
      <button onClick={onFinish} disabled={tenure == null} className="mt-1 px-4 py-2.5 rounded-xl bg-[#1e3a8a] text-white text-[14px] font-semibold hover:bg-[#17307a] disabled:opacity-50">Continue →</button>
    </div>
  );
}
