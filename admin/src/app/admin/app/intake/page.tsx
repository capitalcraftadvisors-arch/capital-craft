"use client";

// AI intake — a premium, WhatsApp-style guided chat that builds a FULL loan
// application (all 5 steps) and submits it as a complete profile. Documents do
// the data entry (OCR via the existing extract-* routes); the chat collects
// everything else. It writes through the SAME create + complete-step routes the
// wizard uses, so the result is identical to a hand-entered profile.
// View / edit / wizard are untouched — this lives at its own URL.
//
// Features (per RM request):
//   • WhatsApp-style canvas: patterned background, chat header, date chip,
//     timestamps, the RM's name under every message they send, read ticks.
//   • Every typed answer is editable — tap the ✎ on a message to correct it;
//     if its step was already saved, the correction is re-synced silently.
//   • Documents can be attached by click, drag-drop, or paste (Ctrl+V), with
//     live thumbnails.
//   • After OCR the "Read from the document" card shows exactly what was found,
//     flags anything it could NOT read, and always lets the RM continue.
//   • Missing anything? "Don't have it — skip" continues the chat and the
//     application is saved as a DRAFT (not submitted) with the pending items.
//
// Note: the document turns call routes that store to Google Cloud Storage —
// locally that needs ADC (`gcloud auth application-default login`); on prod
// it's automatic.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getToken, getBusiness } from "@/lib/auth";
import { computeCentralSubsidy, computeEmi, formatRupees, DEFAULT_INDICATIVE_ROI, TENURES } from "@/lib/emi";

export default function IntakePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type Choice = { value: string; label: string; sub?: string };
type Form = Record<string, string>;

// A turn is one thing the chat asks/does. `when` gates conditional turns
// (co-applicant), `save` marks a step boundary that persists to the server.
type Turn = {
  id: string;
  bot: string;
  kind: "epc" | "text" | "pincode" | "choice" | "consent" | "docs" | "save" | "loanconfig" | "leadsave" | "namecheck";
  field?: string;
  placeholder?: string;
  optional?: boolean;
  choices?: Choice[];
  validate?: (v: string) => string | null;
  when?: (f: Form) => boolean;
  // docs turn:
  uploads?: { name: string; label: string }[];
  extractRoute?: string;
  extraForm?: Record<string, string>;
  docLabel?: string; // friendly name for the "skip / missing" note
  uploadCategory?: string; // docs turn with NO OCR — POST the file to /api/upload under this category
  pathField?: string;      // where to store the returned storage_path in the form
  applicantPan?: boolean;  // reuse extract-coapp-pan OCR but map fields to the APPLICANT
  // save turn:
  step?: number;
  method?: "POST" | "PATCH";
  payload?: (f: Form) => Record<string, unknown>;
};

const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hasCoapp = (f: Form) => f._has_coapp === "1"; // set by the name-check (mandatory) or the optional "add co-applicant" choice

const SCRIPT: Turn[] = [
  // ── Registration basics (least typing — name/DOB come from the documents) ──
  { id: "epc", bot: "Which EPC partner is this application for?", kind: "epc" },
  { id: "install_pincode", bot: "Installation pincode?", kind: "pincode", field: "install_pincode" },
  { id: "borrower_mobile", bot: "Customer's phone number?", kind: "text", field: "borrower_mobile", placeholder: "10-digit mobile", validate: (v) => (MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile.") },
  { id: "borrower_email", bot: "Email ID? (optional)", kind: "text", field: "borrower_email", placeholder: "name@example.com", optional: true, validate: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? null : "Enter a valid email or skip.") },
  { id: "lead_owner_name", bot: "Lead owner's name? (optional)", kind: "text", field: "lead_owner_name", placeholder: "Who owns this lead", optional: true },
  { id: "plant_use_type", bot: "Residential or commercial use?", kind: "choice", field: "plant_use_type", choices: [
    { value: "residential", label: "Residential", sub: "Home / society" },
    { value: "commercial", label: "Commercial", sub: "Shop / office / factory" },
  ] },

  // ── Documents, one at a time — OCR fills as much as possible so the RM types least ──
  { id: "pan", bot: "Upload the applicant's PAN — I'll read it.", kind: "docs", docLabel: "Applicant PAN", applicantPan: true,
    uploads: [{ name: "file", label: "PAN card" }], extractRoute: "extract-coapp-pan" },
  { id: "aadhaar", bot: "Upload the applicant's Aadhaar (front & back).", kind: "docs", docLabel: "Applicant Aadhaar",
    uploads: [{ name: "front", label: "Aadhaar front" }, { name: "back", label: "Aadhaar back" }], extractRoute: "extract-aadhaar" },
  { id: "selfie", bot: "Upload the applicant's photo / selfie.", kind: "docs", docLabel: "Applicant photo",
    uploads: [{ name: "file", label: "Applicant photo" }], uploadCategory: "customer_photo", pathField: "customer_photo_path" },
  { id: "ebill", bot: "Upload the latest electricity bill.", kind: "docs", docLabel: "Electricity bill",
    uploads: [{ name: "ebill", label: "Electricity bill" }], extractRoute: "extract-loan-docs" },
  { id: "quotation", bot: "Upload the quotation / proforma invoice.", kind: "docs", docLabel: "Quotation / invoice",
    uploads: [{ name: "proforma", label: "Quotation / invoice" }], extractRoute: "extract-loan-docs" },
  { id: "rooftop", bot: "Upload the geo-tagged rooftop photo.", kind: "docs", docLabel: "Rooftop photo",
    uploads: [{ name: "photo", label: "Rooftop photo" }], uploadCategory: "other", pathField: "rooftop_photo_path" },
  { id: "bank", bot: "Upload the bank statement.", kind: "docs", docLabel: "Bank statement",
    uploads: [{ name: "file", label: "Bank statement" }], extractRoute: "extract-bank-statement", extraForm: { method: "manual_epdf" } },

  // ── Ask only what OCR couldn't fill ──
  { id: "borrower_name", bot: "I couldn't read the applicant's name from the documents — what is it?", kind: "text", field: "borrower_name", placeholder: "Full name", when: (f) => !f.borrower_name, validate: (v) => (v.trim().length < 2 ? "Enter the applicant's name." : null) },

  // ── Co-applicant, driven by the name check (PAN=Aadhaar, then vs e-bill owner) ──
  { id: "namecheck", bot: "", kind: "namecheck" },
  // A co-applicant is NEVER forced — we always ask. The name check above just
  // advises (recommends one when the e-bill owner differs from the applicant).
  { id: "add_coapp", bot: "Is there a co-applicant for this case?", kind: "choice", field: "_has_coapp", choices: [
    { value: "1", label: "Yes — add co-applicant" },
    { value: "", label: "No co-applicant" },
  ] },
  { id: "coapp_pan", bot: "Upload the co-applicant's PAN.", kind: "docs", when: hasCoapp, docLabel: "Co-applicant PAN",
    uploads: [{ name: "file", label: "Co-applicant PAN" }], extractRoute: "extract-coapp-pan" },
  { id: "coapp_aadhaar", bot: "Upload the co-applicant's Aadhaar (front & back).", kind: "docs", when: hasCoapp, docLabel: "Co-applicant Aadhaar",
    uploads: [{ name: "front", label: "Aadhaar front" }, { name: "back", label: "Aadhaar back" }], extractRoute: "extract-aadhaar", extraForm: { _coapp: "1" } },
  { id: "coapp_relation", bot: "Co-applicant's relation to the applicant?", kind: "text", field: "coapp_relation", placeholder: "e.g. Spouse, Father", when: hasCoapp, optional: true },

  // ── Employment ──
  { id: "employment_type", bot: "Employment type?", kind: "choice", field: "employment_type", choices: [
    { value: "salaried", label: "Salaried" }, { value: "self_employed", label: "Self-employed" },
  ] },
  { id: "profession", bot: "Profession? (optional)", kind: "text", field: "profession", placeholder: "e.g. Engineer", optional: true },
  { id: "organization_name", bot: "Organization / business name? (optional)", kind: "text", field: "organization_name", placeholder: "Organization", optional: true },
  { id: "annual_income", bot: "Annual income (₹)? (optional)", kind: "text", field: "annual_income", placeholder: "e.g. 600000", optional: true },

  // ── Additional documents (optional) ──
  { id: "additional_docs", bot: "Any other documents to add? (optional — skip if none)", kind: "docs", docLabel: "Additional documents", optional: true,
    uploads: [{ name: "file", label: "Additional document" }], uploadCategory: "other" },

  // ── Loan information ──
  { id: "system_type", bot: "Solar system preference?", kind: "choice", field: "system_type", choices: [
    { value: "on_grid", label: "On-Grid", sub: "Sells excess to grid" },
    { value: "off_grid", label: "Off-Grid", sub: "Battery, independent" },
    { value: "hybrid", label: "Hybrid", sub: "Grid + battery" },
  ] },
  { id: "loan_amount_required", bot: "How much loan does the customer need (₹)?", kind: "text", field: "loan_amount_required", placeholder: "e.g. 200000", validate: (v) => (Number(v) > 0 ? null : "Enter a valid amount.") },
  { id: "consent", bot: "Does the customer consent to the Terms, Privacy & Cookie policies and allow credit-information access?", kind: "consent", field: "consent" },
  { id: "loanconfig", bot: "Last step — loan configuration.", kind: "loanconfig" },
];

// The complete-step payloads, keyed by step. Persistence during the flow is via
// update-fields (any order); these run in sequence only at final submit to walk
// current_step 1→6, record consent, and submit.
const STEP_PAYLOAD: Record<number, (f: Form) => Record<string, unknown>> = {
  1: (f) => ({
    borrower_name: f.borrower_name || "", borrower_mobile: f.borrower_mobile || "", borrower_email: f.borrower_email || "", lead_owner_name: f.lead_owner_name || "",
    install_pincode: f.install_pincode || "", install_state: f.install_state || "", install_district: f.install_district || "", install_city: f.install_city || "",
    system_type: f.system_type || "", plant_use_type: f.plant_use_type || "",
    consent_policies: ["terms_conditions", "privacy_policy", "cookie_policy"],
  }),
  2: (f) => ({
    aadhaar_name: f.aadhaar_name || "", aadhaar_dob: f.aadhaar_dob || "", aadhaar_gender: f.aadhaar_gender || "",
    aadhaar_number: f.aadhaar_number || "", aadhaar_care_of: f.aadhaar_care_of || "", aadhaar_address: f.aadhaar_address || "",
    aadhaar_front_path: f.aadhaar_front_path || "", aadhaar_back_path: f.aadhaar_back_path || "", aadhaar_face_path: f.aadhaar_face_path || "",
  }),
  3: (f) => ({
    project_size: f.project_size || "", project_size_unit: f.project_size_unit || "kw",
    total_project_cost: f.total_project_cost || "", loan_amount_required: f.loan_amount_required || "",
    monthly_bill_amount: f.monthly_bill_amount || "", discom_name: f.discom_name || "", ca_number: f.ca_number || "",
    ebill_address_line: f.ebill_address_line || "", ebill_name: f.ebill_name || "",
    ebill_path: f.ebill_path || "", ebill_uploaded_at: f.ebill_uploaded_at || "",
    proforma_invoice_path: f.proforma_invoice_path || "", proforma_uploaded_at: f.proforma_uploaded_at || "",
    rooftop_photo_path: f.rooftop_photo_path || "", rooftop_photo_uploaded_at: f.rooftop_photo_uploaded_at || "",
    install_pincode: f.install_pincode || "", install_state: f.install_state || "", install_city: f.install_city || "",
    // Derive from the co-applicant decision: co-applicant present ⇒ bill not on
    // the applicant alone. Keeps the profile's co-applicant section in sync with
    // the explicit Yes/No answer (a co-applicant is optional, never forced).
    bill_on_applicant_name: f._has_coapp !== "1",
    coapp_name: f.coapp_name || "", coapp_father_name: f.coapp_father_name || "", coapp_dob: f.coapp_dob || "",
    coapp_pan: f.coapp_pan || "", coapp_pan_path: f.coapp_pan_path || "", coapp_relation: f.coapp_relation || "",
    coapp_aadhaar_name: f.coapp_aadhaar_name || "", coapp_aadhaar_dob: f.coapp_aadhaar_dob || "", coapp_aadhaar_gender: f.coapp_aadhaar_gender || "",
    coapp_aadhaar_number: f.coapp_aadhaar_number || "", coapp_aadhaar_care_of: f.coapp_aadhaar_care_of || "", coapp_aadhaar_address: f.coapp_aadhaar_address || "",
    coapp_aadhaar_front_path: f.coapp_aadhaar_front_path || "", coapp_aadhaar_back_path: f.coapp_aadhaar_back_path || "", coapp_aadhaar_face_path: f.coapp_aadhaar_face_path || "",
  }),
  4: (f) => ({
    employment_type: f.employment_type || "", profession: f.profession || "", profession_other: "", organization_name: f.organization_name || "", annual_income: f.annual_income || "",
    bank_statement_method: f.bank_statement_method || "manual_epdf", bank_statement_path: f.bank_statement_path || "", bank_statement_uploaded_at: f.bank_statement_uploaded_at || "",
    bank_account_holder: f.bank_account_holder || "", bank_name: f.bank_name || "", bank_account_no: f.bank_account_no || "",
    bank_ifsc: f.bank_ifsc || "", bank_account_type: f.bank_account_type || "", bank_mobile: f.bank_mobile || "", bank_email: f.bank_email || "",
  }),
};

// Lead capture flow — used when the EPC isn't a registered, lender-approved
// partner. A full application can't exist without a registered EPC (DB rule),
// so we capture the customer + typed EPC name as a loan_leads row for the Lead
// tab; it's converted to a full application once the EPC is approved.
const LEAD_SCRIPT: Turn[] = [
  { id: "lead_name", bot: "Customer's full name?", kind: "text", field: "lead_name", placeholder: "Full name", validate: (v) => (v.trim().length < 2 ? "Enter the customer's name." : null) },
  { id: "lead_mobile", bot: "Customer's phone number?", kind: "text", field: "lead_mobile", placeholder: "10-digit mobile", validate: (v) => (MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile.") },
  { id: "lead_email", bot: "Email? (optional)", kind: "text", field: "lead_email", placeholder: "name@example.com", optional: true, validate: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? null : "Enter a valid email or skip.") },
  { id: "lead_address", bot: "City / installation area? (optional)", kind: "text", field: "lead_address", placeholder: "City or area", optional: true },
  { id: "lead_loan_amount", bot: "Approximate loan amount (₹)? (optional)", kind: "text", field: "lead_loan_amount", placeholder: "e.g. 200000", optional: true },
  { id: "lead_project_size", bot: "Approximate system size in kW? (optional)", kind: "text", field: "lead_project_size", placeholder: "e.g. 5", optional: true },
  { id: "lead_save", bot: "", kind: "leadsave" },
];

type Fetched = { label: string; value: string; ok: boolean; field?: string };
type Msg = {
  id: string;
  from: "bot" | "user";
  text?: string;
  time: string;
  turnId?: string;
  field?: string;
  editable?: boolean;
  edited?: boolean;
  files?: { name: string; thumb: string | null }[]; // user document receipt
  fetched?: Fetched[]; // permanent, editable "read from the document" card
  typing?: boolean; // bot "…" indicator
};

// Subtle branded doodle canvas (WhatsApp-style texture, but in our green).
const DOODLE = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='104' height='104' viewBox='0 0 104 104'>
     <g fill='none' stroke='#0f3d2e' stroke-opacity='0.045' stroke-width='1.4'>
       <circle cx='22' cy='24' r='7'/>
       <circle cx='78' cy='66' r='10'/>
       <path d='M74 18 v9 M69.5 22.5 h9'/>
       <path d='M14 78 q8 -10 16 0'/>
       <rect x='58' y='16' width='10' height='10' rx='2'/>
     </g>
     <g fill='#0f3d2e' fill-opacity='0.045'>
       <circle cx='48' cy='50' r='1.8'/>
       <circle cx='92' cy='30' r='1.8'/>
       <circle cx='30' cy='96' r='1.8'/>
     </g>
   </svg>`,
);
const CANVAS_STYLE: React.CSSProperties = {
  backgroundColor: "#e7f0ea",
  backgroundImage: `url("data:image/svg+xml,${DOODLE}")`,
};

function nowLabel(): string {
  return new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
}
function todayLabel(): string {
  return "Today · " + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function Inner() {
  const router = useRouter();
  const rmName = useMemo(() => {
    const full = (getBusiness()?.contact_name || "").trim();
    return full ? full.split(" ")[0] : "You";
  }, []);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [idx, setIdx] = useState(0);
  const [form, setForm] = useState<Form>({});
  const [appId, setAppId] = useState<string | null>(null);
  const [epcs, setEpcs] = useState<Choice[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [confirm, setConfirm] = useState<{ fields: Fetched[]; note: string; thumbs: (string | null)[]; edit?: boolean } | null>(null);
  const [donId, setDonId] = useState<string | null>(null);
  const [donDraft, setDonDraft] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ index: number; turnId: string } | null>(null);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editMode, setEditMode] = useState(false);
  // Edit-in-chat intro: Q1 (edit filled?) → pick list → re-ask; Q2 (complete?) → ask missing.
  const [editStep, setEditStep] = useState<"q1" | "pick" | "q2" | "flow" | "done" | null>(null);
  const [editStage, setEditStage] = useState<"selected" | "complete">("complete");
  const [editTargets, setEditTargets] = useState<Set<string>>(new Set());
  const [pickSel, setPickSel] = useState<string[]>([]);
  const [leadMode, setLeadMode] = useState(false);
  const [leadDoneId, setLeadDoneId] = useState<string | null>(null);
  const [epcSearch, setEpcSearch] = useState("");
  const [epcOpen, setEpcOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [undoStack, setUndoStack] = useState<{ msgs: Msg[]; form: Form; idx: number; leadMode: boolean }[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = () => "m" + ++idRef.current;

  // The turn whose controls the dock is showing: the edit target if editing,
  // else the current script turn.
  const script = leadMode ? LEAD_SCRIPT : SCRIPT;
  const turn = script[idx] ?? null;
  const editTurn = editing ? script.find((t) => t.id === editing.turnId) ?? null : null;
  const active = editTurn ?? turn;
  const filteredEpcs = useMemo(() => {
    const q = epcSearch.trim().toLowerCase();
    if (!q) return epcs;
    return epcs.filter((e) => e.label.toLowerCase().includes(q) || (e.sub ?? "").toLowerCase().includes(q));
  }, [epcs, epcSearch]);

  const loanAmt = Number(form.loan_amount_required) || 0;

  // Loan-config (step 5) local inputs
  const [subsidyCase, setSubsidyCase] = useState<"subsidy" | "non_subsidy">("subsidy");
  const [centralSub, setCentralSub] = useState("");
  const [stateSub, setStateSub] = useState("");
  const [tenure, setTenure] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().from("epc_business")
        .select("id, epc_display_id, contact_name, trade_name, legal_name")
        .eq("has_lender_approval", true).neq("business_type", "admin")
        .order("trade_name", { ascending: true, nullsFirst: false });
      setEpcs(((data ?? []) as Record<string, string>[]).map((e) => ({ value: e.id, label: e.trade_name || e.legal_name || e.contact_name || "(unnamed)", sub: e.epc_display_id || undefined })));
    })();
  }, []);

  // Opened with ?app=<id> → resume a saved chat, or (with &edit=1) start a fresh
  // edit session that loads the profile and asks only for what's still missing.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const appParam = params.get("app");
    const editFlag = params.get("edit") === "1";
    if (!appParam) return;
    setResuming(true);
    void (async () => {
      try {
        // 1) Restore a previously-saved chat (create OR edit) if one exists.
        const res = await fetch(`/api/admin/loan-app/${appParam}/intake-chat`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
        const j = await res.json().catch(() => ({}));
        const chat = j?.chat;
        if (chat && Array.isArray(chat.transcript) && chat.transcript.length) {
          idRef.current = chat.transcript.length + 1000; // avoid key collisions with restored ids
          setAppId(appParam);
          setForm((chat.form_state as Form) || {});
          setMsgs(chat.transcript as Msg[]);
          setMode(chat.mode === "edit" ? "edit" : "create");
          setEditMode(chat.mode === "edit");
          if (chat.mode === "edit") setEditStep("q1"); // always ask the edit questions first
          setIdx(Number(chat.cursor) || 0);
          return;
        }
        // 2) Fresh EDIT session — prefill from the profile, ask only what's missing.
        if (editFlag) {
          const app = await loadApp(appParam);
          if (!app) { router.replace(`/admin/app/${appParam}/step-1` as any); return; }
          const pf = prefillFromApp(app);
          setForm(pf);
          setAppId(appParam);
          setEditMode(true);
          setMode("edit");
          if (pf.central_subsidy) setCentralSub(pf.central_subsidy);
          if (pf.state_subsidy) setStateSub(pf.state_subsidy);
          if (pf.selected_tenure_years) setTenure(Number(pf.selected_tenure_years));
          const nm = pf.borrower_name || "this applicant";
          setMsgs([{ id: uid(), from: "bot", text: `Editing ${nm}'s profile.`, time: nowLabel(), turnId: "edit_intro" }]);
          setEditStep("q1"); // Q1/Q2 intro drives the edit; the script runs after
          setIdx(1);
          return;
        }
        // 3) ?app but nothing saved and not an edit → fall back to the classic wizard.
        router.replace(`/admin/app/${appParam}/step-1` as any);
      } finally {
        setResuming(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadApp(id: string): Promise<Record<string, any> | null> {
    const { data } = await supabase().from("epc_applications").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, any>) ?? null;
  }

  // Autosave the transcript + form + cursor (debounced) so a close/refresh never
  // loses progress. Silent no-op until migration 0070 exists (route fails soft).
  useEffect(() => {
    if (resuming || !appId || donId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void saveChat(); }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, form, idx, appId, donId, resuming]);

  const pushBot = useCallback((text: string, turnId: string) => {
    setMsgs((m) => (m.some((x) => x.from === "bot" && x.turnId === turnId) ? m : [...m, { id: uid(), from: "bot", text, time: nowLabel(), turnId }]));
  }, []);

  // Advance the script, running `when` skips and `save` boundaries.
  useEffect(() => {
    if (!turn) return;
    if (turn.when && !turn.when(form)) { setIdx((i) => i + 1); return; }
    if (editMode) {
      if (editStep !== "flow") return; // paused during the Q1/Q2 intro
      if (editStage === "selected") { if (!editTargets.has(turn.id)) { setIdx((i) => i + 1); return; } } // re-ask only the picked ones
      else if (isTurnFilled(turn, form)) { setIdx((i) => i + 1); return; } // "complete" → ask only missing
    }
    if (turn.kind === "leadsave") { void createLead(); return; }
    if (turn.kind === "namecheck") { runNameCheck(); return; }
    pushBot(turn.bot, turn.id);
    setInput(""); setError(null); setFiles({}); setThumbs({}); setConfirm(null); setEditing(null);
    // Re-editing a filled field → prefill the input with its current value.
    if (editMode && editStage === "selected" && (turn.kind === "text" || turn.kind === "pincode") && turn.field) setInput(form[turn.field] || "");
    if (turn.kind === "loanconfig") setCentralSub(String(form.plant_use_type === "commercial" ? 0 : computeCentralSubsidy(kwOf(form))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, leadMode, editStep, editStage]);

  // When the edit flow reaches the end → Q2 (if still incomplete) or finish.
  useEffect(() => {
    if (!editMode || editStep !== "flow" || turn) return;
    if (editStage === "selected" && !isProfileComplete(form)) setEditStep("q2");
    else { say("bot", "Changes saved — the profile is up to date."); setDonId(appId); setEditStep("done"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, editMode, editStep, editStage]);

  // Ask the edit question as a chat bubble when the step changes (deduped by id).
  useEffect(() => {
    if (!editMode) return;
    if (editStep === "q1") pushBot("Do you want to edit any pre-filled details now?", "edit_q1");
    else if (editStep === "pick") pushBot("Select the details you'd like to edit, then tap “Edit selected”.", "edit_pick");
    else if (editStep === "q2") pushBot("This profile isn't complete yet. Do you want to complete it now?", "edit_q2");
  }, [editStep, editMode, pushBot]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, confirm, idx, busy]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  // Paste-to-attach while on a document turn (RM copies an image, hits Ctrl+V).
  useEffect(() => {
    if (!active || active.kind !== "docs" || confirm) return;
    const h = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0];
      if (f) { e.preventDefault(); fillNextSlot(f); }
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, files, confirm]);

  const advance = () => setIdx((i) => i + 1);
  const merge = (patch: Form) => setForm((f) => ({ ...f, ...patch }));
  function hdr() { return { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` }; }

  // Undo — snapshot before each entry so the RM can step any action back.
  function pushUndo() { setUndoStack((s) => [...s.slice(-29), { msgs, form, idx, leadMode }]); }
  function undo() {
    setUndoStack((s) => {
      if (!s.length) return s;
      const snap = s[s.length - 1];
      setMsgs(snap.msgs); setForm(snap.form); setLeadMode(snap.leadMode);
      setEditing(null); setError(null); setConfirm(null);
      setIdx(snap.idx); // re-renders that turn fresh (question re-appears)
      return s.slice(0, -1);
    });
  }

  function pushUser(text: string, meta: Partial<Msg> = {}) {
    setMsgs((m) => [...m, { id: uid(), from: "user", text, time: nowLabel(), ...meta }]);
  }

  function setFileFor(name: string, file: File) {
    setFiles((s) => ({ ...s, [name]: file }));
    const thumb = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    setThumbs((s) => ({ ...s, [name]: thumb }));
  }
  function clearFileFor(name: string) {
    setFiles((s) => { const n = { ...s }; delete n[name]; return n; });
    setThumbs((s) => { const n = { ...s }; delete n[name]; return n; });
  }
  function fillNextSlot(file: File) {
    const slots = active?.uploads ?? [];
    const empty = slots.find((u) => !files[u.name]);
    if (empty) setFileFor(empty.name, file);
  }

  // ── Answer the current (or edited) turn ──
  async function answer(value: string, label: string, opts: { extra?: Form; editable?: boolean; createApp?: boolean } = {}) {
    if (editing) return applyEdit(value, label, opts.extra);
    if (!turn) return;
    if (turn.kind !== "epc") pushUndo();
    if (opts.createApp) {
      setBusy(true);
      try {
        const res = await fetch("/api/admin/create-loan-app", { method: "POST", headers: hdr(), body: JSON.stringify({ epc_business_id: value }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't start the application."); setBusy(false); return; }
        setAppId(j.application.id);
      } finally { setBusy(false); }
    }
    pushUser(label, { turnId: turn.id, field: turn.field, editable: opts.editable });
    const nextForm = { ...form, ...(turn.field ? { [turn.field]: value } : {}), ...(opts.extra ?? {}) };
    setForm(nextForm);
    void persistForm(nextForm); // silent background save so nothing is lost
    advance();
  }

  async function submitText() {
    const t = active; if (!t) return;
    const v = input.trim();
    if (t.validate) { const e = t.validate(v); if (e) { setError(e); return; } }
    if (!v && !t.optional) { setError("This field is required."); return; }
    await answer(v, v || "—", { editable: true });
  }
  async function skipText() {
    const t = active; if (!t) return;
    pushUndo();
    // Required fields can be skipped too (e.g. "no mobile right now") — but we
    // record them so the application finishes as an incomplete draft, not a
    // full submission.
    if (!t.optional && t.field) setMissing((s) => (s.includes(fieldLabel(t)) ? s : [...s, fieldLabel(t)]));
    await answer("", "— skipped —", { editable: true });
  }

  // Persist the chat transcript + form + cursor. Blob thumbnails aren't
  // serializable across a reload, so document receipts are saved by name only.
  async function saveChat(opts: { markUnderReview?: boolean } = {}) {
    if (!appId) return;
    const transcript = msgs.map((m) => (m.files ? { ...m, files: m.files.map((f) => ({ name: f.name, thumb: null })) } : m));
    try {
      await fetch(`/api/admin/loan-app/${appId}/intake-chat`, {
        method: "POST", headers: hdr(),
        body: JSON.stringify({ transcript, form_state: form, cursor: idx, mode, mark_under_review: !!opts.markUnderReview }),
      });
    } catch { /* best-effort */ }
  }

  // Close the chat mid-way. Completed steps are already saved on the server; we
  // also persist the transcript and — for a half-finished NEW application —
  // bump it to "under review" so it's visible on the dashboard for follow-up.
  async function closeChat() {
    if (donId) { router.push("/admin"); return; }
    const started = !!appId;
    if (started && !window.confirm("Close this chat? Your progress is saved — you can reopen this application to continue.")) return;
    if (started) await saveChat({ markUnderReview: mode === "create" });
    router.push("/admin");
  }

  async function submitPincode() {
    const pin = input.trim();
    if (!/^[1-9]\d{5}$/.test(pin)) { setError("Enter a valid 6-digit pincode."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/pincode-lookup?pin=${pin}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      const j = await res.json().catch(() => ({}));
      if (j?.ok) {
        await answer(pin, `${pin} · ${j.city ? j.city + ", " : ""}${j.state}`, { editable: true, extra: { install_state: j.state, install_district: j.district || "", install_city: j.city || "" } });
      } else {
        await answer(pin, pin, { editable: true });
      }
    } finally { setBusy(false); }
  }

  // ── Editing a previous answer ──
  function startEdit(m: Msg) {
    if (!m.turnId || (!m.editable && m.turnId !== "epc")) return; // the EPC answer is always changeable
    const t = script.find((x) => x.id === m.turnId);
    if (!t) return;
    setEditing({ index: msgs.findIndex((x) => x.id === m.id), turnId: m.turnId });
    setError(null);
    if (t.kind === "text" || t.kind === "pincode") setInput((t.field && form[t.field]) || "");
    if (t.kind === "epc") { setEpcSearch(""); setEpcOpen(true); } // re-open the partner list to pick another EPC
    if (t.kind === "docs") { setFiles({}); setThumbs({}); setConfirm(null); } // re-attach fresh
  }
  async function applyEdit(value: string, label: string, extra?: Form) {
    if (!editing) return;
    pushUndo();
    const { index, turnId } = editing;
    const t = script.find((x) => x.id === turnId);
    const field = t?.field;
    // Changing the EPC partner re-points this application (epc_business_id) —
    // it never creates a new one.
    const nextForm: Form = { ...form, ...(field ? { [field]: value } : {}), ...(t?.kind === "epc" ? { epc_business_id: value } : {}), ...(extra ?? {}) };
    setForm(nextForm);
    setMsgs((m) => m.map((x, i) => (i === index ? { ...x, text: label, edited: true } : x)));
    setEditing(null); setInput("");
    if (t?.kind === "epc") setEpcOpen(false);
    if (appId) await persistForm(nextForm); // reflect the edit on the profile immediately
  }
  function cancelEdit() { setEditing(null); setInput(""); setError(null); }

  // ── Documents ──
  async function runDocs() {
    const t = active; if (!t || !appId) return;
    const isDocEdit = !!editing && editTurn?.id === t.id; // replacing an already-uploaded doc
    const needed = t.uploads ?? [];
    for (const u of needed) if (!files[u.name]) { setError(`Please attach: ${u.label}.`); return; }
    pushUndo();
    setBusy(true); setError(null);
    const receipt = needed.map((u) => ({ name: files[u.name]?.name || u.label, thumb: thumbs[u.name] ?? null }));
    try {
      if (isDocEdit) {
        setMsgs((m) => m.map((x, i) => (i === editing!.index ? { ...x, files: receipt, edited: true } : x)));
      } else {
        pushUser(needed.map((u) => u.label).join(" · "), { files: receipt, turnId: t.id, editable: true });
      }
      // No-OCR uploads (selfie, rooftop, additional docs) → store via /api/upload.
      if (t.uploadCategory) {
        const patch: Form = {};
        for (const u of needed) {
          const fd = new FormData();
          fd.append("file", files[u.name]);
          fd.append("table", "user_application_docs");
          fd.append("category", t.uploadCategory);
          fd.append("application_id", appId);
          fd.append("uploaded_by", "admin");
          const res = await fetch("/api/upload", { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body: fd });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't upload the file. Try again, or skip."); setBusy(false); return; }
          if (t.pathField) {
            patch[t.pathField] = j.storage_path;
            if (t.pathField === "rooftop_photo_path") patch.rooftop_photo_uploaded_at = new Date().toISOString();
          }
        }
        merge(patch);
        void persistForm({ ...form, ...patch });
        if (isDocEdit) setEditing(null); else advance();
        return;
      }
      if (!t.extractRoute) { if (isDocEdit) setEditing(null); else advance(); return; }
      const fd = new FormData();
      for (const u of needed) fd.append(u.name, files[u.name]);
      for (const [k, v] of Object.entries(t.extraForm ?? {})) fd.append(k, v);
      // Applicant PAN reuses extract-coapp-pan — tell the route so it also files
      // the doc under category "borrower_pan" (the profile's Applicant-PAN slot).
      if (t.applicantPan) fd.append("applicant", "1");
      const res = await fetch(`/api/admin/loan-app/${appId}/${t.extractRoute}`, { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't read the document. Attach a clearer copy, or skip and fill it in later."); setBusy(false); return; }
      const { patch, fields } = mapExtract(t, j);
      merge(patch);
      void persistForm({ ...form, ...patch }); // persist OCR results immediately (create + edit)
      const gaps = fields.filter((f) => !f.ok).map((f) => f.label);
      const note = gaps.length === 0
        ? "All details read cleanly."
        : `Couldn't read: ${gaps.join(", ")}. You can continue and add these later in the profile, or re-attach a clearer copy.`;
      setConfirm({ fields, note, thumbs: receipt.map((r) => r.thumb), edit: isDocEdit });
    } finally { setBusy(false); }
  }
  function retryDocs() { setConfirm(null); setFiles({}); setThumbs({}); setError(null); }
  function skipDoc() {
    const t = active; if (!t) return;
    pushUndo();
    setMissing((s) => (s.includes(t.docLabel || t.id) ? s : [...s, t.docLabel || t.id]));
    pushUser(`Skipped — ${t.docLabel || "document"} not available yet`, {});
    setConfirm(null);
    advance();
  }

  // ── Persistence ──
  // Silent background write of the accumulated form (any order — no step advance,
  // no status change) so a close/refresh keeps everything gathered so far. The
  // update-fields route filters to its column allow-list.
  async function persistForm(f: Form) {
    if (!appId) return;
    try {
      await fetch(`/api/admin/loan-app/${appId}/update-fields`, { method: "PATCH", headers: hdr(), body: JSON.stringify(f) });
    } catch { /* best-effort */ }
  }

  // Direct column write used by edit mode. Returns false on error (keeps the RM
  // on the same turn so nothing is silently lost).
  async function patchFields(obj: Record<string, unknown>): Promise<boolean> {
    if (!appId) return true;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/loan-app/${appId}/update-fields`, { method: "PATCH", headers: hdr(), body: JSON.stringify(obj) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't save the change."); return false; }
      return true;
    } finally { setBusy(false); }
  }

  // Step 5 → save config → submit (step 6) unless something's missing → draft.
  async function finishLoanConfig() {
    if (!appId || tenure == null) { setError("Pick a tenure to continue."); return; }
    setBusy(true); setError(null);
    try {
      const central = subsidyCase === "non_subsidy" ? 0 : Math.max(0, Math.min(78000, Number(centralSub) || 0));
      const stateS = subsidyCase === "non_subsidy" ? 0 : Math.max(0, Number(stateSub) || 0);
      const loan = Number(form.loan_amount_required) || 0;
      const principal = Math.max(0, loan - central - stateS);
      const monthly = computeEmi(loan, DEFAULT_INDICATIVE_ROI, tenure);
      const subEmi = computeEmi(principal, DEFAULT_INDICATIVE_ROI, tenure);
      if (editMode) {
        const ok = await patchFields({ roi_percent: DEFAULT_INDICATIVE_ROI, central_subsidy: central, state_subsidy: stateS, selected_tenure_years: tenure, selected_monthly_emi: monthly, selected_subsidy_emi: subEmi });
        if (!ok) { setBusy(false); return; }
        pushUser("Save changes", {});
        say("bot", "Changes saved — the profile is up to date.");
        setDonId(appId); setBusy(false); return;
      }
      // Walk the server steps in order — records consent + advances current_step.
      // update-fields already wrote the columns during the flow; these confirm.
      for (const step of [1, 2, 3, 4] as const) {
        const method = step === 1 ? "PATCH" : "POST";
        const r = await fetch(`/api/admin/loan-app/${appId}/complete-step-${step}`, { method, headers: hdr(), body: JSON.stringify(STEP_PAYLOAD[step](form)) });
        const jj = await r.json().catch(() => ({}));
        if (!r.ok || !jj?.ok) { setError(jj?.error || `Couldn't save step ${step}.`); setBusy(false); return; }
      }
      const r5 = await fetch(`/api/admin/loan-app/${appId}/complete-step-5`, { method: "POST", headers: hdr(), body: JSON.stringify({
        roi_percent: DEFAULT_INDICATIVE_ROI, central_subsidy: central, state_subsidy: stateS,
        selected_tenure_years: tenure, selected_monthly_emi: monthly, selected_subsidy_emi: subEmi,
      }) });
      const j5 = await r5.json().catch(() => ({}));
      if (!r5.ok || !j5?.ok) { setError(j5?.error || "Couldn't save loan configuration."); setBusy(false); return; }

      if (missing.length > 0) {
        // Something required was skipped → keep it as a draft to finish later.
        pushUser("Create the application", {});
        say("bot", `Saved to your applications table as a draft — still pending: ${missing.join(", ")}. Open it anytime from the table to add what's left.`);
        setDonDraft(true); setDonId(appId); setBusy(false); return;
      }
      const r6 = await fetch(`/api/admin/loan-app/${appId}/complete-step-6`, { method: "POST", headers: hdr(), body: JSON.stringify({}) });
      const j6 = await r6.json().catch(() => ({}));
      if (!r6.ok || !j6?.ok) { setError(j6?.error || "Couldn't submit the application."); setBusy(false); return; }
      pushUser("Create the application", {});
      say("bot", "All done — the profile is ready and now in your applications table. You can open it to review or edit anytime.");
      setDonId(appId);
    } finally { setBusy(false); }
  }
  function say(from: "bot" | "user", text: string) { setMsgs((m) => [...m, { id: uid(), from, text, time: nowLabel() }]); }

  // Name check → decides whether a co-applicant is required. Compares the PAN
  // and Aadhaar names (same person?), then the applicant's first name against
  // the e-bill owner's: match → co-applicant optional; different → mandatory.
  function runNameCheck() {
    const fn = (s?: string) => (s || "").trim().toLowerCase().split(/\s+/)[0] || "";
    const panName = form._pan_name || "";
    const aadhaarName = form.aadhaar_name || form.borrower_name || "";
    const ebillName = form.ebill_name || "";
    const idName = aadhaarName || panName;

    if (panName && aadhaarName && fn(panName) !== fn(aadhaarName)) {
      say("bot", `⚠️ The PAN name (“${panName}”) and the Aadhaar name (“${aadhaarName}”) look different — please double-check it's the same person.`);
    }

    let mode: "optional" | "mandatory";
    if (!ebillName || !idName) {
      mode = "optional";
      say("bot", "I couldn't read the electricity-bill owner's name to compare, so a co-applicant is optional.");
    } else if (fn(idName) === fn(ebillName)) {
      mode = "optional";
      say("bot", `✓ “${idName}” matches the electricity-bill owner — a co-applicant is optional.`);
    } else {
      mode = "mandatory";
      say("bot", `Note: the electricity bill is in a different name (“${ebillName}”) than the applicant (“${idName}”) — a co-applicant is recommended. I'll ask next.`);
    }

    // Only record the advisory mode. Whether there's actually a co-applicant is
    // decided by the explicit "Is there a co-applicant?" question — never forced.
    setForm((f) => ({ ...f, _coapp_mode: mode }));
    void persistForm({ ...form, _coapp_mode: mode });
    advance();
  }

  // ── Edit-in-chat Q1/Q2 ──
  function startFlow(stage: "selected" | "complete") { setEditStage(stage); setEditStep("flow"); setIdx(1); }
  function answerQ1(yes: boolean) {
    pushUser(yes ? "Yes — edit some details" : "No", {});
    if (yes) { setPickSel([]); setEditStep("pick"); return; }
    if (!isProfileComplete(form)) setEditStep("q2");
    else { say("bot", "Your profile is already completed — nothing pending."); setDonId(appId); setEditStep("done"); }
  }
  function answerQ2(yes: boolean) {
    pushUser(yes ? "Yes — complete it" : "No, later", {});
    if (yes) startFlow("complete");
    else { say("bot", "Okay — your changes are saved. You can finish it anytime."); setDonId(appId); setEditStep("done"); }
  }
  function editSelected() {
    if (!pickSel.length) return;
    const labels = editableFilled(form);
    pushUser(`Edit: ${pickSel.map((id) => labels.find((e) => e.id === id)?.label || id).join(", ")}`, {});
    setEditTargets(new Set(pickSel));
    startFlow("selected");
  }

  // Edit a value the OCR fetched (from the permanent card) — reflects on the
  // profile immediately and updates what the card shows.
  function saveFetchedField(msgId: string, field: string, value: string) {
    const nextForm = { ...form, [field]: value };
    setForm(nextForm);
    void persistForm(nextForm);
    setMsgs((m) => m.map((x) => (x.id === msgId ? { ...x, fetched: x.fetched!.map((ff) => (ff.field === field ? { ...ff, value, ok: !!value } : ff)) } : x)));
  }

  // Unregistered EPC → switch to lead capture. A full application needs a
  // registered, lender-approved EPC, so we collect a short lead instead.
  function startLead(name: string) {
    pushUndo();
    pushUser(name, {});
    merge({ epc_name_custom: name });
    say("bot", `“${name}” isn't a registered partner yet, so I'll save this as a lead — just a few quick details. It'll be in your Lead tab to convert into a full application once they're approved.`);
    setLeadMode(true);
    setIdx(0);
  }

  async function createLead() {
    if (leadDoneId) return;
    setBusy(true); setError(null);
    try {
      const meId = getBusiness()?.id ?? null;
      const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
      const row: Record<string, unknown> = {
        status: "under_review",
        current_step: 2,
        name: form.lead_name || null,
        mobile: form.lead_mobile || null,
        email: form.lead_email || null,
        address: form.lead_address || null,
        loan_amount: form.lead_loan_amount ? num(form.lead_loan_amount) : null,
        project_size: form.lead_project_size ? num(form.lead_project_size) : null,
        project_size_unit: "kw",
        epc_name_custom: form.epc_name_custom || null,
        ...(meId ? { created_by_user_id: meId, assigned_to_user_id: meId, last_updated_by_user_id: meId } : {}),
      };
      const { data, error } = await supabase().from("loan_leads").insert(row).select("id").single();
      if (error) { setError(error.message); setBusy(false); return; }
      say("bot", `Saved to your Leads. Once ${form.epc_name_custom || "this EPC"} is registered and approved by a lender, open the lead and convert it into a full application.`);
      setLeadDoneId((data as { id: string }).id);
    } finally { setBusy(false); }
  }

  const progress = Math.min(100, Math.round((idx / script.length) * 100));
  const showEditIntro = editMode && (editStep === "q1" || editStep === "pick" || editStep === "q2");
  const showDock = !donId && !leadDoneId && !showEditIntro && active && !confirm && active.kind !== "save" && active.kind !== "leadsave" && active.kind !== "namecheck" && (editing ? true : turn === active);

  if (resuming) {
    return (
      <div className="h-screen grid place-items-center" style={CANVAS_STYLE}>
        <div className="flex flex-col items-center gap-3 text-[#0f3d2e]">
          <div className="w-10 h-10 rounded-full border-2 border-[#178a5c]/30 border-t-[#178a5c] animate-spin" />
          <div className="text-[13px]">Restoring your chat…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={CANVAS_STYLE}>
      {/* Chat header */}
      <header className="shrink-0 px-3 sm:px-5 py-2.5 bg-[#0f3d2e] text-white flex items-center gap-3 shadow-sm">
        <button onClick={() => router.push("/admin")} className="p-1 -ml-1 text-white/80 hover:text-white text-[20px] leading-none">←</button>
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#2fbd82] to-[#0f3d2e] ring-2 ring-white/15 flex items-center justify-center font-display font-bold text-[15px]">CC</div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[15px] leading-tight truncate">Capital Craft · {leadMode ? "New lead" : editMode ? "Edit profile" : "New application"}</div>
          <div className="text-[11.5px] text-white/70 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5df2ad]" /> {leadMode ? "capturing a lead" : editMode ? "completing the profile" : "building the profile"}
          </div>
        </div>
        <span className="text-[11px] text-white/60 tabular-nums">{progress}%</span>
        <button onClick={undo} disabled={!undoStack.length || !!donId || !!leadDoneId} className="w-8 h-8 rounded-full hover:bg-white/10 grid place-items-center text-white/80 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent text-[17px] leading-none" aria-label="Undo last" title="Undo last">↶</button>
        <button onClick={() => void closeChat()} className="w-8 h-8 -mr-1 rounded-full hover:bg-white/10 grid place-items-center text-white/80 hover:text-white text-[18px] leading-none" aria-label="Close chat" title="Close">✕</button>
      </header>
      <div className="h-0.5 bg-black/10 shrink-0"><div className="h-0.5 bg-[#5df2ad] transition-all duration-500" style={{ width: progress + "%" }} /></div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4">
        <div className="max-w-xl mx-auto py-4 flex flex-col gap-1.5">
          <DateChip label={todayLabel()} />

          {msgs.map((m) => m.fetched
            ? <FetchedCard key={m.id} m={m} onSave={saveFetchedField} />
            : <MessageRow key={m.id} m={m} rmName={rmName} onEdit={() => startEdit(m)} editingId={editing ? msgs[editing.index]?.id : null} />
          )}

          {busy && <TypingBubble />}

          {/* Read-from-document card */}
          {confirm && (
            <div className="self-start w-full max-w-[88%] rounded-2xl rounded-tl-md border border-[#cdeadd] bg-white shadow-sm overflow-hidden">
              <div className="px-3.5 py-2 bg-[#f0faf5] border-b border-[#e0f0e8] flex items-center gap-2">
                <span className="text-[12px]">📄</span>
                <span className="text-[12.5px] font-semibold text-[#0f3d2e]">Read from the document</span>
              </div>
              {confirm.thumbs.some(Boolean) && (
                <div className="px-3.5 pt-3 flex gap-2">
                  {confirm.thumbs.filter(Boolean).map((t, i) => (
                    <img key={i} src={t as string} alt="" className="w-14 h-14 rounded-lg object-cover border border-line" />
                  ))}
                </div>
              )}
              <div className="p-3.5 flex flex-col gap-1.5">
                {confirm.fields.map((f, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-text-muted shrink-0">{f.label}</span>
                    {f.ok
                      ? <span className="text-text font-medium text-right break-words">{f.value}</span>
                      : <span className="text-amber-600 text-[12px] italic">not found</span>}
                  </div>
                ))}
                <p className="text-[11.5px] text-text-muted mt-1.5 leading-snug">{confirm.note}</p>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  <button onClick={() => { const c = confirm; if (c) setMsgs((m) => [...m, { id: uid(), from: "bot", time: nowLabel(), fetched: c.fields }]); const wasEdit = c?.edit; setConfirm(null); if (wasEdit) setEditing(null); else advance(); }} className="px-3.5 py-1.5 rounded-lg bg-[#178a5c] text-white text-[12.5px] font-semibold hover:bg-[#12734c]">Looks good →</button>
                  <button onClick={retryDocs} className="px-3 py-1.5 rounded-lg border border-line text-[12.5px] text-text-mid hover:bg-bg-soft">Re-attach</button>
                </div>
              </div>
            </div>
          )}

          {error && <div className="self-center text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 my-1">{error}</div>}

          {editMode && !donId && !turn && !resuming && (
            <div className="self-stretch mt-3 flex flex-col items-center gap-2">
              <div className="text-[13px] text-text-mid text-center">All set — the profile is up to date.</div>
              <button onClick={() => router.push(`/admin/app/${appId}/view`)} className="px-5 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold shadow-sm hover:bg-[#12734c]">Open the profile →</button>
            </div>
          )}

          {leadDoneId && (
            <div className="self-stretch mt-3 flex flex-col items-center gap-2">
              <div className="text-[13px] text-text-mid text-center">✓ Lead saved — it's in your Lead tab.</div>
              <button onClick={() => router.push(`/admin/lead/${leadDoneId}/view`)} className="px-5 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold shadow-sm hover:bg-[#12734c]">Open the lead →</button>
              <button onClick={() => router.push("/admin")} className="text-[12px] text-text-muted hover:text-text">Go to console</button>
            </div>
          )}

          {donId && (
            <div className="self-stretch mt-3 flex flex-col items-center gap-2">
              <div className="text-[13px] text-text-mid text-center">{donDraft ? "Draft saved — the profile is in your applications table." : "✓ Profile is ready — it's in your applications table."}</div>
              <button onClick={() => router.push(`/admin/app/${donId}/view`)} className="px-5 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold shadow-sm hover:bg-[#12734c]">Open the profile →</button>
              <button onClick={() => router.push("/admin")} className="text-[12px] text-text-muted hover:text-text">Go to applications table</button>
            </div>
          )}
          <div className="h-2" />
        </div>
      </div>

      {/* Edit-in-chat intro: Q1 (edit filled?) → pick list → Q2 (complete?) */}
      {showEditIntro && (
        <div className="shrink-0 bg-white/85 backdrop-blur border-t border-line">
          <div className="max-w-xl mx-auto px-3 sm:px-4 py-3">
            {editStep === "q1" && (
              <div className="flex gap-2">
                <button onClick={() => answerQ1(true)} className="flex-1 px-4 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold hover:bg-[#12734c]">Yes — edit details</button>
                <button onClick={() => answerQ1(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid hover:bg-bg-soft">No</button>
              </div>
            )}
            {editStep === "pick" && (() => {
              const list = editableFilled(form);
              return (
                <div className="flex flex-col gap-2">
                  <div className="text-[12px] text-text-muted">{pickSel.length} selected</div>
                  {list.length === 0 ? (
                    <div className="text-[13px] text-text-muted py-2">Nothing has been filled in yet.</div>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-[38vh] overflow-y-auto">
                      {list.map((e) => {
                        const on = pickSel.includes(e.id);
                        return (
                          <button key={e.id} onClick={() => setPickSel((s) => (on ? s.filter((x) => x !== e.id) : [...s, e.id]))}
                            className={["px-3 py-1.5 rounded-full text-[13px] font-medium border capitalize transition", on ? "bg-[#178a5c] text-white border-[#178a5c]" : "bg-white border-line text-text-mid hover:border-[#178a5c]"].join(" ")}>
                            {on ? "✓ " : ""}{e.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-2 mt-1">
                    <button onClick={editSelected} disabled={!pickSel.length} className="px-4 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold disabled:opacity-50 hover:bg-[#12734c]">Edit selected →</button>
                    <button onClick={() => setEditStep("q1")} className="px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid">Back</button>
                  </div>
                </div>
              );
            })()}
            {editStep === "q2" && (
              <div className="flex gap-2">
                <button onClick={() => answerQ2(true)} className="flex-1 px-4 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold hover:bg-[#12734c]">Yes — complete it</button>
                <button onClick={() => answerQ2(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid hover:bg-bg-soft">No, later</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dock — the controls for the active question */}
      {showDock && active && (
        <div className="shrink-0 bg-white/85 backdrop-blur border-t border-line">
          <div className="max-w-xl mx-auto px-3 sm:px-4 py-3">
            {editing && (
              <div className="flex items-center justify-between mb-2 text-[12px]">
                <span className="text-[#178a5c] font-semibold">Editing your answer</span>
                <button onClick={cancelEdit} className="text-text-muted hover:text-text">Cancel</button>
              </div>
            )}

            {active.kind === "epc" && (
              <div className="flex flex-col gap-2">
                {/* The list is hidden behind the "EPCs list" button and opens
                    UPWARD (dropup). Inside: a search that also lets you type a
                    brand-new EPC name (→ captured as a lead). */}
                {epcOpen && (
                  <div className="rounded-2xl border border-line bg-white shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-line">
                      <input autoFocus value={epcSearch} onChange={(e) => setEpcSearch(e.target.value)} placeholder="Search, or type a new EPC name…" className="w-full border border-line rounded-lg px-3 py-2 text-[14px] bg-white focus:outline-none focus:border-[#178a5c]" />
                    </div>
                    <div className="max-h-[38vh] overflow-y-auto flex flex-col">
                      {epcs.length === 0 ? (
                        <div className="text-[13px] text-text-muted px-3 py-3">Loading partners…</div>
                      ) : filteredEpcs.length === 0 ? (
                        <div className="text-[13px] text-text-muted px-3 py-3">No approved EPC matches “{epcSearch.trim()}”.</div>
                      ) : filteredEpcs.map((e) => (
                        <button key={e.value} onClick={() => void answer(e.value, e.label, { createApp: true, editable: true })} className="text-left px-4 py-2.5 border-b border-line/60 last:border-0 hover:bg-[#f7fcf9] transition">
                          <div className="text-[14px] font-semibold text-text">{e.label}</div>{e.sub && <div className="text-[12px] text-text-muted font-mono">{e.sub}</div>}
                        </button>
                      ))}
                      {epcSearch.trim() && (
                        <button onClick={() => startLead(epcSearch.trim())} className="text-left px-4 py-2.5 bg-[#f7fcf9] hover:bg-[#eef8f2] transition border-t border-line">
                          <span className="text-[13px] font-semibold text-[#0f3d2e]">+ Use “{epcSearch.trim()}”</span>
                          <span className="block text-[11px] text-text-muted">Not a registered partner — saved to your Leads to convert later.</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {/* Dropup trigger */}
                <button onClick={() => setEpcOpen((o) => !o)} className="flex items-center justify-between px-4 py-3 rounded-full border border-[#178a5c] bg-white text-[14px] font-semibold text-[#0f3d2e] hover:bg-[#f7fcf9] transition">
                  <span>EPCs list</span>
                  <span className="text-[12px] text-[#178a5c]">{epcOpen ? "▾" : "▴"}</span>
                </button>
                {/* Locked composer — the chat opens only after an EPC is chosen. */}
                <div className="rounded-full border border-line bg-bg-soft px-4 py-2.5 text-[13px] text-text-muted select-none">Please select an EPC first</div>
              </div>
            )}

            {active.kind === "choice" && (
              <div className="grid sm:grid-cols-2 gap-2">
                {active.choices!.map((c) => (
                  <button key={c.value} onClick={() => void answer(c.value, c.label, { editable: true })} className="text-left px-4 py-3 rounded-xl border border-line bg-white hover:border-[#178a5c] hover:bg-[#f7fcf9] transition">
                    <div className="text-[14px] font-semibold text-text">{c.label}</div>{c.sub && <div className="text-[12px] text-text-muted">{c.sub}</div>}
                  </button>
                ))}
              </div>
            )}

            {(active.kind === "text" || active.kind === "pincode") && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input ref={inputRef} autoFocus value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void (active.kind === "pincode" ? submitPincode() : submitText()); if (e.key === "Escape" && editing) cancelEdit(); }}
                    placeholder={active.placeholder || "Type a message…"} className="flex-1 border border-line rounded-full px-4 py-2.5 text-[14px] bg-white focus:outline-none focus:border-[#178a5c] focus:ring-2 focus:ring-[#178a5c]/15" />
                  {!editing && <button onClick={() => void skipText()} className="px-3 py-2.5 text-[13px] text-text-muted hover:text-text whitespace-nowrap" title="Continue without this — you can add it later">{active.optional ? "Skip" : "Don't have it"}</button>}
                  <button onClick={() => void (active.kind === "pincode" ? submitPincode() : submitText())} className="w-11 h-11 shrink-0 rounded-full bg-[#178a5c] text-white grid place-items-center hover:bg-[#12734c] shadow-sm" aria-label="Send">
                    {editing ? "✓" : <SendIcon />}
                  </button>
                </div>
                {active.field && AMOUNT_FIELDS.has(active.field) && amountInWords(Number(input)) && (
                  <div className="text-[11.5px] text-[#0f3d2e] px-3">₹{Number(input).toLocaleString("en-IN")} — <span className="font-medium">{amountInWords(Number(input))} rupees</span></div>
                )}
              </div>
            )}

            {active.kind === "consent" && (
              <div className="flex gap-2">
                <button onClick={() => void answer("yes", "Yes, consent given")} className="flex-1 px-4 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold hover:bg-[#12734c]">Yes, consent given</button>
                <button onClick={() => router.push("/admin")} className="px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid">Cancel</button>
              </div>
            )}

            {active.kind === "docs" && (
              <DocDock active={active} files={files} thumbs={thumbs} onPick={setFileFor} onDrop={fillNextSlot} onClear={clearFileFor} onRun={() => void runDocs()} onSkip={skipDoc} replacing={!!editing} />
            )}

            {active.kind === "loanconfig" && (
              <LoanConfigDock loanAmt={loanAmt} subsidyCase={subsidyCase} setSubsidyCase={setSubsidyCase}
                centralSub={centralSub} setCentralSub={setCentralSub} stateSub={stateSub} setStateSub={setStateSub}
                tenure={tenure} setTenure={setTenure} onFinish={() => void finishLoanConfig()} finishLabel={editMode ? "Save changes" : "Create application →"} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Presentational pieces ──

// A permanent "read from the document" card that stays in the chat. Every
// fetched value with a form-field key is editable inline; nothing is masked
// except the Aadhaar number (the OCR backend never returns the full digits).
function FetchedCard({ m, onSave }: { m: Msg; onSave: (msgId: string, field: string, value: string) => void }) {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [val, setVal] = useState("");
  return (
    <div className="self-start w-full max-w-[88%] rounded-2xl rounded-tl-md border border-[#cdeadd] bg-white shadow-sm overflow-hidden">
      <div className="px-3.5 py-2 bg-[#f0faf5] border-b border-[#e0f0e8] flex items-center gap-2">
        <span className="text-[12px]">📄</span>
        <span className="text-[12.5px] font-semibold text-[#0f3d2e]">Read from the document</span>
      </div>
      <div className="p-3.5 flex flex-col gap-2">
        {(m.fetched ?? []).map((f, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-[13px] min-h-[24px]">
            <span className="text-text-muted shrink-0">{f.label}</span>
            {editKey === f.field && f.field ? (
              <span className="flex items-center gap-1.5">
                <input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { onSave(m.id, f.field!, val.trim()); setEditKey(null); } if (e.key === "Escape") setEditKey(null); }}
                  className="border border-[#178a5c] rounded-lg px-2.5 py-1 text-[13px] w-44 text-right outline-none" />
                <button onClick={() => { onSave(m.id, f.field!, val.trim()); setEditKey(null); }} className="text-[#178a5c] text-[12px] font-semibold">Save</button>
              </span>
            ) : (
              <span className="flex items-center gap-2 min-w-0">
                {f.ok
                  ? <span className="text-text font-medium text-right break-words">{f.value}</span>
                  : <span className="text-amber-600 text-[12px] italic">not found</span>}
                {f.field && (
                  <button onClick={() => { setEditKey(f.field!); setVal(f.ok ? f.value : ""); }} className="opacity-60 hover:opacity-100 text-[#178a5c] text-[11px] hover:underline shrink-0" aria-label="Edit">✎</button>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DateChip({ label }: { label: string }) {
  return (
    <div className="self-center my-2">
      <span className="text-[11px] text-[#0f3d2e]/70 bg-white/70 rounded-full px-3 py-1 shadow-sm">{label}</span>
    </div>
  );
}

function MessageRow({ m, rmName, onEdit, editingId }: { m: Msg; rmName: string; onEdit: () => void; editingId: string | null }) {
  const isUser = m.from === "user";
  const beingEdited = editingId === m.id;
  return (
    <div className={["group flex flex-col max-w-[82%]", isUser ? "self-end items-end" : "self-start items-start"].join(" ")}>
      <div className={["relative px-3.5 py-2 rounded-2xl text-[14px] leading-snug shadow-sm break-words whitespace-pre-wrap w-fit max-w-full",
        isUser ? "bg-[#178a5c] text-white rounded-br-md" : "bg-white text-[#12271f] rounded-bl-md border border-black/5",
        beingEdited ? "ring-2 ring-[#5df2ad]" : ""].join(" ")}>
        {/* document receipt */}
        {m.files ? (
          <div className="flex flex-col gap-1.5">
            {m.files.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                {f.thumb ? <img src={f.thumb} alt="" className="w-10 h-10 rounded-md object-cover" />
                  : <span className="w-10 h-10 rounded-md bg-white/20 grid place-items-center text-[16px]">📎</span>}
                <span className="text-[13px] break-all">{f.name}</span>
              </div>
            ))}
          </div>
        ) : m.text}
      </div>
      <div className={["flex items-center gap-1.5 mt-0.5 px-1 text-[10.5px]", isUser ? "text-[#0f3d2e]/60 flex-row-reverse" : "text-text-muted"].join(" ")}>
        <span className="font-medium">{isUser ? rmName : "Capital Craft"}</span>
        <span>· {m.time}</span>
        {m.edited && <span>· edited</span>}
        {isUser && !m.files && <span className="text-[#178a5c]">✓✓</span>}
        {isUser && (m.editable || m.turnId === "epc") && (
          <button onClick={onEdit} className="opacity-0 group-hover:opacity-100 transition text-[#178a5c] hover:underline" aria-label="Edit">{m.files ? "↺ replace" : "✎ edit"}</button>
        )}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="self-start">
      <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-white border border-black/5 shadow-sm inline-flex gap-1">
        <Dot d="0" /><Dot d="150" /><Dot d="300" />
      </div>
    </div>
  );
}
function Dot({ d }: { d: string }) {
  return <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 animate-bounce" style={{ animationDelay: d + "ms" }} />;
}
function SendIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12l16-8-6 16-2.5-6.5L4 12z" fill="currentColor" /></svg>;
}

function DocDock({ active, files, thumbs, onPick, onDrop, onClear, onRun, onSkip, replacing }: {
  active: Turn; files: Record<string, File>; thumbs: Record<string, string | null>;
  onPick: (name: string, f: File) => void; onDrop: (f: File) => void; onClear: (name: string) => void; onRun: () => void; onSkip: () => void; replacing?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onDrop(f); }}
        className={["rounded-xl border-2 border-dashed p-2.5 transition", drag ? "border-[#178a5c] bg-[#f0faf5]" : "border-line bg-white"].join(" ")}
      >
        <div className="grid gap-2" style={{ gridTemplateColumns: (active.uploads?.length || 1) > 1 ? "1fr 1fr" : "1fr" }}>
          {active.uploads!.map((u) => {
            const has = !!files[u.name];
            return (
              <label key={u.name} className={["relative flex items-center gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition", has ? "border-[#178a5c] bg-[#f7fcf9]" : "border-line bg-white hover:border-[#178a5c]/50"].join(" ")}>
                {has && thumbs[u.name]
                  ? <img src={thumbs[u.name] as string} alt="" className="w-9 h-9 rounded-md object-cover" />
                  : <span className="w-9 h-9 rounded-md bg-bg-soft grid place-items-center text-[15px]">{has ? "📄" : "＋"}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-text truncate">{u.label}</span>
                  <span className="block text-[11px] text-text-muted truncate">{has ? files[u.name].name : "Tap, drop, or paste"}</span>
                </span>
                {has
                  ? <button type="button" onClick={(e) => { e.preventDefault(); onClear(u.name); }} className="text-text-muted hover:text-red-500 text-[15px] leading-none px-1">×</button>
                  : <span className="text-[#178a5c] text-[12px] font-semibold">Add</span>}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(u.name, f); }} />
              </label>
            );
          })}
        </div>
        <div className="text-[11px] text-text-muted mt-2 px-0.5">Attach by tapping, dragging a file in, or pasting a copied image (Ctrl+V).</div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onRun} className="px-4 py-2 rounded-lg bg-[#178a5c] text-white text-[13px] font-semibold hover:bg-[#12734c]">{replacing ? "Re-read & replace" : `Read ${active.extractRoute ? "document" : "& attach"}`}</button>
        {!replacing && <button onClick={onSkip} className="px-3 py-2 rounded-lg text-[12.5px] text-text-muted hover:text-text hover:bg-bg-soft">Don't have it — skip</button>}
      </div>
    </div>
  );
}

function LoanConfigDock({ loanAmt, subsidyCase, setSubsidyCase, centralSub, setCentralSub, stateSub, setStateSub, tenure, setTenure, onFinish, finishLabel }: {
  loanAmt: number; subsidyCase: "subsidy" | "non_subsidy"; setSubsidyCase: (s: "subsidy" | "non_subsidy") => void;
  centralSub: string; setCentralSub: (s: string) => void; stateSub: string; setStateSub: (s: string) => void;
  tenure: number | null; setTenure: (n: number) => void; onFinish: () => void; finishLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 max-h-[52vh] overflow-y-auto pr-0.5">
      <div>
        <div className="text-[12px] text-text-muted mb-1">Subsidy case</div>
        <div className="flex gap-2">
          {(["subsidy", "non_subsidy"] as const).map((s) => (
            <button key={s} onClick={() => setSubsidyCase(s)} className={["px-3 py-1.5 rounded-lg text-[13px] font-semibold border", subsidyCase === s ? "bg-[#178a5c] text-white border-[#178a5c]" : "bg-white border-line text-text-mid"].join(" ")}>{s === "subsidy" ? "Subsidy" : "Non-subsidy"}</button>
          ))}
        </div>
      </div>
      {subsidyCase === "subsidy" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[12px] text-text-muted">Central subsidy (₹)
            <input value={centralSub} onChange={(e) => setCentralSub(e.target.value.replace(/[^\d]/g, ""))} className="mt-1 w-full border border-line rounded-lg px-2 py-1.5 text-[13px]" /></label>
          <label className="text-[12px] text-text-muted">State subsidy (₹)
            <input value={stateSub} onChange={(e) => setStateSub(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className="mt-1 w-full border border-line rounded-lg px-2 py-1.5 text-[13px]" /></label>
        </div>
      )}
      <div>
        <div className="text-[12px] text-text-muted mb-1">Tenure — live EMI on ₹{loanAmt.toLocaleString("en-IN")}</div>
        <div className="grid grid-cols-5 gap-1.5">
          {TENURES.map((t) => (
            <button key={t} onClick={() => setTenure(t)} className={["px-1 py-2 rounded-lg text-center border", tenure === t ? "bg-[#178a5c] text-white border-[#178a5c]" : "bg-white border-line text-text-mid"].join(" ")}>
              <div className="text-[13px] font-bold">{t}y</div>
              <div className="text-[10px] opacity-80">{loanAmt > 0 ? formatRupees(computeEmi(loanAmt, DEFAULT_INDICATIVE_ROI, t)) : "—"}</div>
            </button>
          ))}
        </div>
      </div>
      <button onClick={onFinish} disabled={tenure == null} className="mt-1 px-4 py-2.5 rounded-lg bg-[#178a5c] text-white text-[14px] font-semibold disabled:opacity-60 hover:bg-[#12734c]">{finishLabel}</button>
    </div>
  );
}

function fieldLabel(t: Turn): string {
  return t.placeholder || t.field || "detail";
}

// Fields where we show the typed amount in words (Indian format) for confirmation.
const AMOUNT_FIELDS = new Set(["loan_amount_required", "annual_income", "total_project_cost", "monthly_bill_amount", "lead_loan_amount"]);

// Integer → Indian words (lakh / crore). Empty for non-positive / invalid.
function amountInWords(num: number): string {
  if (!Number.isFinite(num) || num <= 0) return "";
  num = Math.floor(num);
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number): string => (n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : ""));
  const three = (n: number): string => { const h = Math.floor(n / 100), r = n % 100; return (h ? a[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : ""); };
  let res = "";
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  if (crore) res += three(crore) + " Crore ";
  if (lakh) res += two(lakh) + " Lakh ";
  if (thousand) res += two(thousand) + " Thousand ";
  if (num) res += three(num);
  return res.trim();
}

// The path column(s) that make a document turn "already present" in edit mode.
const DOC_PATHS: Record<string, string[]> = {
  pan: ["borrower_pan"],
  aadhaar: ["aadhaar_front_path", "aadhaar_back_path"],
  selfie: ["customer_photo_path"],
  ebill: ["ebill_path"],
  quotation: ["proforma_invoice_path"],
  rooftop: ["rooftop_photo_path"],
  coapp_pan: ["coapp_pan_path"],
  coapp_aadhaar: ["coapp_aadhaar_front_path", "coapp_aadhaar_back_path"],
  bank: ["bank_statement_path"],
};

// Is this turn's data already on the profile? Drives edit mode's "ask only
// what's missing" — filled turns are skipped.
function isTurnFilled(t: Turn, f: Form): boolean {
  if (t.kind === "epc" || t.kind === "consent" || t.kind === "namecheck") return true; // never re-ask in edit
  if (t.kind === "docs") { const keys = DOC_PATHS[t.id] || []; return keys.length > 0 && keys.every((k) => !!(f[k] && String(f[k]).trim())); }
  if (t.kind === "loanconfig") return !!(f.selected_tenure_years && String(f.selected_tenure_years).trim());
  if (t.field) return !!(f[t.field] && String(f[t.field]).trim());
  return false;
}

// A turn the RM can fill/edit (drives the edit "pick" list + completeness).
function isEditableTurn(t: Turn): boolean {
  return t.kind === "text" || t.kind === "pincode" || t.kind === "choice" || t.kind === "docs" || t.kind === "loanconfig";
}
// Every required (non-optional, applicable) detail is present.
function isProfileComplete(f: Form): boolean {
  return SCRIPT.every((t) => {
    if (t.optional) return true;
    if (t.when && !t.when(f)) return true;
    return isEditableTurn(t) ? isTurnFilled(t, f) : true;
  });
}
// The already-filled details, for the multi-select edit list.
function editableFilled(f: Form): { id: string; label: string }[] {
  return SCRIPT.filter((t) => isEditableTurn(t) && (!t.when || t.when(f)) && isTurnFilled(t, f))
    .map((t) => ({ id: t.id, label: t.docLabel || t.placeholder || (t.field ? t.field.replace(/_/g, " ") : t.id) }));
}

// Map an existing application row → the chat's form field map (all strings;
// the boolean e-bill flag becomes "yes"/"no").
const PREFILL_KEYS = [
  "borrower_name", "borrower_mobile", "borrower_email", "lead_owner_name", "install_pincode", "install_state", "install_district", "install_city", "system_type", "plant_use_type",
  "aadhaar_name", "aadhaar_dob", "aadhaar_gender", "aadhaar_number", "aadhaar_care_of", "aadhaar_address", "aadhaar_front_path", "aadhaar_back_path", "aadhaar_face_path",
  "project_size", "project_size_unit", "total_project_cost", "loan_amount_required", "monthly_bill_amount", "discom_name", "ca_number", "ebill_address_line", "ebill_name", "ebill_path", "ebill_uploaded_at", "proforma_invoice_path", "proforma_uploaded_at", "rooftop_photo_path", "rooftop_photo_uploaded_at",
  "coapp_name", "coapp_father_name", "coapp_dob", "coapp_pan", "coapp_pan_path", "coapp_relation", "coapp_aadhaar_name", "coapp_aadhaar_dob", "coapp_aadhaar_gender", "coapp_aadhaar_number", "coapp_aadhaar_care_of", "coapp_aadhaar_address", "coapp_aadhaar_front_path", "coapp_aadhaar_back_path", "coapp_aadhaar_face_path",
  "employment_type", "profession", "profession_other", "organization_name", "annual_income", "bank_statement_method", "bank_statement_path", "bank_statement_uploaded_at", "bank_account_holder", "bank_name", "bank_account_no", "bank_ifsc", "bank_account_type", "bank_mobile", "bank_email",
  "central_subsidy", "state_subsidy", "roi_percent", "selected_tenure_years", "selected_monthly_emi", "selected_subsidy_emi",
];
function prefillFromApp(a: Record<string, any>): Form {
  const f: Form = {};
  for (const k of PREFILL_KEYS) if (a[k] != null && a[k] !== "") f[k] = String(a[k]);
  if (a.bill_on_applicant_name === true) f.bill_on_applicant_name = "yes";
  else if (a.bill_on_applicant_name === false) { f.bill_on_applicant_name = "no"; f._has_coapp = "1"; }
  return f;
}

function kwOf(f: Form): number | null {
  const s = Number(f.project_size);
  if (!s) return null;
  return f.project_size_unit === "mw" ? s * 1000 : s;
}

// Map an extract route's JSON response → { form patch, fetched-field list }.
function mapExtract(turn: Turn, j: Record<string, any>): { patch: Form; fields: Fetched[] } {
  const coapp = turn.extraForm?._coapp === "1";
  const row = (label: string, value: any, field?: string): Fetched => {
    const v = value == null || value === "" ? "" : String(value);
    return { label, value: v, ok: !!v, field };
  };
  if (turn.extractRoute === "extract-aadhaar") {
    const f = j.fields ?? {}, p = j.storage_paths ?? {};
    if (coapp) return { patch: {
      // Store the FULL 12-digit number when OCR read it (epc_applications is
      // admin-only via RLS); fall back to the masked form only if OCR couldn't.
      coapp_aadhaar_name: f.name ?? "", coapp_aadhaar_dob: f.dob ?? "", coapp_aadhaar_gender: f.gender ?? "", coapp_aadhaar_number: f.aadhaar_number ?? f.aadhaar_masked ?? "",
      coapp_aadhaar_care_of: f.care_of ?? "", coapp_aadhaar_address: f.address ?? "",
      coapp_aadhaar_front_path: p.front ?? "", coapp_aadhaar_back_path: p.back ?? "", coapp_aadhaar_face_path: p.face ?? "",
      coapp_name: f.name ?? "", coapp_dob: f.dob ?? "",
    }, fields: [row("Name", f.name, "coapp_aadhaar_name"), row("DOB", f.dob, "coapp_aadhaar_dob"), row("Aadhaar", f.aadhaar_number ?? f.aadhaar_masked)] };
    return { patch: {
      // Store the FULL 12-digit number when OCR read it (epc_applications is
      // admin-only via RLS); fall back to the masked form only if OCR couldn't.
      aadhaar_name: f.name ?? "", aadhaar_dob: f.dob ?? "", aadhaar_gender: f.gender ?? "", aadhaar_number: f.aadhaar_number ?? f.aadhaar_masked ?? "",
      aadhaar_care_of: f.care_of ?? "", aadhaar_address: f.address ?? "",
      aadhaar_front_path: p.front ?? "", aadhaar_back_path: p.back ?? "", aadhaar_face_path: p.face ?? "",
      // Auto-fill the applicant identity so the RM doesn't type it (only when read).
      ...(f.name ? { borrower_name: f.name } : {}),
      ...(f.dob ? { borrower_dob: f.dob } : {}),
    }, fields: [row("Name", f.name, "borrower_name"), row("DOB", f.dob, "aadhaar_dob"), row("Gender", f.gender, "aadhaar_gender"), row("Aadhaar", f.aadhaar_number ?? f.aadhaar_masked), row("Address", f.address, "aadhaar_address")] };
  }
  if (turn.extractRoute === "extract-coapp-pan") {
    const f = j.fields ?? {};
    if (turn.applicantPan) {
      // Same PAN OCR, mapped to the APPLICANT.
      return { patch: {
        borrower_pan: f.pan ?? "",
        _pan_name: f.name ?? "", // transient — used by the name check (not persisted)
        ...(f.name ? { borrower_name: f.name } : {}),
        ...(f.father_name ? { borrower_father_name: f.father_name } : {}),
      }, fields: [row("PAN", f.pan, "borrower_pan"), row("Name", f.name, "borrower_name"), row("Father", f.father_name, "borrower_father_name")] };
    }
    return { patch: { coapp_pan: f.pan ?? "", coapp_name: f.name ?? "", coapp_father_name: f.father_name ?? "", coapp_dob: f.dob ?? "", coapp_pan_path: j.storage_path ?? "" },
      fields: [row("PAN", f.pan, "coapp_pan"), row("Name", f.name, "coapp_name"), row("Father", f.father_name, "coapp_father_name")] };
  }
  if (turn.extractRoute === "extract-loan-docs") {
    // The e-bill and the quotation are now separate turns, each calling this
    // route with a single file — so only map the part that was uploaded, never
    // overwriting the other's already-read values with blanks.
    const pf = j.proforma?.fields ?? {}, eb = j.ebill?.fields ?? {};
    const hasP = !!(j.proforma && (j.proforma.fields || j.proforma.storage_path));
    const hasE = !!(j.ebill && (j.ebill.fields || j.ebill.storage_path));
    const patch: Form = {};
    const fields: Fetched[] = [];
    if (hasP) {
      patch.project_size = pf.project_size != null ? String(pf.project_size) : "";
      patch.project_size_unit = pf.project_size_unit ?? "kw";
      patch.total_project_cost = pf.total_project_cost != null ? String(pf.total_project_cost) : "";
      patch.proforma_invoice_path = j.proforma?.storage_path ?? "";
      patch.proforma_uploaded_at = j.proforma?.uploaded_at ?? "";
      fields.push(row("System size", pf.project_size != null ? `${pf.project_size} ${pf.project_size_unit ?? "kW"}` : "", "project_size"));
      fields.push(row("Project cost", pf.total_project_cost != null ? `₹${Number(pf.total_project_cost).toLocaleString("en-IN")}` : "", "total_project_cost"));
    }
    if (hasE) {
      patch.monthly_bill_amount = eb.monthly_bill_amount != null ? String(eb.monthly_bill_amount) : "";
      patch.discom_name = eb.discom_name ?? "";
      patch.ca_number = eb.ca_number ?? "";
      patch.ebill_address_line = eb.ebill_address_line ?? "";
      patch.ebill_name = eb.ebill_name ?? "";
      patch.ebill_path = j.ebill?.storage_path ?? "";
      patch.ebill_uploaded_at = j.ebill?.uploaded_at ?? "";
      fields.push(row("Monthly bill", eb.monthly_bill_amount != null ? `₹${eb.monthly_bill_amount}` : "", "monthly_bill_amount"));
      fields.push(row("DISCOM", eb.discom_name, "discom_name"));
      fields.push(row("Bill name", eb.ebill_name, "ebill_name"));
    }
    return { patch, fields };
  }
  if (turn.extractRoute === "extract-bank-statement") {
    const f = j.fields ?? {};
    return { patch: {
      bank_statement_method: j.method ?? "manual_epdf", bank_statement_path: j.storage_path ?? "", bank_statement_uploaded_at: new Date().toISOString(),
      bank_account_holder: f.account_holder ?? "", bank_name: f.bank_name ?? "", bank_account_no: f.account_no ?? "", bank_ifsc: f.ifsc ?? "", bank_account_type: f.account_type ?? "", bank_mobile: f.mobile ?? "", bank_email: f.email ?? "",
    }, fields: [row("Holder", f.account_holder, "bank_account_holder"), row("Bank", f.bank_name, "bank_name"), row("A/C no.", f.account_no, "bank_account_no"), row("IFSC", f.ifsc, "bank_ifsc")] };
  }
  return { patch: {}, fields: [] };
}
