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
// Flow: greeting → mobile (creates the draft) → applicant document TABLE (incl.
// bank statement) → co-applicant TABLE only when the Aadhaar/PAN/e-bill names
// differ (+ co-applicant mobile) → quotation → the few details not on any
// document (email, pincode, system type, use) → loan amount → tenure → consent
// → success. All uploads/OCR run against the EPC's own token; RLS scopes writes.

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { getToken } from "@/lib/auth";
import { fetchEpcName } from "@/lib/epc-name";
import { supabase } from "@/lib/supabase";
import { getDocumentUrl } from "@/lib/storage";
import { computeCentralSubsidy, computeEmi, DEFAULT_INDICATIVE_ROI, TENURES, formatRupees } from "@/lib/emi";

const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^[1-9]\d{5}$/;

type Form = Record<string, string>;
type Msg = { id: string; _id?: string; from: "bot" | "user"; text?: string; time: string; files?: { name: string; thumb: string | null }[]; turnId?: string };
type Choice = { value: string; label: string; sub?: string };
type Turn = {
  id: string;
  bot: string;
  kind: "text" | "pincode" | "choice" | "consent" | "doc_table" | "coapp_docs" | "quotation" | "number" | "tenure" | "confirm_edit" | "edit_picker";
  field?: string;
  rows?: Row[]; // edit mode: limits a doc_table / coapp_docs to only the selected documents
  placeholder?: string;
  choices?: Choice[];
  validate?: (v: string) => string | null;
  when?: (f: Form) => boolean; // conditional turn — skipped when this returns false
};

// Tokenize a name for fuzzy comparison: drop honorifics + relationship prefixes,
// keep only real name words (≥3 letters) so minor OCR differences (case,
// spacing, an extra middle name, initials) don't look like a different person.
function nameTokens(s: string | undefined): string[] {
  return (s || "").toLowerCase()
    .replace(/\b(m\/s|mr|mrs|ms|smt|shri|sri|km|kumari|dr|late|s\/o|d\/o|w\/o|c\/o|h\/o)\.?\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/).filter((t) => t.length >= 3);
}
// Two names are the SAME person/family when they share any real name word.
function namesLikelySame(a: string | undefined, b: string | undefined): boolean {
  const ta = new Set(nameTokens(a)); const tb = nameTokens(b);
  if (ta.size === 0 || tb.length === 0) return true; // unreadable → don't force a co-applicant
  return tb.some((t) => ta.has(t));
}
// A co-applicant is needed ONLY when a document name is clearly different from
// another (shares no name word) — e.g. the e-bill in a parent's/spouse's name.
// Minor OCR variations on the SAME name never trigger it.
function coappNeeded(f: Form): boolean {
  const nm = [f.aadhaar_name, f._pan_name, f.ebill_name].filter((n) => (n || "").trim().length >= 3);
  for (let i = 0; i < nm.length; i++)
    for (let j = i + 1; j < nm.length; j++)
      if (!namesLikelySame(nm[i], nm[j])) return true;
  return false;
}

// Docs-first flow: the mobile creates the draft, then documents + quotation are
// collected up front (name/PAN/Aadhaar/bill/project details are read from them),
// then only the things NOT on any document are asked, and consent is last.
const SCRIPT: Turn[] = [
  { id: "borrower_mobile", bot: "Applicant's 10-digit mobile number?", kind: "text", field: "borrower_mobile", placeholder: "10-digit mobile", validate: (v) => (MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile number.") },
  { id: "doc_table", bot: "Please upload the applicant's documents below.", kind: "doc_table" },
  { id: "coapp_docs", bot: "Please add the co-applicant's Aadhaar and PAN.", kind: "coapp_docs", when: coappNeeded },
  { id: "coapp_mobile", bot: "Co-applicant's 10-digit mobile number?", kind: "text", field: "coapp_mobile", placeholder: "10-digit mobile", when: coappNeeded, validate: (v) => (MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile number.") },
  { id: "quotation", bot: "Please upload the quotation / proforma invoice.", kind: "quotation" },
  { id: "borrower_email", bot: "Applicant's email address?", kind: "text", field: "borrower_email", placeholder: "username" },
  { id: "install_pincode", bot: "Installation pincode?", kind: "pincode", field: "install_pincode", placeholder: "6-digit pincode" },
  { id: "system_type", bot: "Type of solar system?", kind: "choice", field: "system_type", choices: [
    { value: "on_grid", label: "On-Grid", sub: "Connected to the grid" },
    { value: "off_grid", label: "Off-Grid", sub: "Battery / standalone" },
    { value: "hybrid", label: "Hybrid", sub: "Grid + battery" },
  ] },
  { id: "plant_use_type", bot: "Residential or commercial use?", kind: "choice", field: "plant_use_type", choices: [
    { value: "residential", label: "Residential", sub: "Home / society" },
    { value: "commercial", label: "Commercial", sub: "Shop / office / factory" },
  ] },
  { id: "loan_amount", bot: "Loan amount required?", kind: "number", field: "loan_amount_required", placeholder: "Amount in ₹" },
  { id: "tenure", bot: "Finally, the loan configuration — subsidy and tenure.", kind: "tenure" },
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
};
const SYS_LABEL: Record<string, string> = { on_grid: "On-Grid", off_grid: "Off-Grid", hybrid: "Hybrid" };
const USE_LABEL: Record<string, string> = { residential: "Residential", commercial: "Commercial" };

// Fields whose typed amount is echoed in Indian words under the input.
const AMOUNT_FIELDS = new Set(["loan_amount_required"]);
// Integer → Indian words (lakh / crore). Empty for non-positive / invalid.
function amountInWords(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  n = Math.floor(n);
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x: number): string => { const h = Math.floor(x / 100), r = x % 100; return (h ? a[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : ""); };
  let res = "";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) res += three(crore) + " Crore ";
  if (lakh) res += two(lakh) + " Lakh ";
  if (thousand) res += two(thousand) + " Thousand ";
  if (n) res += three(n);
  return res.trim();
}

const uidGen = () => "m" + Math.random().toString(36).slice(2, 9);
const nowLabel = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

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
  const [done, setDone] = useState<{ loanId: string | null } | null>(null);
  // Edit mode: the active script is stateful (apply = SCRIPT; edit = intro then a
  // dynamically-built subset). `ready` gates the first question until the mount
  // effect has decided the mode (and hydrated an existing application for edit).
  const [script, setScript] = useState<Turn[]>(SCRIPT);
  const [editMode, setEditMode] = useState(false);
  const [ready, setReady] = useState(false);
  const [docRows, setDocRows] = useState<{ id: string; category: string; storage_path: string | null }[]>([]);
  const [undoStack, setUndoStack] = useState<{ msgs: Msg[]; form: Form; idx: number }[]>([]);
  // Loan-config step (subsidy + tenure), mirroring the team chatbot's last step.
  const [subsidyCase, setSubsidyCase] = useState<"subsidy" | "non_subsidy">("subsidy");
  const [centralSub, setCentralSub] = useState("");
  const [stateSub, setStateSub] = useState("");
  const [tenure, setTenure] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const turn = script[idx] ?? null;

  const pushBot = (text: string, id?: string) =>
    setMsgs((m) => (id && m.some((x) => x.from === "bot" && x._id === id) ? m : [...m, { id: uidGen(), _id: id, from: "bot", text, time: nowLabel() }]));
  const pushUser = (text: string, files?: Msg["files"], turnId?: string) =>
    setMsgs((m) => [...m, { id: uidGen(), from: "user", text, time: nowLabel(), files, turnId }]);
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
        setScript(EDIT_INTRO);
        await hydrate(qid);
      }
      const epcName = await fetchEpcName();
      const name = epcName && epcName !== "there" ? ` ${epcName}` : "";
      pushBot(`नमस्ते${name}! 🙏`, "g1");
      setTimeout(() => pushBot(
        editing
          ? "Let's update this application. I'll only ask about what you choose to change — everything else stays as it is."
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
    const t = setTimeout(() => pushBot(turn.bot, turn.id), idx === 0 ? 800 : 300);
    setError(null);
    // Pre-fill the box: an explicit edit-jump value wins; otherwise, when editing,
    // seed from the value already on the application (email loses its @gmail.com).
    let pre = prefillRef.current; prefillRef.current = "";
    if (!pre && turn.field && form[turn.field] && (turn.kind === "text" || turn.kind === "pincode" || turn.kind === "number")) {
      pre = turn.id === "borrower_email" ? String(form[turn.field]).replace(/@gmail\.com$/i, "") : String(form[turn.field]);
    }
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
  const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });

  // ── Edit mode: hydrate an existing application into the form ────────────────
  // Loads every persisted field + which documents are on file, so re-asked
  // questions come pre-filled and the picker can show current values + View.
  async function hydrate(id: string) {
    try {
      const [{ data: la }, { data: docs }] = await Promise.all([
        supabase().from("epc_applications").select("*").eq("id", id).maybeSingle(),
        supabase().from("user_application_docs").select("id, category, storage_path").eq("application_id", id),
      ]);
      const a = (la ?? {}) as Record<string, any>;
      const p: Form = {};
      const S = (k: string, v: any) => { if (v != null && String(v).trim() !== "") p[k] = String(v); };
      S("borrower_mobile", a.borrower_mobile); S("borrower_name", a.borrower_name); S("borrower_email", a.borrower_email);
      S("borrower_pan", a.borrower_pan); S("borrower_father_name", a.borrower_father_name);
      S("aadhaar_name", a.aadhaar_name); S("aadhaar_dob", a.aadhaar_dob); S("aadhaar_gender", a.aadhaar_gender);
      S("aadhaar_number", String(a.aadhaar_number ?? "").replace(/\D/g, "")); S("aadhaar_care_of", a.aadhaar_care_of); S("aadhaar_address", a.aadhaar_address);
      S("aadhaar_front_path", a.aadhaar_front_path); S("aadhaar_back_path", a.aadhaar_back_path); S("aadhaar_face_path", a.aadhaar_face_path);
      S("ebill_path", a.ebill_path); S("monthly_bill_amount", a.monthly_bill_amount); S("discom_name", a.discom_name);
      S("ca_number", a.ca_number); S("ebill_address_line", a.ebill_address_line); S("ebill_name", a.ebill_name);
      S("proforma_invoice_path", a.proforma_invoice_path); S("rooftop_photo_path", a.rooftop_photo_path);
      S("install_pincode", a.install_pincode); S("install_state", a.install_state); S("install_district", a.install_district); S("install_city", a.install_city);
      S("system_type", a.system_type); S("plant_use_type", a.plant_use_type);
      S("project_size", a.project_size); S("project_size_unit", a.project_size_unit); S("total_project_cost", a.total_project_cost); S("loan_amount_required", a.loan_amount_required);
      S("central_subsidy", a.central_subsidy); S("state_subsidy", a.state_subsidy); S("selected_tenure_years", a.selected_tenure_years);
      S("loan_display_id", a.loan_display_id);
      // Co-applicant
      S("coapp_mobile", a.coapp_mobile); S("coapp_email", a.coapp_email); S("coapp_pan", a.coapp_pan); S("coapp_pan_path", a.coapp_pan_path);
      S("coapp_name", a.coapp_name); S("coapp_dob", a.coapp_dob);
      S("coapp_aadhaar_name", a.coapp_aadhaar_name); S("coapp_aadhaar_dob", a.coapp_aadhaar_dob); S("coapp_aadhaar_gender", a.coapp_aadhaar_gender);
      S("coapp_aadhaar_number", String(a.coapp_aadhaar_number ?? "").replace(/\D/g, "")); S("coapp_aadhaar_care_of", a.coapp_aadhaar_care_of); S("coapp_aadhaar_address", a.coapp_aadhaar_address);
      S("coapp_aadhaar_front_path", a.coapp_aadhaar_front_path); S("coapp_aadhaar_back_path", a.coapp_aadhaar_back_path);
      // Photo + bank statement live in user_application_docs (not columns) — mark
      // them on-file from their rows so the picker/doc-table know they exist.
      const rows = ((docs ?? []) as { id: string; category: string; storage_path: string | null }[]);
      const byCat = (c: string) => rows.find((d) => d.category === c);
      const selfie = byCat("customer_photo"); if (selfie?.storage_path) S("customer_photo_path", selfie.storage_path);
      const bank = byCat("bank_statement"); if (bank?.storage_path) S("bank_statement_path", bank.storage_path);
      setDocRows(rows);
      setForm((f) => ({ ...f, ...p }));
    } catch { /* leave the form empty; the picker still lets them re-add docs */ }
  }

  // A when-stripped clone of a SCRIPT turn (edit mode always asks a chosen turn).
  const cloneTurn = (id: string): Turn => { const t = SCRIPT.find((x) => x.id === id)!; return { ...t, when: undefined }; };
  // Build the edit script from the ticked picker keys: intro → selected docs →
  // co-applicant → quotation → details → loan → consent.
  function buildEditScript(keys: string[]): Turn[] {
    const has = (k: string) => keys.includes(k);
    const turns: Turn[] = [...EDIT_INTRO];
    const appUnits = (["aadhaar", "pan", "ebill", "rooftop", "selfie", "bank"] as Unit[]).filter((u) => has(u));
    if (appUnits.length) turns.push({ id: "doc_table", bot: "Re-upload the selected document(s) — details are read again automatically.", kind: "doc_table", rows: APPLICANT_ROWS.filter((r) => appUnits.includes(r.unit)) });
    const coUnits = (["coapp_aadhaar", "coapp_pan"] as Unit[]).filter((u) => has(u));
    if (coUnits.length) turns.push({ id: "coapp_docs", bot: "Re-upload the co-applicant document(s).", kind: "coapp_docs", rows: COAPP_ROWS.filter((r) => coUnits.includes(r.unit)) });
    if (has("coapp_mobile")) turns.push(cloneTurn("coapp_mobile"));
    if (has("quotation")) turns.push(cloneTurn("quotation"));
    if (has("borrower_email")) turns.push(cloneTurn("borrower_email"));
    if (has("install_pincode")) turns.push(cloneTurn("install_pincode"));
    if (has("system_type")) turns.push(cloneTurn("system_type"));
    if (has("plant_use_type")) turns.push(cloneTurn("plant_use_type"));
    if (has("loan_amount")) turns.push(cloneTurn("loan_amount"));
    if (has("loan_config")) turns.push(cloneTurn("tenure"));
    turns.push(cloneTurn("consent"));
    return turns;
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
    // Email: the box collects only the part before @gmail.com (unless the RM
    // typed a full address with its own domain).
    if (turn.id === "borrower_email") {
      v = v.includes("@") ? v : `${v}@gmail.com`;
      if (!EMAIL_RE.test(v)) { setError("Enter a valid email address."); return; }
    } else if (turn.validate) {
      const e = turn.validate(v); if (e) { setError(e); return; }
    }
    if (turn.id === "coapp_mobile" && v === form.borrower_mobile) { setError("Co-applicant mobile can't be the same as the applicant's."); return; }
    const next = turn.field ? { ...form, [turn.field]: v } : form;
    // The mobile creates the draft (once) before the document step.
    if (turn.id === "borrower_mobile" && !appId) {
      const ok = await register(next);
      if (!ok) return; // stay on the mobile turn; error shown, input kept
    }
    pushUndo();
    pushUser(v, undefined, turn.id);
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
    pushUser(`₹${n.toLocaleString("en-IN")}`, undefined, turn.id);
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
      pushUser(pin, undefined, turn.id);
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
    merge({ [turn.field]: c.value });
    advance();
  }

  // Edit an earlier answer: jump back to that step (prefilled) via the undo
  // stack. Steps after it are re-asked (their answers may depend on this one).
  function editAnswer(turnId: string) {
    const ti = script.findIndex((t) => t.id === turnId);
    if (ti < 0) return;
    setUndoStack((s) => {
      const i = s.findIndex((snap) => snap.idx === ti);
      if (i < 0) return s;
      const snap = s[i];
      const f = script[ti].field;
      // Prefill the box with the current value (email → the part before @gmail.com).
      if (f && (script[ti].kind === "text" || script[ti].kind === "pincode" || script[ti].kind === "number")) {
        let cur = form[f] || "";
        if (turnId === "borrower_email") cur = cur.replace(/@gmail\.com$/i, "");
        prefillRef.current = cur;
      }
      setMsgs(snap.msgs); setForm(snap.form); setIdx(snap.idx);
      setError(null);
      return s.slice(0, i);
    });
  }

  async function giveConsent() {
    pushUser("Yes, the customer consents.");
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
          // Consent (collected at the very end) + the non-document details.
          consented: true,
          borrower_name: form.borrower_name || null,
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
          // Co-applicant — inferred from whether co-applicant docs were added.
          has_coapp: !!(form.coapp_pan || form.coapp_aadhaar_number || form.coapp_pan_path || form.coapp_aadhaar_front_path),
          coapp_mobile: form.coapp_mobile || null,
          coapp_pan: form.coapp_pan || null,
          coapp_name: form.coapp_name || null,
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
          selected_tenure_years: tenure,
          selected_monthly_emi: monthlyEmi,
          selected_subsidy_emi: subsidyEmi,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't submit the application."); return; }
      setDone({ loanId: form.loan_display_id || null });
    } catch (e) {
      setError((e as Error)?.message || "Network error.");
    } finally { setBusy(false); }
  }

  const progress = done ? 100 : Math.round((idx / Math.max(script.length, 1)) * 100);

  // ── Success screen ─────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="h-screen grid place-items-center px-5" style={{ background: "linear-gradient(135deg,#e9f4ee 0%,#d6e9df 55%,#cbe3d7 100%)" }}>
        <div className="w-full max-w-[440px] bg-white rounded-3xl shadow-2xl px-7 py-9 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#e8effc] grid place-items-center mb-5">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#1e3a8a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h1 className="font-display text-[23px] font-bold text-[#14235c]">Application filed successfully</h1>
          {done.loanId && <div className="mt-1 text-[12px] font-mono text-[#185fa5]">{done.loanId}</div>}
          <p className="text-[14px] text-text-mid mt-3 leading-relaxed">
            Our team will reach out to you shortly.
          </p>
          <button onClick={() => router.push("/dashboard")} className="mt-7 w-full px-5 py-3 rounded-xl bg-[#1e3a8a] text-white text-[15px] font-semibold hover:bg-[#17307a] transition-colors">
            Back to dashboard
          </button>
        </div>
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
                  <button onClick={() => editAnswer(m.turnId!)} disabled={busy} className="text-[11px] text-text-muted hover:text-[#1e3a8a] disabled:opacity-40" title="Edit this answer">✎ Edit</button>
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
                      {turn.id === "borrower_email" && !input.includes("@") && (
                        <span className="pr-4 text-[14px] text-text-muted whitespace-nowrap select-none">@gmail.com</span>
                      )}
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
                <button onClick={() => void giveConsent()} className="flex-1 px-4 py-2.5 rounded-xl bg-[#1e3a8a] text-white text-[14px] font-semibold hover:bg-[#17307a]">Yes, the customer consents</button>
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
                appId={appId} form={form} docRows={docRows}
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
              <DocTable key={"applicant-docs-" + idx} appId={appId} form={form} docRows={docRows} rows={turn.rows ?? APPLICANT_ROWS} onPatch={merge} onDone={finishDocTable} />
            )}

            {turn.kind === "coapp_docs" && appId && (
              <DocTable key={"coapp-docs-" + idx} appId={appId} form={form} docRows={docRows} rows={turn.rows ?? COAPP_ROWS} onPatch={merge} onDone={() => { pushUndo(); advance(); }} />
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
type Slot = "aadhaar_front" | "aadhaar_back" | "pan" | "ebill" | "rooftop" | "selfie" | "bank" | "coapp_aadhaar_front" | "coapp_aadhaar_back" | "coapp_pan";
type Unit = "aadhaar" | "pan" | "ebill" | "rooftop" | "selfie" | "bank" | "coapp_aadhaar" | "coapp_pan";
type Row = { slot: Slot; label: string; unit: Unit; parts: Slot[]; lastOfUnit?: boolean; coappOnly?: boolean };

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

// Form key that marks each unit already read (for prefill/done).
const UNIT_DONE_KEY: Record<Unit, string> = {
  aadhaar: "aadhaar_front_path", pan: "borrower_pan", ebill: "ebill_path",
  rooftop: "rooftop_photo_path", selfie: "customer_photo_path", bank: "bank_statement_path",
  coapp_aadhaar: "coapp_aadhaar_front_path", coapp_pan: "coapp_pan_path",
};
// Editable read-out fields shown under a unit once read.
const UNIT_FIELDS: Partial<Record<Unit, (f: Form) => { label: string; field: string }[]>> = {
  aadhaar: () => [{ label: "Name", field: "aadhaar_name" }, { label: "DOB", field: "aadhaar_dob" }, { label: "Aadhaar", field: "aadhaar_number" }, { label: "Address", field: "aadhaar_address" }],
  pan: () => [{ label: "PAN", field: "borrower_pan" }, { label: "Name", field: "borrower_name" }, { label: "Father", field: "borrower_father_name" }],
  ebill: () => [{ label: "Monthly bill (₹)", field: "monthly_bill_amount" }, { label: "DISCOM", field: "discom_name" }, { label: "Bill name", field: "ebill_name" }],
  coapp_aadhaar: () => [{ label: "Name", field: "coapp_aadhaar_name" }, { label: "DOB", field: "coapp_aadhaar_dob" }, { label: "Aadhaar", field: "coapp_aadhaar_number" }],
  coapp_pan: () => [{ label: "PAN", field: "coapp_pan" }, { label: "Name", field: "coapp_name" }, { label: "Father", field: "coapp_father_name" }],
};

type SlotFile = { file: File; thumb: string | null };

function DocTable({ appId, form, rows, docRows = [], onPatch, onDone }: { appId: string; form: Form; rows: Row[]; docRows?: { id: string; category: string; storage_path: string | null }[]; onPatch: (p: Form) => void; onDone: (r: { name: string; thumb: string | null }[]) => void }) {
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
  // uploaded before). Path-based docs go via sign-doc; the PAN image is a row.
  async function view(path?: string | null, rowId?: string) {
    try {
      if (path) {
        const res = await fetch(`/api/admin/loan-app/${appId}/sign-doc`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const j = await res.json().catch(() => ({}));
        if (j?.ok && j.url) { window.open(j.url as string, "_blank", "noopener"); return; }
      }
      if (rowId) { const url = await getDocumentUrl(rowId); if (url) { window.open(url, "_blank", "noopener"); return; } }
      alert("Couldn't open the document.");
    } catch { alert("Couldn't open the document."); }
  }
  const unitTarget = (u: Unit): { path?: string; rowId?: string } => {
    switch (u) {
      case "aadhaar":       return { path: form.aadhaar_front_path };
      case "pan":           return { rowId: docRows.find((d) => d.category === "borrower_pan")?.id };
      case "ebill":         return { path: form.ebill_path };
      case "rooftop":       return { path: form.rooftop_photo_path };
      case "selfie":        return { path: form.customer_photo_path };
      case "bank":          return { path: form.bank_statement_path };
      case "coapp_aadhaar": return { path: form.coapp_aadhaar_front_path };
      case "coapp_pan":     return { path: form.coapp_pan_path };
      default:              return {};
    }
  };
  const unitPrefilled = (u: Unit) => !!(form[UNIT_DONE_KEY[u]] && String(form[UNIT_DONE_KEY[u]]).trim());
  const unitDone = (u: Unit) => reads[u]?.status === "done" || unitPrefilled(u);
  const rowOpen = (slot: Slot, u: Unit) => !files[slot] && !skipped[slot] && (!!reopened[slot] || !unitPrefilled(u));
  const rowSettled = (r: Row) => !!skipped[r.slot] || (!!files[r.slot] && reads[r.unit]?.status !== "error") || unitPrefilled(r.unit);
  const allSettled = rows.every(rowSettled);

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
      if (co) return { coapp_aadhaar_name: x.name ?? "", coapp_aadhaar_dob: x.dob ?? "", coapp_aadhaar_gender: x.gender ?? "", coapp_aadhaar_number: x.aadhaar_number ?? "", coapp_aadhaar_care_of: x.care_of ?? "", coapp_aadhaar_address: x.address ?? "", coapp_aadhaar_front_path: p.front ?? "", coapp_aadhaar_back_path: p.back ?? "", coapp_aadhaar_face_path: p.face ?? "", ...(x.name && !form.coapp_name ? { coapp_name: x.name } : {}) };
      return { aadhaar_name: x.name ?? "", aadhaar_dob: x.dob ?? "", aadhaar_gender: x.gender ?? "", aadhaar_number: x.aadhaar_number ?? "", aadhaar_care_of: x.care_of ?? "", aadhaar_address: x.address ?? "", aadhaar_front_path: p.front ?? "", aadhaar_back_path: p.back ?? "", aadhaar_face_path: p.face ?? "", ...(x.name && !form.borrower_name ? { borrower_name: x.name } : {}) };
    }
    // PAN (applicant / co-app) — extract-coapp-pan.
    if (unit === "pan" || unit === "coapp_pan") {
      const applicant = unit === "pan";
      const fd = new FormData();
      fd.append("file", fileOf(unit === "pan" ? "pan" : "coapp_pan"));
      if (applicant) fd.append("applicant", "1");
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-coapp-pan`, { method: "POST", headers: auth(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the PAN.");
      const x = j.fields ?? {};
      // Applicant PAN is shown from its user_application_docs row (the route
      // registers a borrower_pan row) — no path column. Co-applicant PAN uses
      // the coapp_pan_path column, so capture the returned storage_path.
      if (applicant) return { borrower_pan: x.pan ?? "", borrower_father_name: x.father_name ?? "", _pan_name: x.name ?? "", ...(x.dob ? { borrower_dob: x.dob } : {}), ...(x.name && !form.borrower_name ? { borrower_name: x.name } : {}) };
      return { coapp_pan: x.pan ?? "", coapp_pan_path: j.storage_path ?? "", coapp_father_name: x.father_name ?? "", ...(x.dob ? { coapp_dob: x.dob } : {}), ...(x.name && !form.coapp_name ? { coapp_name: x.name } : {}) };
    }
    // E-bill — extract-loan-docs (ebill side).
    if (unit === "ebill") {
      const fd = new FormData();
      fd.append("ebill", fileOf("ebill"));
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-loan-docs`, { method: "POST", headers: auth(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the bill.");
      const e = j.ebill?.fields ?? {}; const path = j.ebill?.storage_path ?? "";
      return { ebill_path: path, monthly_bill_amount: e.monthly_bill_amount != null ? String(e.monthly_bill_amount) : "", discom_name: e.discom_name ?? "", ca_number: e.ca_number ?? "", ebill_address_line: e.ebill_address_line ?? "", ebill_name: e.ebill_name ?? "" };
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
      const viewLink = (tgt.path || tgt.rowId)
        ? <button onClick={() => void view(tgt.path, tgt.rowId)} className="text-[#1e3a8a] text-[11px] font-semibold hover:underline">View current file</button>
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
                    <td className="px-3 py-2 align-middle text-right"><input type="checkbox" checked={!!skipped[r.slot]} onChange={() => toggleSkip(r.slot)} className="w-4 h-4 accent-[#1e3a8a] cursor-pointer align-middle" aria-label={`Don't have ${r.label}`} /></td>
                  </tr>
                  {s && <tr><td colSpan={3} className="px-3 pb-2.5 pt-0">{s}</td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={done} disabled={!allSettled} className="px-4 py-2 rounded-lg bg-[#1e3a8a] text-white text-[13px] font-semibold hover:bg-[#17307a] disabled:opacity-50">Continue →</button>
        {!allSettled && <span className="text-[11px] text-text-muted">Add or tick “Don&apos;t have it” for every row to continue.</span>}
      </div>
    </div>
  );
}

// ── Edit picker ──────────────────────────────────────────────────────────────
// The multi-select "what do you want to change?" table shown in edit mode.
// Each row shows the current value (or On file · View for documents); ticked
// rows become the edit script. Documents already on file get a View button.
function EditPicker({ appId, form, docRows, onPick }: {
  appId: string; form: Form;
  docRows: { id: string; category: string; storage_path: string | null }[];
  onPick: (keys: string[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });
  const has = (k: string) => !!(form[k] && String(form[k]).trim());

  // Open a stored document — by *_path (sign-doc) or by its docs row (PAN image).
  async function view(path?: string | null, rowId?: string) {
    try {
      if (path) {
        const res = await fetch(`/api/admin/loan-app/${appId}/sign-doc`, {
          method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ path }),
        });
        const j = await res.json().catch(() => ({}));
        if (j?.ok && j.url) { window.open(j.url as string, "_blank", "noopener"); return; }
      }
      if (rowId) { const url = await getDocumentUrl(rowId); if (url) { window.open(url, "_blank", "noopener"); return; } }
      alert("Couldn't open the document.");
    } catch { alert("Couldn't open the document."); }
  }

  const panRow = docRows.find((d) => d.category === "borrower_pan");
  const hasCoapp = has("coapp_aadhaar_front_path") || has("coapp_pan_path") || has("coapp_pan") || has("coapp_aadhaar_number") || has("coapp_mobile");

  type Item = { key: string; label: string; doc?: boolean; on?: boolean; path?: string | null; rowId?: string; value?: string };
  const groups: { title: string; items: Item[] }[] = [
    { title: "Documents", items: [
      { key: "aadhaar", label: "Aadhaar (front & back)", doc: true, on: has("aadhaar_front_path"), path: form.aadhaar_front_path },
      { key: "pan", label: "PAN card", doc: true, on: has("borrower_pan") || !!panRow, rowId: panRow?.id, path: panRow?.storage_path ?? undefined },
      { key: "ebill", label: "Electricity bill", doc: true, on: has("ebill_path"), path: form.ebill_path },
      { key: "rooftop", label: "Rooftop photo", doc: true, on: has("rooftop_photo_path"), path: form.rooftop_photo_path },
      { key: "selfie", label: "Applicant photo", doc: true, on: has("customer_photo_path"), path: form.customer_photo_path },
      { key: "bank", label: "Bank statement", doc: true, on: has("bank_statement_path"), path: form.bank_statement_path },
    ] },
    ...(hasCoapp ? [{ title: "Co-applicant", items: [
      { key: "coapp_aadhaar", label: "Co-applicant Aadhaar", doc: true, on: has("coapp_aadhaar_front_path"), path: form.coapp_aadhaar_front_path },
      { key: "coapp_pan", label: "Co-applicant PAN", doc: true, on: has("coapp_pan_path") || has("coapp_pan"), path: form.coapp_pan_path },
      { key: "coapp_mobile", label: "Co-applicant mobile", value: form.coapp_mobile || "—" },
    ] }] : []),
    { title: "Applicant details", items: [
      { key: "borrower_email", label: "Email", value: form.borrower_email || "—" },
      { key: "install_pincode", label: "Installation pincode", value: form.install_pincode || "—" },
      { key: "system_type", label: "System type", value: SYS_LABEL[form.system_type] || "—" },
      { key: "plant_use_type", label: "Property use", value: USE_LABEL[form.plant_use_type] || "—" },
    ] },
    { title: "Quotation & loan", items: [
      { key: "quotation", label: "Quotation document", doc: true, on: has("proforma_invoice_path"), path: form.proforma_invoice_path },
      { key: "loan_amount", label: "Loan amount", value: form.loan_amount_required ? `₹${Number(form.loan_amount_required).toLocaleString("en-IN")}` : "—" },
      { key: "loan_config", label: "Loan configuration", value: form.selected_tenure_years ? `${form.selected_tenure_years} yr tenure` : "—" },
    ] },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-3 py-2 bg-[#eef3fc] border-y border-[#dbe4f6] text-[11px] font-semibold text-[#14235c]">{g.title}</div>
            {g.items.map((it) => {
              const checked = sel.has(it.key);
              return (
                <div key={it.key} onClick={() => toggle(it.key)} className="flex items-center gap-2.5 px-3 py-2 border-b border-line/70 last:border-b-0 cursor-pointer hover:bg-[#f7f9fe]">
                  <input type="checkbox" checked={checked} onChange={() => toggle(it.key)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 accent-[#1e3a8a] cursor-pointer shrink-0" aria-label={`Edit ${it.label}`} />
                  <span className="flex-1 text-[12.5px] text-text leading-snug">{it.label}</span>
                  {it.doc ? (
                    it.on ? (
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-semibold text-[#178a5c]">On file</span>
                        <button onClick={(e) => { e.stopPropagation(); void view(it.path, it.rowId); }} className="text-[#1e3a8a] text-[11px] font-semibold hover:underline">View</button>
                      </span>
                    ) : <span className="text-[11px] font-semibold text-amber-600 shrink-0">Missing</span>
                  ) : (
                    <span className="text-[11.5px] text-text-muted text-right max-w-[46%] truncate shrink-0">{it.value}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => sel.size > 0 && onPick([...sel])} disabled={sel.size === 0} className="px-4 py-2 rounded-lg bg-[#1e3a8a] text-white text-[13px] font-semibold hover:bg-[#17307a] disabled:opacity-50">
          Edit selected{sel.size ? ` (${sel.size})` : ""} →
        </button>
        {sel.size === 0 && <span className="text-[11px] text-text-muted">Tick the fields or documents you want to change.</span>}
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
