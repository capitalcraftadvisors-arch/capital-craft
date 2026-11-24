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
//
// The header, typing bubble, text input and the document table's look come from
// the chat kit (src/components/chat), drawn in the navy PARTNER_THEME.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { authHeaders, getBusiness } from "@/lib/auth";
import { fetchEpcName } from "@/lib/epc-name";
import { hydrateLoanForm } from "@/lib/loan-form";
import { amountInWords } from "@/lib/numberToWords";
import { fmtDate, toIsoDate } from "@/lib/dates";
import { personName } from "@/lib/loan-roles";
import LoanShareChips from "@/components/LoanShareChips";
import { computeCentralSubsidy, computeEmi, DEFAULT_INDICATIVE_ROI, TENURES } from "@/lib/emi";
import { amountInput, fmtRupees, pctOf } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { clearChatDraft, loadChatDraft, saveChatDraft, withoutThumbs } from "@/lib/chat-draft";
import { fetchLeads, linkLeadLoan } from "@/lib/leads";
import { EMAIL_RE, PINCODE_RE } from "@/lib/validators";
// The chat kit (src/components/chat) — this chat's navy palette is PARTNER_THEME.
import { PARTNER_THEME as THEME } from "@/components/chat/theme";
import type { Choice, FileReceipt, Form } from "@/components/chat/types";
import { useScrollToBottom } from "@/components/chat/hooks";
import { ChatDock, ChatError, ChatMessages } from "@/components/chat/ChatFrame";
import { PartnerChatHeader, PartnerComposer, PartnerTypingBubble } from "@/components/chat/PartnerChrome";
// This chat's own pieces (./_parts): the role decision, the script, the document rows and the docks.
import { hasCoapp, p1Of, p2Of, yesNo } from "./_parts/roles";
import { EDIT_INTRO, PICK_LABEL, SCRIPT, dobErr, nowLabel, rowsOf, uidGen, type Turn } from "./_parts/script";
import { APPLICANT_ROWS, COAPP_ROWS, QUOTATION_ROW, type Unit } from "./_parts/doc-rows";
import { EXTRA_PICK, type ExtraKey } from "./_parts/ExtraDocs";
import DocTable from "./_parts/DocTable";
import EditPicker from "./_parts/EditPicker";
import QuotationDock from "./_parts/QuotationDock";
import LoanConfigDock from "./_parts/LoanConfigDock";
import SuccessScreen from "./_parts/SuccessScreen";

type Msg = { id: string; _id?: string; from: "bot" | "user"; text?: string; time: string; files?: FileReceipt[]; turnId?: string; pass?: string; value?: string /* the answer as stored, for ✎ Edit */ };

// The lead owner this EPC last used on this device — pre-fills the lead-owner
// inputs only (never written into the form on its own). Saved after a submit.
const leadOwnerKey = () => `cc.leadOwner.${getBusiness()?.id ?? ""}`;
// The application being filled in (one at a time per login, in this browser): a
// refresh or a closed tab comes back to it, up to the last answer (lib/chat-draft).
const draftKey = () => { const b = getBusiness(); return `cc_chat:loan:${b?.id ?? ""}:${b?.member?.id ?? "owner"}`; };
type LoanChatDraft = {
  appId: string; msgs: Msg[]; form: Form; idx: number; undo: { msgs: Msg[]; form: Form; idx: number }[];
  subsidyCase: "subsidy" | "non_subsidy"; centralSub: string; tenure: number | null;
};
function lastLeadOwner(field: string): string {
  try { return (JSON.parse(localStorage.getItem(leadOwnerKey()) || "{}") as Form)[field] || ""; } catch { return ""; }
}

// Fields whose typed amount is echoed in Indian words (amountInWords) under the input.
const AMOUNT_FIELDS = new Set(["loan_amount_required"]);

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
  const [tenure, setTenure] = useState<number | null>(null);
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
  const leadRef = useRef<string | null>(null); // ?lead=<id> — the lead this application comes from

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
      } else if (q.get("lead")) {
        // Applied from a lead (Partner Portal v2): a new application, its mobile
        // ready in the box; the loan is linked back to the lead once it starts.
        const lead = (await fetchLeads().catch(() => [])).find((l) => l.id === q.get("lead"));
        if (lead) { leadRef.current = lead.id; prefillRef.current = lead.mobile ?? ""; }
      } else {
        // An application left half-way (refresh, slow OCR, closed tab) — continue
        // it where it stopped, while it's still a draft.
        const d = loadChatDraft<LoanChatDraft>(draftKey());
        if (d?.appId) {
          const { data } = await supabase().from("epc_applications").select("status").eq("id", d.appId).maybeSingle();
          if ((data as { status?: string } | null)?.status === "draft") {
            setAppId(d.appId); setMsgs(d.msgs); setForm(d.form); setIdx(d.idx); setUndoStack(d.undo ?? []);
            setSubsidyCase(d.subsidyCase ?? "subsidy"); setCentralSub(d.centralSub ?? ""); setTenure(d.tenure ?? null);
            const nm = await fetchEpcName();
            if (nm && nm !== "there") setEpcName(nm);
            setReady(true);
            return;
          }
          clearChatDraft(draftKey()); // submitted or gone
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
  const scrollRef = useScrollToBottom([msgs, busy, done]);

  // Every answer kept in this browser (no request) once the draft exists, so the
  // chat survives a refresh; cleared when the application is submitted.
  useEffect(() => {
    if (!ready || editMode || !appId || done) return;
    const base = { appId, msgs: withoutThumbs(msgs), form, idx, subsidyCase, centralSub, tenure };
    saveChatDraft(draftKey(), { ...base, undo: undoStack.map((s) => ({ ...s, msgs: withoutThumbs(s.msgs) })) }, { ...base, undo: [] });
  }, [ready, editMode, appId, done, msgs, form, idx, undoStack, subsidyCase, centralSub, tenure]);

  // Seed the loan-config defaults on arrival. When editing, prefer the values
  // already on the application (subsidy / tenure); otherwise
  // compute the central subsidy from the plant size, as in a fresh application.
  useEffect(() => {
    if (turn?.id !== "tenure") return;
    const commercial = form.plant_use_type === "commercial";
    const existingCentral = form.central_subsidy != null && form.central_subsidy !== "" ? Number(form.central_subsidy) : null;
    setCentralSub(String(commercial ? 0 : (existingCentral ?? computeCentralSubsidy(Number(form.project_size) || 0))));
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
    const extras = (Object.keys(EXTRA_PICK) as ExtraKey[]).filter((k) => has(EXTRA_PICK[k]));
    if (extras.length) turns.push({ id: "extra_docs", bot: "Add the documents below.", kind: "doc_table", rows: [], extras });
    if (has("coapp_mobile")) turns.push(cloneTurn("coapp_mobile"));
    if (has("coapp_email")) turns.push(cloneTurn("coapp_email"));
    if (has("quotation")) turns.push(cloneTurn("quotation"));
    if (has("borrower_email")) turns.push(cloneTurn("borrower_email"));
    if (has("install_pincode")) turns.push(cloneTurn("install_pincode"));
    if (has("system_type")) turns.push(cloneTurn("system_type"));
    if (has("plant_use_type")) turns.push(cloneTurn("plant_use_type"));
    if (has("connection_category")) turns.push(cloneTurn("connection_category"));
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
    if (!undoStack.length) return;
    const snap = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setMsgs(snap.msgs); setForm(snap.form); setIdx(snap.idx);
    setError(null); setInput("");
  }

  // ── Register: create the draft as soon as we have the mobile, so the
  // document uploads that follow have an application to attach to. ────────────
  async function register(f: Form): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/epc/loan-apply", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ phase: "register", borrower_mobile: f.borrower_mobile }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't start the application."); return false; }
      setAppId(j.id);
      if (leadRef.current) void linkLeadLoan(leadRef.current, j.id).catch(() => {});
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
    const n = Number(amountInput(input));
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
    if (!PINCODE_RE.test(pin)) { setError("Enter a valid 6-digit pincode."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/pincode-lookup?pin=${pin}`, { headers: authHeaders() });
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
    const i = undoStack.findIndex((snap) => snap.idx === ti && snap.form._pass === pass);
    if (i < 0) return;
    const snap = undoStack[i];
    // Prefill the box with the answer given (the live form may hold the other
    // person's value once the roles are assigned or swapped).
    if (script[ti].kind === "text" || script[ti].kind === "pincode" || script[ti].kind === "number") {
      prefillRef.current = value || "";
    }
    setUndoStack(undoStack.slice(0, i));
    setMsgs(snap.msgs); setForm(snap.form); setIdx(snap.idx);
    setError(null);
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
      // An EPC's application carries the central subsidy only — the state subsidy
      // is saved as 0 for EPCs (owner's decision, 24/11), so the EMI leaves it out.
      const central = commercial ? 0 : (Number(form.central_subsidy) || 0);
      const monthlyEmi = tenure ? computeEmi(loanAmt, DEFAULT_INDICATIVE_ROI, tenure) : 0;
      const subsidyEmi = tenure ? computeEmi(Math.max(0, loanAmt - central), DEFAULT_INDICATIVE_ROI, tenure) : 0;
      const res = await fetch("/api/epc/loan-apply", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
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
          connection_category: form.connection_category || null,
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
          // Bank statement + what was read from it (written only when present).
          bank_statement_path: form.bank_statement_path || undefined, bank_statement_method: form.bank_statement_method || undefined,
          bank_account_holder: form.bank_account_holder || undefined, bank_name: form.bank_name || undefined,
          bank_account_no: form.bank_account_no || undefined, bank_ifsc: form.bank_ifsc || undefined,
          bank_account_type: form.bank_account_type || undefined, bank_mobile: form.bank_mobile || undefined, bank_email: form.bank_email || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't submit the application."); return; }
      if (form.lead_owner_name) {
        try { localStorage.setItem(leadOwnerKey(), JSON.stringify({ lead_owner_name: form.lead_owner_name, lead_owner_phone: form.lead_owner_phone || "" })); } catch { /* storage unavailable */ }
      }
      if (!editMode) clearChatDraft(draftKey()); // submitted — the next "Apply" starts fresh
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
    return <SuccessScreen done={done} epcName={epcName} onBack={() => router.push("/dashboard")} />;
  }

  const showDock = !!turn && !busy;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={THEME.canvas}>
      <PartnerChatHeader hideBrokenLogo title={editMode ? "Edit loan application" : "New loan application"}
        subtitle={editMode ? "updating the application" : "building the application"}
        progress={progress} onBack={() => router.push("/dashboard")}>
        <button onClick={undo} disabled={!undoStack.length || busy || !!done}
          className="w-8 h-8 rounded-full hover:bg-white/10 grid place-items-center text-white/80 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent text-[17px] leading-none"
          aria-label="Undo last step" title="Undo last step">↶</button>
      </PartnerChatHeader>

      {/* Messages */}
      <ChatMessages scrollRef={scrollRef}>
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
        {busy && <PartnerTypingBubble />}
        {error && <ChatError text={error} />}
      </ChatMessages>

      {/* Dock */}
      {showDock && turn && (
        <ChatDock cap="max-h-[75vh]">
          {(turn.kind === "text" || turn.kind === "pincode" || turn.kind === "number") && (() => {
            const send = () => void (turn.kind === "pincode" ? submitPincode() : turn.kind === "number" ? submitNumber() : submitText());
            const amt = turn.field && AMOUNT_FIELDS.has(turn.field) ? Number(amountInput(input)) : 0;
            return (
              <div className="flex flex-col gap-1.5">
                {/* Applied loan amount: 80 / 90 / 100 % of the project cost, or Custom. */}
                {turn.field === "loan_amount_required" && (
                  <LoanShareChips cost={Number(form.total_project_cost) || 0} value={input} tone="#1e3a8a"
                    onPick={setInput} onCustom={() => inputRef.current?.focus()} />
                )}
                <PartnerComposer inputRef={inputRef} value={input} onChange={setInput} onSend={send}
                  inputMode={turn.kind === "text" ? "text" : "numeric"} placeholder={turn.placeholder || "Type your answer…"} />
                {amt > 0 && amountInWords(amt) && (
                  <div className="text-[11.5px] text-[#14235c] px-4">₹{amt.toLocaleString("en-IN")} — <span className="font-medium">{amountInWords(amt)} rupees</span></div>
                )}
                {/* The loan as a share of the project cost read from the quotation. */}
                {amt > 0 && pctOf(amt, form.total_project_cost) && (
                  <div className="text-[11.5px] text-[#14235c] px-4">
                    <span className="font-semibold">{pctOf(amt, form.total_project_cost)}</span> of the project cost ({fmtRupees(Number(form.total_project_cost))})
                  </div>
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
              // The first table (applying) also takes any other documents, and more bills /
              // rooftop photos for commercial; an edit step opens just the granted ones.
              extras={turn.extras ? { bills: form.plant_use_type === "commercial", only: turn.extras }
                : !editMode && turn.id === "doc_table" ? { bills: form.plant_use_type === "commercial" } : undefined}
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
              tenure={tenure} setTenure={setTenure}
              onFinish={() => {
                const central = subsidyCase === "non_subsidy" ? 0 : (Number(centralSub) || 0);
                merge({ selected_tenure_years: String(tenure), central_subsidy: String(central) });
                pushUndo(); advance();
              }}
            />
          )}
        </ChatDock>
      )}
    </div>
  );
}
