"use client";

// EPC onboarding chatbot — a premium, WhatsApp-style guided chat that builds a
// FULL EPC partner profile (the same six-step onboarding the classic wizard
// collects) and submits it for verification. It MIRRORS the loan intake chatbot
// (src/app/admin/app/intake/page.tsx): same canvas, bubbles, doc-upload turns,
// "Read from the document" OCR card, editable typed answers (✎), and the
// "Don't have it — skip" behaviour.
//
// Unlike the loan intake (which drives the loan wizard's create + complete-step
// routes), this writes epc_business columns DIRECTLY via the browser supabase()
// client — exactly how the admin EPC detail page edits an EPC — because the
// classic EPC onboarding is a set of direct per-step column writes. Documents
// are attached to the target EPC through /api/upload (admin-on-behalf, via the
// shared uploadDocument helper) and OCR'd with the existing routes
// (extractPan / extractGstLegalName / extract-cheque / extract-stakeholder).
//
// It's a scripted wizard, NOT an LLM.
//
// URL params:
//   ?mobile=<10-digit>   pre-fills the first turn (create a fresh EPC)
//   ?epc=<id>            resume / prefill an existing EPC (ask only what's missing)
//   ?epc=<id>&edit=1     same, with an "Edit profile" header

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getToken, getBusiness } from "@/lib/auth";
import { uploadDocument } from "@/lib/storage";
import { extractPan, extractGstLegalName } from "@/lib/ocr";
import FileUpload from "@/components/FileUpload";
import DateField from "@/components/ui/DateField";
import { MOBILE_RE, EMAIL_RE, PAN_RE, ACCOUNT_RE } from "@/lib/validators";

export default function EpcIntakePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

type Choice = { value: string; label: string; sub?: string };
type Form = Record<string, string>;

type Stakeholder = {
  id: string;
  name: string;
  designation: string;
  mobile: string;
  email: string;
  father_name: string;
  dob: string;
  aadhaar_number: string;
  aadhaar_address: string;
};
type Ref = { type: "customer" | "supplier"; name: string; mobile: string };

// A turn is one thing the chat asks/does. `when` gates conditional turns.
type Turn = {
  id: string;
  bot: string;
  kind: "mobile" | "text" | "choice" | "docs" | "confirmacct" | "stakeholders" | "references" | "submit";
  field?: string;      // form key (and, for text/choice, usually the epc_business column)
  filledBy?: string;   // which form key marks this turn "already filled" (edit-skip)
  placeholder?: string;
  optional?: boolean;
  choices?: Choice[];
  validate?: (v: string) => string | null;
  when?: (f: Form) => boolean;
  // Maps an answer → the epc_business column patch to write.
  write?: (v: string, f: Form) => Record<string, unknown>;
  // Step (1..7) reached once this turn completes — bumps current_step so an
  // abandoned profile lands on the board's "Doc Uploaded" column.
  step?: number;
  // docs turn:
  uploads?: { name: string; label: string; category: string }[];
  replace?: boolean;              // pass replace=true (unique-index categories)
  ocr?: "pan" | "gst" | "cheque"; // OCR run on the FIRST slot's file
  docLabel?: string;
  filledCats?: string[];          // categories that mark this doc turn present
};

const DESIGNATION_CHOICES: Choice[] = [
  { value: "Partner", label: "Partner" },
  { value: "Director", label: "Director" },
  { value: "Proprietor", label: "Proprietor" },
  { value: "Owner", label: "Owner" },
  { value: "Manager", label: "Manager" },
  { value: "Other", label: "Other" },
];
const BUSINESS_CHOICES: Choice[] = [
  { value: "proprietorship", label: "Proprietorship" },
  { value: "pvt_ltd", label: "Private Limited" },
  { value: "partnership", label: "Partnership" },
  { value: "llp", label: "LLP" },
];
const SURYA_CHOICES: Choice[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "other", label: "Other" },
];

function extraDocLabel(bt?: string): string | null {
  if (bt === "partnership") return "Partnership Deed";
  if (bt === "pvt_ltd") return "Certificate of Incorporation (COI)";
  if (bt === "llp") return "LLP Agreement";
  return null;
}

const SCRIPT: Turn[] = [
  // ── Create ──
  { id: "mobile", kind: "mobile", bot: "Let's onboard a new EPC partner. What's their 10-digit mobile number?", when: (f) => f._has_id !== "1" },

  // ── Step 1 · Identity ──
  { id: "contact_name", kind: "text", bot: "Who's the main point of contact? (first & last name)", field: "contact_name", placeholder: "Full name", step: 2,
    validate: (v) => (v.trim().length < 2 ? "Enter the contact's name." : null), write: (v) => ({ contact_name: v.trim() }) },
  { id: "contact_email", kind: "text", bot: "Their email ID?", field: "contact_email", placeholder: "name@example.com", step: 2,
    validate: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? null : "Enter a valid email or skip."), optional: true, write: (v) => ({ contact_email: v.trim() }) },
  { id: "contact_designation", kind: "choice", bot: "What's their designation?", field: "_designation_choice", filledBy: "contact_designation", choices: DESIGNATION_CHOICES, step: 2,
    write: (v) => (v === "Other" ? {} : { contact_designation: v }) },
  { id: "designation_other", kind: "text", bot: "Please specify the designation.", field: "contact_designation", placeholder: "e.g. CEO", step: 2,
    when: (f) => f._designation_choice === "Other", write: (v) => ({ contact_designation: v.trim() }) },

  // ── Step 2 · Business ──
  { id: "business_type", kind: "choice", bot: "What kind of business entity is it?", field: "business_type", choices: BUSINESS_CHOICES, step: 2,
    write: (v) => ({ business_type: v }) },
  { id: "pan_doc", kind: "docs", bot: "Upload the business PAN card — I'll read it.", docLabel: "Business PAN", step: 2,
    uploads: [{ name: "file", label: "PAN card", category: "pan_business" }], replace: true, ocr: "pan", filledCats: ["pan_business"] },
  { id: "pan_number", kind: "text", bot: "I couldn't read the PAN number — what is it?", field: "pan_number", placeholder: "ABCDE1234F", step: 2,
    when: (f) => !f.pan_number, validate: (v) => (PAN_RE.test(v.trim().toUpperCase()) ? null : "Invalid PAN (AAAAA9999A)."), write: (v) => ({ pan_number: v.trim().toUpperCase() }) },
  { id: "gst_doc", kind: "docs", bot: "Upload the GST registration certificate — I'll read the legal name, trade name, GSTIN & address.", docLabel: "GST certificate", step: 2,
    uploads: [{ name: "file", label: "GST certificate", category: "gstin" }], replace: true, ocr: "gst", filledCats: ["gstin"] },
  { id: "legal_name", kind: "text", bot: "Legal name of the business?", field: "legal_name", placeholder: "e.g. Acme Solar Pvt Ltd", step: 2,
    when: (f) => !f.legal_name, write: (v) => ({ legal_name: v.trim() }) },
  { id: "trade_name", kind: "text", bot: "Trade name?", field: "trade_name", placeholder: "e.g. Acme Solar", step: 2,
    when: (f) => !f.trade_name, write: (v) => ({ trade_name: v.trim() }) },
  { id: "gstin_number", kind: "text", bot: "GSTIN?", field: "gstin_number", placeholder: "08ATMPS8478D1ZY", step: 2,
    when: (f) => !f.gstin_number, validate: (v) => (!v.trim() || GSTIN_RE.test(v.trim().toUpperCase()) ? null : "Invalid GSTIN (15 chars)."), write: (v) => ({ gstin_number: v.trim().toUpperCase() }) },
  { id: "pm_surya_ghar", kind: "choice", bot: "Registered with PM Surya Ghar?", field: "pm_surya_ghar", filledBy: "pm_surya_ghar", choices: SURYA_CHOICES, step: 2,
    write: (v) => ({ pm_surya_ghar: v, ...(v !== "other" ? { pm_surya_ghar_other: null } : {}), ...(v !== "yes" ? { pm_surya_ghar_capacity: null } : {}) }) },
  { id: "pm_surya_ghar_other", kind: "text", bot: "Which entity are they registered with?", field: "pm_surya_ghar_other", placeholder: "Entity name", step: 2,
    when: (f) => f.pm_surya_ghar === "other", write: (v) => ({ pm_surya_ghar_other: v.trim() }) },
  { id: "pm_surya_ghar_capacity", kind: "text", bot: "How many installations under the PM Surya Ghar scheme? (optional)", field: "pm_surya_ghar_capacity", placeholder: "e.g. 25", optional: true, step: 2,
    when: (f) => f.pm_surya_ghar === "yes", write: (v) => ({ pm_surya_ghar_capacity: v.trim() || null }) },
  { id: "extra_doc", kind: "docs", bot: "", docLabel: "Entity document", optional: true, step: 2,
    uploads: [{ name: "file", label: "Entity document", category: "extra_doc" }], filledCats: ["extra_doc"], when: (f) => !!extraDocLabel(f.business_type) },

  // ── Step 3 · Stakeholders ──
  { id: "stakeholders", kind: "stakeholders", bot: "Now the people behind the business — add their details and upload each one's PAN & Aadhaar (I'll read them)." },

  // ── Step 4 · Bank ──
  { id: "cheque_doc", kind: "docs", bot: "Upload a cancelled cheque — I'll read the account number, IFSC & bank name.", docLabel: "Cancelled cheque", step: 5,
    uploads: [{ name: "file", label: "Cancelled cheque", category: "cancelled_cheque" }], replace: true, ocr: "cheque", filledCats: ["cancelled_cheque"] },
  { id: "confirm_acct", kind: "confirmacct", bot: "Please re-enter the bank account number to confirm it.", step: 5 },

  // ── Step 5 · Office verification ──
  { id: "office", kind: "docs", bot: "Three office photos: exterior (signboard visible), interior, and a selfie at the office.", docLabel: "Office photos", optional: true, step: 6,
    uploads: [
      { name: "office_exterior", label: "Exterior", category: "office_exterior" },
      { name: "office_interior", label: "Interior", category: "office_interior" },
      { name: "office_selfie", label: "Selfie at office", category: "office_selfie" },
    ], filledCats: ["office_exterior", "office_interior", "office_selfie"] },

  // ── Step 6 · References ──
  { id: "references", kind: "references", bot: "Almost done — add at least 2 customer and 2 supplier references." },

  // ── Submit ──
  { id: "submit", kind: "submit", bot: "That's everything. Ready to submit this EPC for verification?" },
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
  files?: { name: string; thumb: string | null }[];
  fetched?: Fetched[];
};

// Subtle branded doodle canvas (WhatsApp-style texture, in our green) — copied
// from the loan intake so the two chatbots are visually identical.
const DOODLE = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='104' height='104' viewBox='0 0 104 104'>
     <g fill='none' stroke='#0f3a66' stroke-opacity='0.045' stroke-width='1.4'>
       <circle cx='22' cy='24' r='7'/>
       <circle cx='78' cy='66' r='10'/>
       <path d='M74 18 v9 M69.5 22.5 h9'/>
       <path d='M14 78 q8 -10 16 0'/>
       <rect x='58' y='16' width='10' height='10' rx='2'/>
     </g>
     <g fill='#0f3a66' fill-opacity='0.045'>
       <circle cx='48' cy='50' r='1.8'/>
       <circle cx='92' cy='30' r='1.8'/>
       <circle cx='30' cy='96' r='1.8'/>
     </g>
   </svg>`,
);
const CANVAS_STYLE: React.CSSProperties = {
  backgroundColor: "#e9f1fb",
  backgroundImage: `url("data:image/svg+xml,${DOODLE}")`,
};

function nowLabel(): string {
  return new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
}
function todayLabel(): string {
  return "Today · " + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}
// "DD/MM/YYYY" or "YYYY-MM-DD" → ISO "YYYY-MM-DD"; anything else → "".
function toIsoDate(s?: string): string {
  const v = (s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
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
  const [epcId, setEpcId] = useState<string | null>(null);
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
  const [editMode, setEditMode] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [docCats, setDocCats] = useState<Set<string>>(new Set());

  // Stakeholders + references seed data (from an existing row on resume/edit).
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [initCustomers, setInitCustomers] = useState<Ref[]>([]);
  const [initSuppliers, setInitSuppliers] = useState<Ref[]>([]);
  const [initReferral, setInitReferral] = useState("");
  const [initReferralOther, setInitReferralOther] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const stepReached = useRef(1);
  const uid = () => "m" + ++idRef.current;

  const turn = SCRIPT[idx] ?? null;
  const editTurn = editing ? SCRIPT.find((t) => t.id === editing.turnId) ?? null : null;
  const active = editTurn ?? turn;

  function hdr() { return { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` }; }
  const advance = () => setIdx((i) => i + 1);
  const merge = (patch: Form) => setForm((f) => ({ ...f, ...patch }));
  function say(from: "bot" | "user", text: string) { setMsgs((m) => [...m, { id: uid(), from, text, time: nowLabel() }]); }
  function pushUser(text: string, meta: Partial<Msg> = {}) { setMsgs((m) => [...m, { id: uid(), from: "user", text, time: nowLabel(), ...meta }]); }
  const pushBot = useCallback((text: string, turnId: string) => {
    setMsgs((m) => (m.some((x) => x.from === "bot" && x.turnId === turnId) ? m : [...m, { id: uid(), from: "bot", text, time: nowLabel(), turnId }]));
  }, []);

  // Direct column write on the target EPC — the same style the admin EPC detail
  // page uses. Best-effort; errors surface only where the RM is blocked.
  async function patchBiz(patch: Record<string, unknown>) {
    if (!epcId || !Object.keys(patch).length) return;
    try { await supabase().from("epc_business").update(patch).eq("id", epcId); } catch { /* best-effort */ }
  }
  function maybeBumpStep(target: number) {
    if (target > stepReached.current) { stepReached.current = target; void patchBiz({ current_step: target }); }
  }

  // ── Resume / edit an existing EPC (?epc=<id>) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mob = params.get("mobile");
    if (mob) setInput(mob.replace(/\D/g, "").slice(0, 10));
    const epcParam = params.get("epc");
    if (!epcParam) return;
    setResuming(true);
    setEpcId(epcParam);
    setEditMode(true);
    // Always clear the loading state, even if the row is missing/malformed —
    // never leave the RM stuck on the "Loading the EPC…" spinner.
    void (async () => { try { await hydrate(epcParam); } catch { /* start from what loaded */ } finally { setResuming(false); } })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function hydrate(id: string) {
    const { data } = await supabase().from("epc_business").select("*").eq("id", id).maybeSingle();
    const row = (data as Record<string, any>) || {};
    const pf: Form = {};
    for (const k of PREFILL_KEYS) if (row[k] != null && row[k] !== "") pf[k] = String(row[k]);
    pf._has_id = "1";
    setForm(pf);
    setStakeholders((Array.isArray(row.stakeholders) ? row.stakeholders : []).map(normalizeStakeholder));
    const refs = (Array.isArray(row.business_references) ? row.business_references : []) as Ref[];
    setInitCustomers(refs.filter((r) => r?.type === "customer"));
    setInitSuppliers(refs.filter((r) => r?.type === "supplier"));
    setInitReferral((row.referral_source as string) || "");
    setInitReferralOther((row.referral_source_other as string) || "");
    stepReached.current = Math.max(1, Number(row.current_step) || 1);
    try {
      const { data: docs } = await supabase().from("epc_documents").select("category").eq("business_id", id);
      setDocCats(new Set(((docs ?? []) as { category: string }[]).map((d) => d.category)));
    } catch { /* ignore */ }
  }

  // Advance the script — running `when` skips, and (in edit/resume) skipping
  // turns that are already filled so we only ask for what's missing.
  useEffect(() => {
    if (resuming || !turn) return;
    if (turn.when && !turn.when(form)) { setIdx((i) => i + 1); return; }
    if (editMode && turn.id !== "submit" && isTurnFilled(turn)) { setIdx((i) => i + 1); return; }
    let text = turn.bot;
    if (turn.id === "extra_doc") text = `Upload the ${extraDocLabel(form.business_type) ?? "entity document"}.`;
    pushBot(text, turn.id);
    if (turn.id === "office") pushBot("Geo-tagged on-site photos can be redone later from the classic form — plain images are fine here.", "office_note");
    setInput(""); setError(null); setFiles({}); setThumbs({}); setConfirm(null); setEditing(null);
    if (turn.id === "mobile") { const p = new URLSearchParams(window.location.search).get("mobile"); if (p) setInput(p.replace(/\D/g, "").slice(0, 10)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, editMode, resuming]);

  // Keep the view pinned to the newest message.
  const didFirstScroll = useRef(false);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: didFirstScroll.current ? "smooth" : "auto" });
    if (msgs.length) didFirstScroll.current = true;
  }, [msgs, confirm, idx, busy]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  // Paste-to-attach while on a document turn.
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

  function isTurnFilled(t: Turn): boolean {
    switch (t.kind) {
      case "mobile": return form._has_id === "1";
      case "text":
      case "choice": return !!((form[t.filledBy ?? t.field ?? ""] ?? "").trim());
      case "confirmacct": return !!((form.bank_account_number ?? "").trim());
      case "docs": return (t.filledCats ?? []).length > 0 && (t.filledCats ?? []).every((c) => docCats.has(c));
      case "stakeholders": return stakeholders.length > 0 && stakeholders.every((s) => !!s.name?.trim());
      case "references": return initCustomers.length + initSuppliers.length > 0;
      case "submit": return false;
    }
    return false;
  }

  // ── Files ──
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

  // ── Text / choice answers ──
  function commitTurn(value: string, label: string) {
    const t = turn; if (!t) return;
    pushUser(label, { turnId: t.id, field: t.field, editable: t.kind === "text" || t.kind === "choice" });
    const nf = { ...form, ...(t.field ? { [t.field]: value } : {}) };
    setForm(nf);
    if (t.write) void patchBiz(t.write(value, nf));
    if (t.step) maybeBumpStep(t.step);
    advance();
  }
  function chooseChoice(c: Choice) {
    if (editing) return void applyEdit(c.value, c.label);
    commitTurn(c.value, c.label);
  }
  function submitText() {
    const t = active; if (!t) return;
    const v = input.trim();
    if (t.validate) { const e = t.validate(v); if (e) { setError(e); return; } }
    if (!v && !t.optional) { setError("This field is required."); return; }
    if (editing) return void applyEdit(v, v || "—");
    commitTurn(v, v || "—");
  }
  function skipText() {
    const t = active; if (!t || editing) return;
    if (!t.optional && t.field) setMissing((s) => (s.includes(fieldLabel(t)) ? s : [...s, fieldLabel(t)]));
    pushUser("— skipped —", { turnId: t.id, editable: t.kind === "text" || t.kind === "choice" });
    advance();
  }

  // ── Editing a previous answer ──
  function startEdit(m: Msg) {
    if (!m.turnId || !m.editable) return;
    const t = SCRIPT.find((x) => x.id === m.turnId);
    if (!t) return;
    setEditing({ index: msgs.findIndex((x) => x.id === m.id), turnId: m.turnId });
    setError(null);
    if (t.kind === "text" || t.kind === "confirmacct") setInput((t.field && form[t.field]) || "");
    if (t.kind === "docs") { setFiles({}); setThumbs({}); setConfirm(null); }
  }
  async function applyEdit(value: string, label: string) {
    if (!editing) return;
    const { index, turnId } = editing;
    const t = SCRIPT.find((x) => x.id === turnId);
    const nf: Form = { ...form, ...(t?.field ? { [t.field]: value } : {}) };
    setForm(nf);
    setMsgs((m) => m.map((x, i) => (i === index ? { ...x, text: label, edited: true } : x)));
    if (t?.write) await patchBiz(t.write(value, nf));
    setEditing(null); setInput("");
  }
  function cancelEdit() { setEditing(null); setInput(""); setError(null); }

  // ── Confirm bank account number ──
  function submitConfirmAcct() {
    const t = active; if (!t) return;
    const v = input.trim();
    const have = (form.bank_account_number ?? "").trim();
    if (have) {
      if (v !== have) { setError("That doesn't match the account number on the cheque. Please re-check."); return; }
    } else {
      if (!ACCOUNT_RE.test(v)) { setError("Enter a valid account number (9–18 digits)."); return; }
      merge({ bank_account_number: v });
      void patchBiz({ bank_account_number: v });
    }
    pushUser("Account number confirmed ✓", { turnId: t.id });
    if (t.step) maybeBumpStep(t.step);
    advance();
  }

  // ── Documents (upload → OCR → "Read from the document" card) ──
  async function runDocs() {
    const t = active; if (!t || t.kind !== "docs" || !epcId) return;
    const isDocEdit = !!editing && editTurn?.id === t.id;
    const slots = t.uploads ?? [];
    // Optional multi-slot turns (office photos) may be submitted with whatever
    // subset is attached; required turns need every slot.
    const attached = slots.filter((u) => files[u.name]);
    if (t.optional) {
      if (attached.length === 0) { setError("Attach at least one photo, or skip."); return; }
    } else {
      for (const u of slots) if (!files[u.name]) { setError(`Please attach: ${u.label}.`); return; }
    }
    const useSlots = t.optional ? attached : slots;
    setBusy(true); setError(null);
    const receipt = useSlots.map((u) => ({ name: files[u.name]?.name || u.label, thumb: thumbs[u.name] ?? null }));
    try {
      if (isDocEdit) setMsgs((m) => m.map((x, i) => (i === editing!.index ? { ...x, files: receipt, edited: true } : x)));
      else pushUser(useSlots.map((u) => u.label).join(" · "), { files: receipt, turnId: t.id, editable: true });

      // Upload every attached slot to the target EPC (admin-on-behalf, via /api/upload).
      for (const u of useSlots) {
        const r = await uploadDocument(files[u.name], {
          table: "epc_documents", category: u.category, business_id: epcId, replace: t.replace,
        });
        if (!r.ok) { setError(r.error || "Couldn't upload the file. Try again, or skip."); setBusy(false); return; }
        setDocCats((s) => new Set(s).add(u.category));
      }

      if (!t.ocr) { if (t.step) maybeBumpStep(t.step); if (isDocEdit) setEditing(null); else advance(); return; }

      const primary = files[slots[0].name];
      const { patch, fields } = await ocrDoc(t.ocr, primary);
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (v != null && v !== "") clean[k] = v;
      merge(Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, String(v)])) as Form);
      if (Object.keys(clean).length) await patchBiz(clean);
      if (t.step) maybeBumpStep(t.step);
      const gaps = fields.filter((f) => f.field && !f.ok).map((f) => f.label);
      const note = gaps.length === 0
        ? "All details read cleanly."
        : `Couldn't read: ${gaps.join(", ")}. You can edit them here or continue and fill them in later.`;
      setConfirm({ fields, note, thumbs: receipt.map((r) => r.thumb), edit: isDocEdit });
    } catch {
      setError("Couldn't upload or read that document. Please check the file and try again.");
    } finally { setBusy(false); }
  }

  // Runs the matching OCR route/helper and returns a column patch + display list.
  async function ocrDoc(kind: "pan" | "gst" | "cheque", file: File): Promise<{ patch: Record<string, unknown>; fields: Fetched[] }> {
    const row = (label: string, value: unknown, field?: string): Fetched => {
      const v = value == null || value === "" ? "" : String(value);
      return { label, value: v, ok: !!v, field };
    };
    // Per-kind "couldn't read" list — shown (editable) whenever OCR fails, errors,
    // times out or returns an unexpected shape, so the chat never stalls or throws.
    const blank = (): Fetched[] =>
      kind === "pan" ? [row("PAN", "", "pan_number"), row("Name", ""), row("Father", "")]
      : kind === "gst" ? [row("Legal name", "", "legal_name"), row("Trade name", "", "trade_name"), row("GSTIN", "", "gstin_number"), row("GST address", "", "gst_address")]
      : [row("Account no.", "", "bank_account_number"), row("IFSC", "", "bank_ifsc"), row("Bank", "", "bank_name")];
    try {
      if (kind === "pan") {
        const r = await extractPan(file);
        if (!r.ok) return { patch: {}, fields: blank() };
        return { patch: { pan_number: (r.pan || "").toUpperCase() }, fields: [row("PAN", r.pan, "pan_number"), row("Name", r.name), row("Father", r.father_name)] };
      }
      if (kind === "gst") {
        const r = await extractGstLegalName(file);
        if (!r.ok) return { patch: {}, fields: blank() };
        return {
          patch: { legal_name: r.legal_name || "", trade_name: r.trade_name || "", gstin_number: (r.gstin || "").toUpperCase(), gst_address: r.address || "" },
          fields: [row("Legal name", r.legal_name, "legal_name"), row("Trade name", r.trade_name, "trade_name"), row("GSTIN", r.gstin, "gstin_number"), row("GST address", r.address, "gst_address")],
        };
      }
      // cheque
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/epc/extract-cheque", { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) return { patch: {}, fields: blank() };
      return {
        patch: { bank_account_number: j.accountNumber || "", bank_ifsc: (j.ifsc || "").toUpperCase(), bank_name: j.bankName || "" },
        fields: [row("Account no.", j.accountNumber, "bank_account_number"), row("IFSC", j.ifsc, "bank_ifsc"), row("Bank", j.bankName, "bank_name")],
      };
    } catch {
      return { patch: {}, fields: blank() };
    }
  }

  function retryDocs() { setConfirm(null); setFiles({}); setThumbs({}); setError(null); }
  function skipDoc() {
    const t = active; if (!t) return;
    if (!t.optional) setMissing((s) => (s.includes(t.docLabel || t.id) ? s : [...s, t.docLabel || t.id]));
    pushUser(`Skipped — ${t.docLabel || "document"} not added yet`, {});
    setConfirm(null);
    advance();
  }

  // Edit a value the OCR fetched — writes the column immediately (field === column).
  function saveFetchedField(msgId: string, field: string, value: string) {
    merge({ [field]: value });
    void patchBiz({ [field]: value });
    setMsgs((m) => m.map((x) => (x.id === msgId ? { ...x, fetched: x.fetched!.map((ff) => (ff.field === field ? { ...ff, value, ok: !!value } : ff)) } : x)));
  }

  // ── Mobile → create the EPC (or open the existing one) ──
  async function submitMobile() {
    const m = input.replace(/\D/g, "");
    if (!MOBILE_RE.test(m)) { setError("Enter a valid 10-digit mobile."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/create-epc", { method: "POST", headers: hdr(), body: JSON.stringify({ mobile: m }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't create the EPC."); setBusy(false); return; }
      const biz = j.business;
      pushUser(m, { turnId: "mobile" });
      setEpcId(biz.id);
      if (j.duplicate) {
        say("bot", `An EPC with this number already exists (${biz.display_id || biz.id.slice(0, 8)}). I'll open it and continue with whatever's still missing.`);
        setEditMode(true);
        await hydrate(biz.id);
      } else {
        say("bot", "New EPC created. Let's build the profile.");
        setForm((f) => ({ ...f, _has_id: "1" }));
        maybeBumpStep(1);
      }
      advance();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  // ── Stakeholders / references done → write jsonb + advance ──
  function onStakeholdersDone(list: Stakeholder[]) {
    setStakeholders(list);
    void patchBiz({ stakeholders: list, current_step: Math.max(stepReached.current, 4) });
    maybeBumpStep(4);
    pushUser(`Saved ${list.length} ${list.length === 1 ? "member" : "members"}`, {});
    advance();
  }
  function onReferencesDone(payload: { references: Ref[]; referral_source: string; referral_source_other: string }) {
    setInitCustomers(payload.references.filter((r) => r.type === "customer"));
    setInitSuppliers(payload.references.filter((r) => r.type === "supplier"));
    setInitReferral(payload.referral_source);
    setInitReferralOther(payload.referral_source_other);
    void patchBiz({
      business_references: payload.references,
      referral_source: payload.referral_source || null,
      referral_source_other: payload.referral_source === "others" ? (payload.referral_source_other || null) : null,
      current_step: Math.max(stepReached.current, 7),
    });
    maybeBumpStep(7);
    pushUser(`Saved ${payload.references.length} references`, {});
    advance();
  }

  // ── Submit ──
  async function doSubmit() {
    if (!epcId) return;
    setBusy(true); setError(null);
    try {
      const { data } = await supabase().from("epc_business")
        .select("contact_name, contact_mobile, contact_designation, business_type, pan_number, stakeholders")
        .eq("id", epcId).maybeSingle();
      const row = (data as Record<string, any>) || {};
      const miss = missingRequired(row);
      if (miss.length) {
        maybeBumpStep(Math.max(stepReached.current, 2)); // keep it off "Application Unseen"
        pushUser("Save as draft", {});
        say("bot", `Saved as a draft — still pending: ${miss.join(", ")}. It's on the Task Manager board under “Doc Uploaded”; reopen it anytime to finish and submit.`);
        setDonDraft(true); setDonId(epcId); setBusy(false); return;
      }
      // VERIFIED write — the final submit must not be best-effort. If it fails the
      // RM sees an error and can retry, never a false "submitted" while it stayed a draft.
      const { error: subErr } = await supabase().from("epc_business")
        .update({ status: "under_review", submitted_at: new Date().toISOString(), current_step: 7 })
        .eq("id", epcId);
      if (subErr) { setError(`Couldn't submit the profile just now — ${subErr.message}. Please try again.`); setBusy(false); return; }
      pushUser("Submit for verification", {});
      say("bot", "Done — the EPC profile is submitted and now sits in “Review by CC” on the Task Manager board.");
      setDonId(epcId);
    } catch {
      setError("Couldn't submit the profile just now. Please try again.");
    } finally { setBusy(false); }
  }

  // ── Derived UI state ──
  const milestones = [
    !!form.contact_name, !!form.contact_designation, !!form.business_type, !!form.pan_number,
    !!form.legal_name, !!form.gstin_number, !!form.pm_surya_ghar,
    stakeholders.length > 0, !!form.bank_account_number, docCats.has("office_exterior"),
    initCustomers.length + initSuppliers.length > 0,
  ];
  const progress = Math.round((milestones.filter(Boolean).length / milestones.length) * 100);
  const showDock = !donId && !!active && !confirm && (editing ? true : turn === active);

  if (resuming) {
    return (
      <div className="h-screen grid place-items-center" style={CANVAS_STYLE}>
        <div className="flex flex-col items-center gap-3 text-[#0f3a66]">
          <div className="w-10 h-10 rounded-full border-2 border-[#185fa5]/30 border-t-[#185fa5] animate-spin" />
          <div className="text-[13px]">Loading the EPC…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={CANVAS_STYLE}>
      {/* Chat header */}
      <header className="shrink-0 px-3 sm:px-5 py-2.5 bg-[#0f3a66] text-white flex items-center gap-3 shadow-sm">
        <button onClick={() => router.push("/admin")} className="p-1 -ml-1 text-white/80 hover:text-white text-[20px] leading-none">←</button>
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#2f86cf] to-[#0f3a66] ring-2 ring-white/15 flex items-center justify-center font-display font-bold text-[15px]">CC</div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[15px] leading-tight truncate">Capital Craft · {editMode ? "Edit EPC" : "New EPC"}</div>
          <div className="text-[11.5px] text-white/70 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7cc5f5]" /> {editMode ? "completing the profile" : "building the profile"}
          </div>
        </div>
        <span className="text-[11px] text-white/60 tabular-nums">{progress}%</span>
        <button onClick={() => router.push("/admin")} className="w-8 h-8 -mr-1 rounded-full hover:bg-white/10 grid place-items-center text-white/80 hover:text-white text-[18px] leading-none" aria-label="Close chat" title="Close">✕</button>
      </header>
      <div className="h-2 bg-black/15 shrink-0"><div className="h-2 bg-[#3f9be8] rounded-r-full transition-all duration-500" style={{ width: progress + "%" }} /></div>

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
            <div className="self-start w-full max-w-[88%] rounded-2xl rounded-tl-md border border-[#c6ddf3] bg-white shadow-sm overflow-hidden">
              <div className="px-3.5 py-2 bg-[#eaf2fb] border-b border-[#dbe8f7] flex items-center gap-2">
                <span className="text-[12px]">📄</span>
                <span className="text-[12.5px] font-semibold text-[#0f3a66]">Read from the document</span>
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
                  <button onClick={() => { const c = confirm; if (c) setMsgs((m) => [...m, { id: uid(), from: "bot", time: nowLabel(), fetched: c.fields }]); const wasEdit = c?.edit; setConfirm(null); if (wasEdit) setEditing(null); else advance(); }} className="px-3.5 py-1.5 rounded-lg bg-[#185fa5] text-white text-[12.5px] font-semibold hover:bg-[#124a82]">Looks good →</button>
                  <button onClick={retryDocs} className="px-3 py-1.5 rounded-lg border border-line text-[12.5px] text-text-mid hover:bg-bg-soft">Re-attach</button>
                </div>
              </div>
            </div>
          )}

          {error && <div className="self-center text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 my-1">{error}</div>}

          {donId && (
            <div className="self-stretch mt-3 flex flex-col items-center gap-2">
              <div className="text-[13px] text-text-mid text-center">{donDraft ? "Draft saved — the EPC is on your Task Manager board." : "✓ EPC submitted — it's in “Review by CC”."}</div>
              <button onClick={() => router.push(`/admin/epc/${donId}/view` as any)} className="px-5 py-2.5 rounded-xl bg-[#185fa5] text-white text-[14px] font-semibold shadow-sm hover:bg-[#124a82]">Open the EPC →</button>
              <button onClick={() => router.push("/admin")} className="text-[12px] text-text-muted hover:text-text">Go to console</button>
            </div>
          )}
          <div className="h-2" />
        </div>
      </div>

      {/* Dock — the controls for the active question */}
      {showDock && active && (
        <div className="shrink-0 bg-white/85 backdrop-blur border-t border-line">
          <div className="max-w-xl mx-auto px-3 sm:px-4 py-3">
            {editing && (
              <div className="flex items-center justify-between mb-2 text-[12px]">
                <span className="text-[#185fa5] font-semibold">Editing your answer</span>
                <button onClick={cancelEdit} className="text-text-muted hover:text-text">Cancel</button>
              </div>
            )}

            {active.kind === "mobile" && (
              <div className="flex items-center gap-2">
                <input ref={inputRef} autoFocus value={input} onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitMobile(); }}
                  inputMode="numeric" placeholder="10-digit mobile" className="flex-1 border border-line rounded-full px-4 py-2.5 text-[14px] bg-white focus:outline-none focus:border-[#185fa5] focus:ring-2 focus:ring-[#185fa5]/15" />
                <button onClick={() => void submitMobile()} className="px-4 h-11 shrink-0 rounded-full bg-[#185fa5] text-white text-[13px] font-semibold grid place-items-center hover:bg-[#124a82] shadow-sm">Create EPC</button>
              </div>
            )}

            {active.kind === "choice" && (
              <div className="flex flex-col gap-2">
                <div className="grid sm:grid-cols-2 gap-2">
                  {active.choices!.map((c) => (
                    <button key={c.value} onClick={() => chooseChoice(c)} className="text-left px-4 py-3 rounded-xl border border-line bg-white hover:border-[#185fa5] hover:bg-[#f5f9fe] transition">
                      <div className="text-[14px] font-semibold text-text">{c.label}</div>{c.sub && <div className="text-[12px] text-text-muted">{c.sub}</div>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(active.kind === "text" || active.kind === "confirmacct") && (
              <div className="flex items-center gap-2">
                <input ref={inputRef} autoFocus value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void (active.kind === "confirmacct" ? submitConfirmAcct() : submitText()); if (e.key === "Escape" && editing) cancelEdit(); }}
                  placeholder={active.placeholder || "Type a message…"} className="flex-1 border border-line rounded-full px-4 py-2.5 text-[14px] bg-white focus:outline-none focus:border-[#185fa5] focus:ring-2 focus:ring-[#185fa5]/15" />
                {!editing && active.kind === "text" && <button onClick={() => skipText()} className="px-3 py-2.5 text-[13px] text-text-muted hover:text-text whitespace-nowrap" title="Continue without this — you can add it later">{active.optional ? "Skip" : "Don't have it"}</button>}
                <button onClick={() => void (active.kind === "confirmacct" ? submitConfirmAcct() : submitText())} className="w-11 h-11 shrink-0 rounded-full bg-[#185fa5] text-white grid place-items-center hover:bg-[#124a82] shadow-sm" aria-label="Send">
                  {editing ? "✓" : <SendIcon />}
                </button>
              </div>
            )}

            {active.kind === "docs" && (
              <DocDock active={active} files={files} thumbs={thumbs} onPick={setFileFor} onDrop={fillNextSlot} onClear={clearFileFor} onRun={() => void runDocs()} onSkip={skipDoc} replacing={!!editing} />
            )}

            {active.kind === "stakeholders" && epcId && (
              <StakeholdersDock epcId={epcId} businessType={form.business_type} initial={stakeholders} busy={busy} onContinue={onStakeholdersDone} />
            )}

            {active.kind === "references" && (
              <ReferencesDock initCustomers={initCustomers} initSuppliers={initSuppliers} initReferral={initReferral} initReferralOther={initReferralOther} onContinue={onReferencesDone} />
            )}

            {active.kind === "submit" && (
              <div className="flex flex-col gap-2">
                {missing.length > 0 && <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">Skipped so far: {missing.join(", ")}. Anything still required will keep it a draft.</div>}
                <button onClick={() => void doSubmit()} className="px-4 py-2.5 rounded-xl bg-[#185fa5] text-white text-[14px] font-semibold hover:bg-[#124a82]">Submit for verification →</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Presentational pieces (identical to the loan intake) ──

function FetchedCard({ m, onSave }: { m: Msg; onSave: (msgId: string, field: string, value: string) => void }) {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [val, setVal] = useState("");
  return (
    <div className="self-start w-full max-w-[88%] rounded-2xl rounded-tl-md border border-[#c6ddf3] bg-white shadow-sm overflow-hidden">
      <div className="px-3.5 py-2 bg-[#eaf2fb] border-b border-[#dbe8f7] flex items-center gap-2">
        <span className="text-[12px]">📄</span>
        <span className="text-[12.5px] font-semibold text-[#0f3a66]">Read from the document</span>
      </div>
      <div className="p-3.5 flex flex-col gap-2">
        {(m.fetched ?? []).map((f, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-[13px] min-h-[24px]">
            <span className="text-text-muted shrink-0">{f.label}</span>
            {editKey === f.field && f.field ? (
              <span className="flex items-center gap-1.5">
                <input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { onSave(m.id, f.field!, val.trim()); setEditKey(null); } if (e.key === "Escape") setEditKey(null); }}
                  className="border border-[#185fa5] rounded-lg px-2.5 py-1 text-[13px] w-44 text-right outline-none" />
                <button onClick={() => { onSave(m.id, f.field!, val.trim()); setEditKey(null); }} className="text-[#185fa5] text-[12px] font-semibold">Save</button>
              </span>
            ) : (
              <span className="flex items-center gap-2 min-w-0">
                {f.ok
                  ? <span className="text-text font-medium text-right break-words">{f.value}</span>
                  : <span className="text-amber-600 text-[12px] italic">not found</span>}
                {f.field && (
                  <button onClick={() => { setEditKey(f.field!); setVal(f.ok ? f.value : ""); }} className="opacity-60 hover:opacity-100 text-[#185fa5] text-[11px] hover:underline shrink-0" aria-label="Edit">✎</button>
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
      <span className="text-[11px] text-[#0f3a66]/70 bg-white/70 rounded-full px-3 py-1 shadow-sm">{label}</span>
    </div>
  );
}

function MessageRow({ m, rmName, onEdit, editingId }: { m: Msg; rmName: string; onEdit: () => void; editingId: string | null }) {
  const isUser = m.from === "user";
  const beingEdited = editingId === m.id;
  return (
    <div className={["group flex flex-col max-w-[82%]", isUser ? "self-end items-end" : "self-start items-start"].join(" ")}>
      <div className={["relative px-3.5 py-2 rounded-2xl text-[14px] leading-snug shadow-sm break-words whitespace-pre-wrap w-fit max-w-full",
        isUser ? "bg-[#185fa5] text-white rounded-br-md" : "bg-white text-[#0d2744] rounded-bl-md border border-black/5",
        beingEdited ? "ring-2 ring-[#7cc5f5]" : ""].join(" ")}>
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
      <div className={["flex items-center gap-1.5 mt-0.5 px-1 text-[10.5px]", isUser ? "text-[#0f3a66]/60 flex-row-reverse" : "text-text-muted"].join(" ")}>
        <span className="font-medium">{isUser ? rmName : "Capital Craft"}</span>
        <span>· {m.time}</span>
        {m.edited && <span>· edited</span>}
        {isUser && !m.files && <span className="text-[#185fa5]">✓✓</span>}
        {isUser && m.editable && (
          <button onClick={onEdit} className="text-[#185fa5] font-semibold hover:underline" aria-label="Edit">{m.files ? "↺ replace" : "✎ edit"}</button>
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
  const runLabel = active.ocr ? (replacing ? "Re-read & replace" : "Read document") : (replacing ? "Replace" : "Upload & attach");
  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onDrop(f); }}
        className={["rounded-xl border-2 border-dashed p-2.5 transition", drag ? "border-[#185fa5] bg-[#eaf2fb]" : "border-line bg-white"].join(" ")}
      >
        <div className="grid gap-2" style={{ gridTemplateColumns: (active.uploads?.length || 1) > 1 ? "1fr 1fr" : "1fr" }}>
          {active.uploads!.map((u) => {
            const has = !!files[u.name];
            return (
              <label key={u.name} className={["relative flex items-center gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition", has ? "border-[#185fa5] bg-[#f5f9fe]" : "border-line bg-white hover:border-[#185fa5]/50"].join(" ")}>
                {has && thumbs[u.name]
                  ? <img src={thumbs[u.name] as string} alt="" className="w-9 h-9 rounded-md object-cover" />
                  : <span className="w-9 h-9 rounded-md bg-bg-soft grid place-items-center text-[15px]">{has ? "📄" : "＋"}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-text truncate">{u.label}</span>
                  <span className="block text-[11px] text-text-muted truncate">{has ? files[u.name].name : "Tap, drop, or paste"}</span>
                </span>
                {has
                  ? <button type="button" onClick={(e) => { e.preventDefault(); onClear(u.name); }} className="text-text-muted hover:text-red-500 text-[15px] leading-none px-1">×</button>
                  : <span className="text-[#185fa5] text-[12px] font-semibold">Add</span>}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(u.name, f); }} />
              </label>
            );
          })}
        </div>
        <div className="text-[11px] text-text-muted mt-2 px-0.5">Attach by tapping, dragging a file in, or pasting a copied image (Ctrl+V).</div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onRun} className="px-4 py-2 rounded-lg bg-[#185fa5] text-white text-[13px] font-semibold hover:bg-[#124a82]">{runLabel}</button>
        {!replacing && <button onClick={onSkip} className="px-3 py-2 rounded-lg text-[12.5px] text-text-muted hover:text-text hover:bg-bg-soft">Don&apos;t have it — skip</button>}
      </div>
    </div>
  );
}

// ── Stakeholders dock — mirrors classic onboarding step-3 (cards per member,
// PAN/Aadhaar upload with OCR via the extract-stakeholder route). ──
type StkCfg = { roleLabel: string; addLabel: string | null; defDesig: string; minRows: number; maxRows: number };
function configFor(bt?: string): StkCfg {
  switch (bt) {
    case "proprietorship": return { roleLabel: "Proprietor", addLabel: null, defDesig: "Proprietor", minRows: 1, maxRows: 1 };
    case "pvt_ltd": return { roleLabel: "Director", addLabel: "+ Add Director", defDesig: "Director", minRows: 2, maxRows: Infinity };
    case "partnership":
    case "llp": return { roleLabel: "Partner", addLabel: "+ Add Partner", defDesig: "Partner", minRows: 2, maxRows: Infinity };
    default: return { roleLabel: "Member", addLabel: "+ Add Member", defDesig: "", minRows: 1, maxRows: Infinity };
  }
}
function normalizeStakeholder(raw: unknown): Stakeholder {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: (r.id as string) ?? crypto.randomUUID(),
    name: (r.name as string) ?? "",
    designation: (r.designation as string) ?? "",
    mobile: (r.mobile as string) ?? "",
    email: (r.email as string) ?? "",
    father_name: (r.father_name as string) ?? "",
    dob: (r.dob as string) ?? "",
    aadhaar_number: (r.aadhaar_number as string) ?? "",
    aadhaar_address: (r.aadhaar_address as string) ?? "",
  };
}
function emptyMember(desig: string): Stakeholder {
  return { id: crypto.randomUUID(), name: "", designation: desig, mobile: "", email: "", father_name: "", dob: "", aadhaar_number: "", aadhaar_address: "" };
}

function StakeholdersDock({ epcId, businessType, initial, busy, onContinue }: {
  epcId: string; businessType?: string; initial: Stakeholder[]; busy: boolean; onContinue: (list: Stakeholder[]) => void;
}) {
  const cfg = configFor(businessType);
  const [list, setList] = useState<Stakeholder[]>(() => (initial.length ? initial : [emptyMember(cfg.defDesig)]));
  const [stkError, setStkError] = useState<string | null>(null);

  function update(id: string, key: keyof Omit<Stakeholder, "id">, value: string) {
    setList((arr) => arr.map((s) => (s.id === id ? { ...s, [key]: value } : s)));
  }
  function add() { setList((arr) => [...arr, emptyMember(cfg.defDesig)]); }
  function remove(id: string) { setList((arr) => arr.filter((s) => s.id !== id)); }

  // OCR a just-uploaded member document and fill that member's empty fields.
  async function ocrMember(id: string, kind: "pan" | "aadhaar_front" | "aadhaar_back", file: File) {
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch(`/api/admin/epc/${epcId}/extract-stakeholder`, { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body: fd });
      const j = await res.json().catch(() => ({}));
      if (!j?.ok || !j.fields) return;
      const fx = j.fields as Record<string, string>;
      setList((arr) => arr.map((s) => {
        if (s.id !== id) return s;
        const n = { ...s };
        if (kind === "pan") {
          if (!n.name && fx.name) n.name = fx.name;
          if (!n.father_name && fx.father_name) n.father_name = fx.father_name;
          if (!n.dob && fx.dob) n.dob = toIsoDate(fx.dob) || fx.dob;
        } else if (kind === "aadhaar_front") {
          if (!n.name && fx.name) n.name = fx.name;
          if (!n.dob && fx.dob) n.dob = toIsoDate(fx.dob) || fx.dob;
          if (!n.aadhaar_number && fx.aadhaar_number) n.aadhaar_number = fx.aadhaar_number;
        } else if (kind === "aadhaar_back") {
          if (!n.aadhaar_address && fx.address) n.aadhaar_address = fx.address;
        }
        return n;
      }));
    } catch { /* silent — the RM can type the fields */ }
  }

  function cont() {
    const cleaned = list
      .filter((s) => s.name.trim() || s.mobile.trim())
      .map((s) => ({
        ...s, name: s.name.trim(), designation: s.designation.trim() || cfg.defDesig, mobile: s.mobile.trim(),
        email: s.email.trim(), father_name: s.father_name.trim(), dob: s.dob.trim(), aadhaar_number: s.aadhaar_number.trim(), aadhaar_address: s.aadhaar_address.trim(),
      }));
    // Proper data: every kept member needs a name, and the entity's minimum
    // (Pvt Ltd / partnership / LLP = 2) must be met — same rule as the classic form.
    if (cleaned.some((s) => !s.name)) { setStkError("Every member needs a name (or remove the empty row)."); return; }
    if (cleaned.length < cfg.minRows) { setStkError(`Add at least ${cfg.minRows} ${cfg.roleLabel.toLowerCase()}${cfg.minRows > 1 ? "s" : ""}.`); return; }
    setStkError(null);
    onContinue(cleaned);
  }

  return (
    <div className="flex flex-col gap-3 max-h-[56vh] overflow-y-auto pr-0.5">
      <div className="text-[12px] text-text-muted">{cfg.roleLabel} details{cfg.minRows > 1 ? ` — add at least ${cfg.minRows}` : ""}.</div>
      {list.map((s, i) => (
        <div key={s.id} className="rounded-xl border border-line bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold text-text">{cfg.roleLabel} {list.length > 1 ? i + 1 : ""}</span>
            {list.length > 1 && <button onClick={() => remove(s.id)} className="text-[12px] text-text-muted hover:text-red-500">Delete</button>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={s.name} onChange={(e) => update(s.id, "name", e.target.value)} placeholder="Name" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <input value={s.designation} onChange={(e) => update(s.id, "designation", e.target.value)} placeholder="Designation" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <input value={s.mobile} onChange={(e) => update(s.id, "mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="Mobile" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <input value={s.email} onChange={(e) => update(s.id, "email", e.target.value)} placeholder="Email" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <input value={s.father_name} onChange={(e) => update(s.id, "father_name", e.target.value)} placeholder="Father's name" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <DateField value={toIsoDate(s.dob)} onChange={(iso) => update(s.id, "dob", iso)} className="rounded-lg border border-line py-2 text-[13px] px-2.5 outline-none focus:border-[#185fa5]" />
            <input value={s.aadhaar_number} onChange={(e) => update(s.id, "aadhaar_number", e.target.value.replace(/\D/g, "").slice(0, 12))} inputMode="numeric" placeholder="Aadhaar no." className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <input value={s.aadhaar_address} onChange={(e) => update(s.id, "aadhaar_address", e.target.value)} placeholder="Address (as per Aadhaar)" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <div className="rounded-lg border border-line p-2">
              <FileUpload businessId={epcId} stakeholderId={s.id} table="epc_documents" category="stakeholder_pan" maxFiles={1} uploadedBy="admin" label="PAN" onUploaded={({ file }) => void ocrMember(s.id, "pan", file)} />
            </div>
            <div className="rounded-lg border border-line p-2">
              <FileUpload businessId={epcId} stakeholderId={s.id} table="epc_documents" category={"stakeholder_aadhaar_front" as any} maxFiles={1} uploadedBy="admin" label="Aadhaar front" onUploaded={({ file }) => void ocrMember(s.id, "aadhaar_front", file)} />
            </div>
            <div className="rounded-lg border border-line p-2">
              <FileUpload businessId={epcId} stakeholderId={s.id} table="epc_documents" category={"stakeholder_aadhaar_back" as any} maxFiles={1} uploadedBy="admin" label="Aadhaar back" onUploaded={({ file }) => void ocrMember(s.id, "aadhaar_back", file)} />
            </div>
          </div>
        </div>
      ))}
      {stkError && <div className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">{stkError}</div>}
      <div className="flex items-center gap-2">
        {cfg.addLabel && list.length < cfg.maxRows && <button onClick={add} className="px-3 py-2 rounded-lg border border-line text-[13px] text-text-mid hover:border-[#185fa5]">{cfg.addLabel}</button>}
        <button onClick={cont} disabled={busy} className="ml-auto px-4 py-2 rounded-lg bg-[#185fa5] text-white text-[13px] font-semibold hover:bg-[#124a82] disabled:opacity-60">Save members & continue →</button>
      </div>
    </div>
  );
}

// ── References dock — mirrors classic onboarding step-6. ──
const REFERRAL_OPTIONS = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "website", label: "Website" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "friend", label: "Friend" },
  { value: "epc_partner", label: "EPC Partner" },
  { value: "others", label: "Others (Please specify)" },
];
function seedRefs(init: Ref[], type: Ref["type"]): Ref[] {
  return init.length ? init : [{ type, name: "", mobile: "" }, { type, name: "", mobile: "" }];
}
function ReferencesDock({ initCustomers, initSuppliers, initReferral, initReferralOther, onContinue }: {
  initCustomers: Ref[]; initSuppliers: Ref[]; initReferral: string; initReferralOther: string;
  onContinue: (p: { references: Ref[]; referral_source: string; referral_source_other: string }) => void;
}) {
  const [customers, setCustomers] = useState<Ref[]>(() => seedRefs(initCustomers, "customer"));
  const [suppliers, setSuppliers] = useState<Ref[]>(() => seedRefs(initSuppliers, "supplier"));
  const [referral, setReferral] = useState(initReferral);
  const [referralOther, setReferralOther] = useState(initReferralOther);

  function upd(which: Ref["type"], i: number, key: "name" | "mobile", value: string) {
    const setter = which === "customer" ? setCustomers : setSuppliers;
    setter((arr) => arr.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }
  function add(which: Ref["type"]) {
    const setter = which === "customer" ? setCustomers : setSuppliers;
    setter((arr) => [...arr, { type: which, name: "", mobile: "" }]);
  }
  function remove(which: Ref["type"], i: number) {
    const setter = which === "customer" ? setCustomers : setSuppliers;
    setter((arr) => arr.filter((_, idx) => idx !== i));
  }
  function cont() {
    const clean = (arr: Ref[], t: Ref["type"]) => arr.filter((r) => r.name.trim() || r.mobile.trim()).map((r) => ({ type: t, name: r.name.trim(), mobile: r.mobile.trim() }));
    onContinue({ references: [...clean(customers, "customer"), ...clean(suppliers, "supplier")], referral_source: referral, referral_source_other: referralOther.trim() });
  }

  return (
    <div className="flex flex-col gap-3 max-h-[56vh] overflow-y-auto pr-0.5">
      <RefBlock title="Customer references" which="customer" refs={customers} onUpd={upd} onAdd={add} onRemove={remove} />
      <RefBlock title="Supplier references" which="supplier" refs={suppliers} onUpd={upd} onAdd={add} onRemove={remove} />
      <div>
        <div className="text-[12px] text-text-muted mb-1">How did they hear about us?</div>
        <select value={referral} onChange={(e) => setReferral(e.target.value)} className="w-full border border-line rounded-lg px-2.5 py-2 text-[13px] bg-white outline-none focus:border-[#185fa5]">
          <option value="">Select…</option>
          {REFERRAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {referral === "others" && <input value={referralOther} onChange={(e) => setReferralOther(e.target.value)} placeholder="Please specify" className="mt-2 w-full border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />}
      </div>
      <button onClick={cont} className="self-end px-4 py-2 rounded-lg bg-[#185fa5] text-white text-[13px] font-semibold hover:bg-[#124a82]">Save references & continue →</button>
    </div>
  );
}
function RefBlock({ title, which, refs, onUpd, onAdd, onRemove }: {
  title: string; which: Ref["type"]; refs: Ref[];
  onUpd: (w: Ref["type"], i: number, k: "name" | "mobile", v: string) => void; onAdd: (w: Ref["type"]) => void; onRemove: (w: Ref["type"], i: number) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="text-[13px] font-semibold text-text mb-2">{title}</div>
      <div className="flex flex-col gap-2">
        {refs.map((r, i) => (
          <div key={i} className="grid grid-cols-2 gap-2">
            <input value={r.name} onChange={(e) => onUpd(which, i, "name", e.target.value)} placeholder="Name" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <div className="flex items-center gap-1">
              <input value={r.mobile} onChange={(e) => onUpd(which, i, "mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="Mobile" className="flex-1 border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
              {refs.length > 2 && <button onClick={() => onRemove(which, i)} className="text-text-muted hover:text-red-500 text-[15px] px-1">×</button>}
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => onAdd(which)} className="mt-2 text-[12px] font-semibold text-[#185fa5] hover:underline">+ Add {which} reference</button>
    </div>
  );
}

// ── Helpers ──
function fieldLabel(t: Turn): string { return t.placeholder || t.docLabel || t.field || "detail"; }

// Same required set the classic review page uses for an admin submit.
function missingRequired(b: Record<string, any>): string[] {
  const out: string[] = [];
  if (!String(b.contact_name ?? "").trim()) out.push("Contact name");
  if (!String(b.contact_mobile ?? "").trim()) out.push("Mobile");
  if (!String(b.contact_designation ?? "").trim()) out.push("Designation");
  if (!b.business_type) out.push("Business type");
  if (!b.pan_number || !PAN_RE.test(String(b.pan_number))) out.push("Valid PAN");
  const sh = (b.stakeholders as { name?: string; designation?: string }[] | null) ?? [];
  if (sh.filter((s) => s.name?.trim() && s.designation?.trim()).length === 0) out.push("At least one member");
  return out;
}

// epc_business columns pulled into the chat form on resume/edit.
const PREFILL_KEYS = [
  "contact_name", "contact_email", "contact_designation", "business_type",
  "pan_number", "legal_name", "trade_name", "gstin_number", "gst_address",
  "pm_surya_ghar", "pm_surya_ghar_other", "pm_surya_ghar_capacity",
  "bank_account_number", "bank_ifsc", "bank_name",
  "referral_source", "referral_source_other",
];
