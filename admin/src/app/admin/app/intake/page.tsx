"use client";

// Chatbot intake — a premium, WhatsApp-style guided chat that builds a FULL loan
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { authHeaders, getBusiness } from "@/lib/auth";
import { computeCentralSubsidy, computeEmi, DEFAULT_INDICATIVE_ROI, TENURES } from "@/lib/emi";
import { amountInWords } from "@/lib/numberToWords";
import { PINCODE_RE } from "@/lib/validators";
import { invalidateLoanBoards } from "@/lib/ops-board";
import { askConfirm } from "@/lib/confirm";
import { withoutThumbs } from "@/lib/chat-draft";
import LoanShareChips from "@/components/LoanShareChips";
// The chat kit (src/components/chat) — this chat's green palette is LOAN_INTAKE_THEME.
import { LOAN_INTAKE_THEME as THEME } from "@/components/chat/theme";
import type { ChatMsg, Choice, FileReceipt, Form, ReadConfirm } from "@/components/chat/types";
import { nowLabel } from "@/components/chat/time";
import { useChatLog, useRmFirstName, useScrollToBottom } from "@/components/chat/hooks";
import { ChatDock, ChatError, ChatMessages, EditingBanner } from "@/components/chat/ChatFrame";
import { AdminChatHeader, AdminChatLoading, AdminComposer, ChoiceGrid, DonePanel } from "@/components/chat/AdminChrome";
import { AdminTypingBubble, DateChip, MessageRow } from "@/components/chat/MessageRow";
import { ConfirmCard, FetchedCard } from "@/components/chat/ReadCards";
import { DocDock, useDocDockFiles } from "@/components/chat/DocDock";
// The chat's own parts (./_parts): the script, form rules, document slots + table, info sheet, edit picker, docks.
import { SCRIPT, LEAD_SCRIPT, STEP_PAYLOAD, AMOUNT_FIELDS, choicesOf, fieldLabel, isTurnFilled, isEditableTurn, pendingOf, isProfileComplete } from "./_parts/script";
import { hasCoapp, coappDecision, employmentReset, kwOf } from "./_parts/form-rules";
import { DOC_TABLE_ROWS, billOptional, type DocUnit } from "./_parts/doc-slots";
import { mapExtract, prefillFromApp } from "./_parts/form-map";
import { amountText, parseInfoSheet, SHEET_ROWS, SHEET_AMOUNT_FIELDS, SheetConfirmCard } from "./_parts/info-sheet";
import { editTableGroups, EditPickList } from "./_parts/EditPicker";
import EpcPicker from "./_parts/EpcPicker";
import DocTable from "./_parts/DocTable";
import LoanConfigDock from "./_parts/LoanConfigDock";
import { postLoanForm, sendLoanJson } from "./_parts/requests";

export default function IntakePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

// The highest number among a saved chat's message ids ("m12" → 12). New ids
// continue above it, so no two messages ever share an id.
function maxMsgId(list: ChatMsg[]): number {
  return list.reduce((n, m) => Math.max(n, Number(String(m.id).replace(/\D/g, "")) || 0), 0);
}

function Inner() {
  const router = useRouter();
  const rmName = useRmFirstName();

  // The message list + pushBot / pushUser / say (chat kit).
  const { msgs, setMsgs, idRef, uid, pushBot, pushUser, say, pushFetched, updateFetched } = useChatLog();
  const [idx, setIdx] = useState(0);
  const [form, setForm] = useState<Form>({});
  const formRef = useRef<Form>(form); // the latest form, for the document reads (applyDocPatch)
  formRef.current = form;
  const [appId, setAppId] = useState<string | null>(null);
  const [epcs, setEpcs] = useState<Choice[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Files attached to the current docs turn's slots (chat kit).
  const { files, thumbs, setFileFor, clearFileFor, fillNextSlot, clearFiles } = useDocDockFiles();
  const [confirm, setConfirm] = useState<ReadConfirm | null>(null);
  const [cfEdit, setCfEdit] = useState<string | null>(null); // which "Read from the document" field is being edited
  const [cfVal, setCfVal] = useState("");
  // The card closed or changed → no field stays open in edit with old text.
  useEffect(() => { setCfEdit(null); setCfVal(""); }, [confirm]);
  // Info-sheet paste → editable confirm card (raw parsed values).
  const [sheetReview, setSheetReview] = useState<{ parsed: Form } | null>(null);
  const [donId, setDonId] = useState<string | null>(null);
  const [donDraft, setDonDraft] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ index: number; turnId: string } | null>(null);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editMode, setEditMode] = useState(false);
  // Edit of an application never taken through the steps (a converted lead, an
  // unfinished draft): finishing it runs the same server steps as a new one.
  const [unfinished, setUnfinished] = useState(false);
  // Consent already recorded on the file (edit mode) — a consent given in the
  // chat is stamped through step 1 only when it wasn't.
  const [consentOnFile, setConsentOnFile] = useState(false);
  // Edit-in-chat intro: Q1 (edit filled?) → pick list → re-ask; Q2 (complete?) → ask missing.
  const [editStep, setEditStep] = useState<"q1" | "pick" | "q2" | "flow" | "done" | null>(null);
  const [editStage, setEditStage] = useState<"selected" | "complete">("complete");
  const [editTargets, setEditTargets] = useState<Set<string>>(new Set());
  // Document units to show when re-opening the doc_table in edit mode (empty = all).
  const [editUnits, setEditUnits] = useState<Set<DocUnit>>(new Set());
  const [pickSel, setPickSel] = useState<string[]>([]);
  const [leadMode, setLeadMode] = useState(false);
  const [leadDoneId, setLeadDoneId] = useState<string | null>(null);
  const [epcSearch, setEpcSearch] = useState("");
  const [epcOpen, setEpcOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [undoStack, setUndoStack] = useState<{ msgs: ChatMsg[]; form: Form; idx: number; leadMode: boolean }[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        // 1) Restore a previously-saved chat if one exists — BUT when the user
        // came here to EDIT (edit=1), a leftover *create* chat must NOT be
        // restored: that would resume the old creation wizard and skip the edit
        // Q1/Q2 flow (which recognises what's already filled, incl. documents).
        // So restore only when not editing, or when the saved chat is itself an
        // edit chat (e.g. a mid-edit refresh).
        const res = await fetch(`/api/admin/loan-app/${appParam}/intake-chat`, { headers: authHeaders() });
        const j = await res.json().catch(() => ({}));
        const chat = j?.chat;
        const savedMsgs: ChatMsg[] = (chat && Array.isArray(chat.transcript)) ? (chat.transcript as ChatMsg[]) : [];

        // 1) EDIT session — prefill from the CURRENT profile and run the edit
        // Q1/Q2 flow, but KEEP the previous conversation visible above it as
        // history/context. We never resume the old create cursor (that would skip
        // the edit questions); the edit flow operates on the latest saved data.
        if (editFlag) {
          const app = await loadApp(appParam);
          if (!app) { router.replace(`/admin/app/${appParam}/step-1`); return; }
          const pf = prefillFromApp(app);
          setForm(pf);
          setAppId(appParam);
          setEditMode(true);
          setUnfinished(app.status === "draft" || (Number(app.current_step) || 1) < 6);
          setConsentOnFile(!!app.consent_at);
          setMode("edit");
          if (pf.central_subsidy) setCentralSub(pf.central_subsidy);
          if (pf.state_subsidy) setStateSub(pf.state_subsidy);
          if (pf.selected_tenure_years) setTenure(Number(pf.selected_tenure_years));
          idRef.current = maxMsgId(savedMsgs); // new ids start above the restored ones
          const nm = pf.borrower_name || "this applicant";
          const intro: ChatMsg = { id: uid(), from: "bot", text: `Editing ${nm}'s profile.`, time: nowLabel(), turnId: "edit_intro" };
          // Show the earlier chat (if any) as history, then the edit intro. Drop
          // any prior edit_intro so re-editing doesn't stack duplicate headers.
          const hist = savedMsgs.filter((m) => m.turnId !== "edit_intro");
          setMsgs([...hist, intro]);
          setEditStep("q1"); // Q1/Q2 intro drives the edit; the script runs after
          setIdx(1);
          return;
        }
        // 2) Non-edit resume — restore an in-progress chat if one exists.
        if (savedMsgs.length) {
          idRef.current = maxMsgId(savedMsgs);
          setAppId(appParam);
          setForm((chat.form_state as Form) || {});
          setMsgs(savedMsgs);
          setMode(chat.mode === "edit" ? "edit" : "create");
          setEditMode(chat.mode === "edit");
          if (chat.mode === "edit") setEditStep("q1");
          setIdx(Number(chat.cursor) || 0);
          return;
        }
        // 3) ?app but nothing saved and not an edit → fall back to the classic wizard.
        router.replace(`/admin/app/${appParam}/step-1`);
      } finally {
        setResuming(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The application + its uploaded documents (same request) — documents the
  // partner uploaded live as rows, not columns (prefillFromApp folds them in).
  async function loadApp(id: string): Promise<Record<string, any> | null> {
    const { data } = await supabase().from("epc_applications").select("*, docs:user_application_docs(category, storage_path)").eq("id", id).maybeSingle();
    return (data as Record<string, any>) ?? null;
  }

  // A bank statement on file whose details were never read (e.g. the partner
  // uploaded it): read that file and show the "Read from the document" card —
  // never ask for it again.
  async function readStoredBank() {
    const t = SCRIPT.find((x) => x.id === "bank");
    if (!t || !appId || !form.bank_statement_path) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("path", form.bank_statement_path);
      fd.append("method", form.bank_statement_method || "manual_epdf");
      const r = await postLoanForm(appId, "extract-bank-statement", fd, "Couldn't read the bank statement on file. Attach it again, or skip.");
      if (!r.ok) { setError(r.error); return; }
      const { patch, fields } = mapExtract(t, r.data);
      merge(patch);
      void persistForm({ ...form, ...patch });
      const gaps = fields.filter((f) => !f.ok).map((f) => f.label);
      setConfirm({ fields, note: gaps.length ? `Couldn't read: ${gaps.join(", ")}. You can edit them here.` : "All details read cleanly.", thumbs: [] });
    } finally { setBusy(false); }
  }

  // Autosave the transcript + form + cursor (debounced) so a close/refresh never
  // loses progress. Silent no-op until migration 0070 exists (route fails soft).
  useEffect(() => {
    if (resuming || !appId || donId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // saveTimer is set only while a save is waiting (← flushes it — goBack).
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void saveChat(); }, 700);
    return () => { if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, form, idx, appId, donId, resuming]);

  // Advance the script, running `when` skips and `save` boundaries.
  useEffect(() => {
    if (!turn) return;
    // In edit mode a turn the RM explicitly picked always runs (so a filled-and-
    // gated turn can still be edited); otherwise the `when` gate applies.
    const isSelectedTarget = editMode && editStage === "selected" && editStep === "flow" && editTargets.has(turn.id);
    if (!isSelectedTarget && turn.when && !turn.when(form)) { setIdx((i) => i + 1); return; }
    if (editMode) {
      if (editStep !== "flow") return; // paused during the Q1/Q2 intro
      if (editStage === "selected") { if (!editTargets.has(turn.id)) { setIdx((i) => i + 1); return; } } // re-ask only the picked ones
      else if (isTurnFilled(turn, form)) { setIdx((i) => i + 1); return; } // "complete" → ask only missing
    }
    if (turn.kind === "leadsave") { void createLead(); return; }
    // Bank statement already on file but never read → read it, don't ask for it.
    const bankOnFile = turn.id === "bank" && !!form.bank_statement_path;
    pushBot(bankOnFile ? "The bank statement is already uploaded — reading it." : turn.bot, turn.id);
    setInput(""); setError(null); clearFiles(); setConfirm(null); setEditing(null); setSheetReview(null);
    if (bankOnFile) void readStoredBank();
    // Re-editing a filled field → prefill the input with its current value.
    if (editMode && editStage === "selected" && (turn.kind === "text" || turn.kind === "pincode") && turn.field) setInput(form[turn.field] || "");
    if (turn.kind === "loanconfig") {
      // Prefer the subsidy/tenure the info sheet already carried; else the tier default.
      const sheetSub = Number(form.central_subsidy);
      setCentralSub(Number.isFinite(sheetSub) && form.central_subsidy ? String(sheetSub) : String(form.plant_use_type === "commercial" ? 0 : computeCentralSubsidy(kwOf(form))));
      if (form.selected_tenure_years && tenure == null) { const t = Number(form.selected_tenure_years); if (TENURES.includes(t as (typeof TENURES)[number])) setTenure(t); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, leadMode, editStep, editStage]);

  // When the edit flow reaches the end → Q2 (if still incomplete) or finish.
  useEffect(() => {
    if (!editMode || editStep !== "flow" || turn) return;
    if (editStage === "selected" && !isProfileComplete(form)) setEditStep("q2");
    else void finishEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, editMode, editStep, editStage]);

  // Ask the edit question as a chat bubble when the step changes (deduped by id).
  useEffect(() => {
    if (!editMode) return;
    if (editStep === "q1") pushBot("Do you want to edit any pre-filled details now?", "edit_q1");
    else if (editStep === "pick") pushBot("Select the details you'd like to edit, then tap “Edit selected”.", "edit_pick");
    else if (editStep === "q2") pushBot("This profile isn't complete yet. Do you want to complete it now?", "edit_q2");
  }, [editStep, editMode, pushBot]);

  // Keep the view pinned to the newest message. The FIRST scroll after load jumps
  // instantly to the bottom (so opening an edit lands you at the edit prompt,
  // below the restored history — the user sees what's left to do); later updates
  // animate smoothly.
  const scrollRef = useScrollToBottom([msgs, confirm, idx, busy], { instantFirst: true, hasMessages: msgs.length > 0 });
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  // Paste-to-attach while on a single-doc turn (RM copies an image, hits Ctrl+V).
  // The doc_table turn manages its own paste routing (per-slot) internally.
  useEffect(() => {
    if (!active || confirm || sheetReview) return;
    if (active.kind !== "docs") return;
    const h = (e: ClipboardEvent) => {
      const pasted = e.clipboardData?.files;
      if (!pasted || pasted.length === 0) return;
      e.preventDefault();
      fillNextSlot(active?.uploads ?? [], pasted[0]);
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, files, confirm, sheetReview]);

  const advance = () => setIdx((i) => i + 1);
  const merge = (patch: Form) => setForm((f) => ({ ...f, ...patch }));

  // Undo — snapshot before each entry so the RM can step any action back.
  function pushUndo() { setUndoStack((s) => [...s.slice(-29), { msgs, form, idx, leadMode }]); }
  function undo() {
    if (!undoStack.length) return;
    const snap = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setMsgs(snap.msgs); setForm(snap.form); setLeadMode(snap.leadMode);
    setEditing(null); setError(null); setConfirm(null);
    setIdx(snap.idx); // re-renders that turn fresh (question re-appears)
  }

  // ── Answer the current (or edited) turn ──
  async function answer(value: string, label: string, opts: { extra?: Form; editable?: boolean; createApp?: boolean } = {}) {
    if (editing) return applyEdit(value, label, opts.extra);
    if (!turn) return;
    if (turn.kind !== "epc") pushUndo();
    if (opts.createApp) {
      setBusy(true);
      try {
        const res = await fetch("/api/admin/create-loan-app", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ epc_business_id: value }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't start the application."); setBusy(false); return; }
        setAppId(j.application.id);
        // The application in the address: a refresh (e.g. during a slow OCR) reopens
        // this chat from its autosave instead of starting a new, blank one.
        window.history.replaceState(null, "", `${window.location.pathname}?app=${j.application.id}`);
      } finally { setBusy(false); }
    }
    // Every answer is editable by default — tap the ✎ on any message to change it.
    pushUser(label, { turnId: turn.id, field: turn.field, editable: opts.editable ?? true });
    if (editMode && editStage === "selected" && turn.id === "coapp_needed" && value === "yes") {
      setEditTargets((s) => { const n = new Set(s); ["doc_table", "coapp_relation", "coapp_mobile", "coapp_email"].forEach((t) => n.add(t)); return n; });
      setEditUnits((s) => { const n = new Set(s); n.add("coapp_aadhaar"); n.add("coapp_pan"); return n; });
    }
    if (editMode && editStage === "selected" && turn.id === "profession" && value === "Other") setEditTargets((s) => new Set(s).add("profession_other"));
    const nextForm = { ...form, ...(turn.field ? { [turn.field]: value } : {}), ...coappDecision(turn.id, value), ...employmentReset(turn.id, value, form), ...(opts.extra ?? {}) };
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
    // Editing: skipping a detail already on the profile keeps it as is.
    if (editMode && t.field && (form[t.field] || "").trim()) { pushUser("— skipped —", { turnId: t.id }); advance(); return; }
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
    const transcript = withoutThumbs(msgs);
    try {
      await fetch(`/api/admin/loan-app/${appId}/intake-chat`, {
        method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
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
    if (started && !(await askConfirm("Close this chat? Your progress is saved — you can reopen this application to continue."))) return;
    if (started) {
      // This save covers an autosave still waiting on its timer — drop that one.
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      await saveChat({ markUnderReview: mode === "create" });
    }
    router.push("/admin");
  }
  // Header ← — a save still waiting on the autosave timer goes out first, so
  // the last edits aren't lost (no request when nothing is waiting). An edit
  // chat goes back to the profile it was opened from.
  async function goBack() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; await saveChat(); }
    router.push(editMode && appId ? `/admin/app/${appId}/view` : "/admin");
  }

  async function submitPincode() {
    const pin = input.trim();
    if (!PINCODE_RE.test(pin)) { setError("Enter a valid 6-digit pincode."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/pincode-lookup?pin=${pin}`, { headers: authHeaders() });
      const j = await res.json().catch(() => ({}));
      if (j?.ok) {
        await answer(pin, `${pin} · ${j.city ? j.city + ", " : ""}${j.state}`, { editable: true, extra: { install_state: j.state, install_district: j.district || "", install_city: j.city || "" } });
      } else {
        await answer(pin, pin, { editable: true });
      }
    } finally { setBusy(false); }
  }

  // ── Editing a previous answer ──
  function startEdit(m: ChatMsg) {
    if (!m.turnId || (!m.editable && m.turnId !== "epc")) return; // the EPC answer is always changeable
    const t = script.find((x) => x.id === m.turnId);
    if (!t) return;
    setEditing({ index: msgs.findIndex((x) => x.id === m.id), turnId: m.turnId });
    setError(null);
    if (t.kind === "text" || t.kind === "pincode") setInput((t.field && form[t.field]) || "");
    if (t.kind === "epc") { setEpcSearch(""); setEpcOpen(true); } // re-open the partner list to pick another EPC
    if (t.kind === "docs") { clearFiles(); setConfirm(null); } // re-attach fresh
  }
  async function applyEdit(value: string, label: string, extra?: Form) {
    if (!editing) return;
    pushUndo();
    const { index, turnId } = editing;
    const t = script.find((x) => x.id === turnId);
    const field = t?.field;
    // Changing the EPC partner re-points this application (epc_business_id) —
    // it never creates a new one.
    const nextForm: Form = { ...form, ...(field ? { [field]: value } : {}), ...coappDecision(turnId, value), ...employmentReset(turnId, value, form), ...(t?.kind === "epc" ? { epc_business_id: value } : {}), ...(extra ?? {}) };
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
          const res = await fetch("/api/upload", { method: "POST", headers: authHeaders(), body: fd });
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
      const r = await postLoanForm(appId, t.extractRoute, fd, "Couldn't read the document. Attach a clearer copy, or skip and fill it in later.");
      if (!r.ok) { setError(r.error); setBusy(false); return; }
      const { patch, fields } = mapExtract(t, r.data);
      // Name fallback: if we still don't have the applicant's name, take one read
      // from THIS document (bank-statement holder or e-bill owner, honorific
      // stripped) so we never ask for a name a document already shows.
      if (!form.borrower_name && !patch.borrower_name) {
        const docName = String(patch.bank_account_holder || patch.ebill_name || "")
          .replace(/^(m\/s|mr|mrs|ms|smt|shri|sri|dr)\.?\s+/i, "").trim();
        if (docName.length >= 2) patch.borrower_name = docName;
      }
      merge(patch);
      void persistForm({ ...form, ...patch }); // persist OCR results immediately (create + edit)
      const gaps = fields.filter((f) => !f.ok).map((f) => f.label);
      const note = gaps.length === 0
        ? "All details read cleanly."
        : `Couldn't read: ${gaps.join(", ")}. You can continue and add these later in the profile, or re-attach a clearer copy.`;
      setConfirm({ fields, note, thumbs: receipt.map((r) => r.thumb), edit: isDocEdit });
    } finally { setBusy(false); }
  }
  function retryDocs() { setConfirm(null); clearFiles(); setError(null); }
  function skipDoc() {
    const t = active; if (!t) return;
    pushUndo();
    setMissing((s) => (s.includes(t.docLabel || t.id) ? s : [...s, t.docLabel || t.id]));
    pushUser(`Skipped — ${t.docLabel || "document"} not available yet`, {});
    setConfirm(null);
    advance();
  }

  // ── Document-slot table (doc_table turn) ──
  // The DocTable component owns the per-slot upload + read state; the parent only
  // needs to (a) merge each read's field patch into the form and autosave it,
  // (b) track which rows were marked "don't have it" as pending, and (c) advance
  // when the RM is done. Each row reads with its OWN dedicated extractor and the
  // reads fire in parallel, so nothing here blocks another row.
  function applyDocPatch(patch: Form) {
    // Functional merge keeps parallel reads (and a replace/re-upload) from
    // clobbering each other: persist the FRESHLY-merged form (formRef — reads
    // resolve between renders), never the stale `form` closure — otherwise a
    // re-uploaded doc's new values don't reflect.
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm((prev) => ({ ...prev, ...patch }));
    void persistForm(next);
  }
  // Record / clear a table row in the pending list (draft at submit; never blocks).
  function docSkipChange(label: string, skipped: boolean) {
    // Off-grid: no e-bill is fine — not pending.
    if (skipped && billOptional(form) && label === DOC_TABLE_ROWS.find((r) => r.slot === "ebill")?.label) return;
    setMissing((s) => (skipped ? (s.includes(label) ? s : [...s, label]) : s.filter((x) => x !== label)));
  }
  // "Done with documents" → drop a receipt of what was uploaded now, then advance.
  function finishDocTable(receipt: FileReceipt[]) {
    pushUndo();
    if (receipt.length) pushUser(receipt.map((r) => r.name).join(" · "), { files: receipt, turnId: "doc_table", editable: false });
    advance();
  }

  // ── Info-sheet paste → parse locally → editable confirm card ──
  function parseSheet() {
    const parsed = parseInfoSheet(input);
    const hasAny = SHEET_ROWS.some((r) => parsed[r.field] != null && String(parsed[r.field]).trim() !== "");
    if (!hasAny) { setError("I couldn't find any labeled details in that. Check the sheet, or skip and add them later."); return; }
    setError(null);
    setSheetReview({ parsed: parsed as Form });
  }
  function editSheetField(field: string, value: string) {
    const v = SHEET_AMOUNT_FIELDS.has(field) ? amountText(value) : value; // "1,80,000" → "180000"
    setSheetReview((r) => r ? { ...r, parsed: { ...r.parsed, [field]: v } } : r);
  }
  function confirmSheet() {
    if (!sheetReview) return;
    pushUndo();
    const patch: Form = {};
    for (const r of SHEET_ROWS) { const v = sheetReview.parsed[r.field]; if (v != null && String(v).trim() !== "") patch[r.field] = String(v).trim(); }
    if (patch.coapp_name && patch.coapp_name.trim()) patch._has_coapp = "1";
    const nextForm = { ...form, ...patch };
    setForm(nextForm);
    pushUser("Info-sheet details confirmed", { turnId: "info_sheet" });
    void persistForm(nextForm);
    setSheetReview(null); setInput("");
    advance();
  }
  function skipSheet() {
    pushUndo();
    pushUser("— skipped —", { turnId: "info_sheet", editable: false });
    setSheetReview(null); setInput("");
    advance();
  }

  // ── Persistence ──
  // Silent background write of the accumulated form (any order — no step advance,
  // no status change) so a close/refresh keeps everything gathered so far. The
  // update-fields route filters to its column allow-list.
  async function persistForm(f: Form) {
    if (!appId) return;
    try {
      const coapp = hasCoapp(f) ? { bill_on_applicant_name: false } : f.coapp_needed === "no" ? { bill_on_applicant_name: true } : {};
      await fetch(`/api/admin/loan-app/${appId}/update-fields`, { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ ...f, ...coapp }) });
    } catch { /* best-effort */ }
  }

  // Direct column write used by edit mode. Returns false on error (keeps the RM
  // on the same turn so nothing is silently lost).
  async function patchFields(obj: Record<string, unknown>): Promise<boolean> {
    if (!appId) return true;
    setBusy(true); setError(null);
    try {
      const r = await sendLoanJson(appId, "update-fields", obj, "Couldn't save the change.", "PATCH");
      if (!r.ok) { setError(r.error); return false; }
      return true;
    } finally { setBusy(false); }
  }

  // Walk the server steps in order — records consent, writes the step-level
  // fields (co-applicant flag …) and advances current_step; step 5 only with a
  // loan configuration. update-fields already wrote the columns; these confirm.
  async function postStep(step: 1 | 2 | 3 | 4): Promise<boolean> {
    const r = await sendLoanJson(appId, `complete-step-${step}`, STEP_PAYLOAD[step](form), `Couldn't save step ${step}.`, step === 1 ? "PATCH" : "POST");
    if (!r.ok) { setError(r.error); return false; }
    return true;
  }
  async function runSteps(config: Record<string, unknown> | null): Promise<boolean> {
    for (const step of [1, 2, 3, 4] as const) if (!(await postStep(step))) return false;
    if (!config) { invalidateLoanBoards(); return true; }
    const r5 = await sendLoanJson(appId, "complete-step-5", config, "Couldn't save loan configuration.");
    if (!r5.ok) { setError(r5.error); return false; }
    invalidateLoanBoards();
    return true;
  }
  async function submitApp(): Promise<boolean> {
    const r6 = await sendLoanJson(appId, "complete-step-6", {}, "Couldn't submit the application.");
    if (!r6.ok) { setError(r6.error); return false; }
    invalidateLoanBoards();
    return true;
  }
  // The saved loan configuration (from the profile), for step 5.
  const savedConfig = (f: Form) => (f.selected_tenure_years ? {
    roi_percent: Number(f.roi_percent) || DEFAULT_INDICATIVE_ROI, central_subsidy: Number(f.central_subsidy) || 0, state_subsidy: Number(f.state_subsidy) || 0,
    selected_tenure_years: Number(f.selected_tenure_years), selected_monthly_emi: Number(f.selected_monthly_emi) || 0, selected_subsidy_emi: Number(f.selected_subsidy_emi) || 0,
  } : null);

  // End of an edit. An unfinished application (converted lead / draft) gets the
  // steps a new one gets — consent, co-applicant flag, current_step — and is
  // submitted once nothing required is missing, so the classic form, the
  // profile and the tables all see it complete.
  async function finishEdit(config?: Record<string, unknown>) {
    if (!unfinished) {
      // A submitted file: save a re-picked loan configuration, and record a
      // consent given in this edit (step 1 stamps it and never rewinds).
      if (config && !(await patchFields(config))) return;
      if (form.consent === "yes" && !consentOnFile) {
        setBusy(true); setError(null);
        try { if (!(await postStep(1))) return; } finally { setBusy(false); }
        setConsentOnFile(true);
      }
      say("bot", "Changes saved — the profile is up to date."); setDonId(appId); setEditStep("done"); return;
    }
    setBusy(true); setError(null);
    try {
      if (!(await runSteps(config ?? savedConfig(form)))) return;
      const pending = pendingOf(config ? { ...form, selected_tenure_years: String(config.selected_tenure_years) } : form);
      if (pending.length) {
        say("bot", `Saved as a draft — still pending: ${pending.join(", ")}.`);
      } else {
        if (!(await submitApp())) return;
        setUnfinished(false);
        say("bot", "All done — the profile is complete and submitted.");
      }
      setDonId(appId); setEditStep("done");
    } finally { setBusy(false); }
  }

  // A finished create chat → its address becomes an edit of the saved profile, so
  // browser Back / a refresh opens the edit flow, not the stale last create step.
  function markEditUrl(id: string) {
    window.history.replaceState(null, "", `${window.location.pathname}?app=${id}&edit=1`);
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
      const config = { roi_percent: DEFAULT_INDICATIVE_ROI, central_subsidy: central, state_subsidy: stateS, selected_tenure_years: tenure, selected_monthly_emi: monthly, selected_subsidy_emi: subEmi };
      if (editMode) {
        pushUser("Save changes", {});
        setBusy(false); await finishEdit(config); return;
      }
      if (!(await runSteps(config))) { setBusy(false); return; }

      if (missing.length > 0) {
        // Something required was skipped → keep it as a draft to finish later.
        pushUser("Create the application", {});
        say("bot", `Saved to your applications table as a draft — still pending: ${missing.join(", ")}. Open it anytime from the table to add what's left.`);
        markEditUrl(appId);
        setDonDraft(true); setDonId(appId); setBusy(false); return;
      }
      if (!(await submitApp())) { setBusy(false); return; }
      pushUser("Create the application", {});
      say("bot", "All done — the profile is ready and now in your applications table. You can open it to review or edit anytime.");
      markEditUrl(appId);
      setDonId(appId);
    } finally { setBusy(false); }
  }

  // ── Edit-in-chat Q1/Q2 ──
  function startFlow(stage: "selected" | "complete") { setEditStage(stage); setEditStep("flow"); setIdx(1); }
  function answerQ1(yes: boolean) {
    pushUser(yes ? "Yes — edit some details" : "No", {});
    if (yes) { setPickSel([]); setEditStep("pick"); return; }
    if (!isProfileComplete(form)) setEditStep("q2");
    else if (unfinished) void finishEdit();
    else { say("bot", "Your profile is already completed — nothing pending."); setDonId(appId); setEditStep("done"); }
  }
  function answerQ2(yes: boolean) {
    pushUser(yes ? "Yes — complete it" : "No, later", {});
    if (yes) startFlow("complete");
    else if (unfinished) void finishEdit();
    else { say("bot", "Okay — your changes are saved. You can finish it anytime."); setDonId(appId); setEditStep("done"); }
  }
  function editSelected() {
    if (!pickSel.length) return;
    const rows = editTableGroups(form).flatMap((g) => g.rows);
    const chosen = rows.filter((r) => pickSel.includes(r.key));
    const turns = new Set<string>(); const units = new Set<DocUnit>();
    for (const r of chosen) { r.turns.forEach((t) => turns.add(t)); (r.units ?? []).forEach((u) => units.add(u)); }
    pushUser(`Edit: ${chosen.map((r) => r.label).join(", ")}`, {});
    setEditTargets(turns); setEditUnits(units);
    startFlow("selected");
  }

  // Edit a value the OCR fetched (from the permanent card) — reflects on the
  // profile immediately and updates what the card shows.
  function saveFetchedField(msgId: string, field: string, value: string) {
    const nextForm = { ...form, [field]: value };
    setForm(nextForm);
    void persistForm(nextForm);
    updateFetched(msgId, field, value);
  }
  // Edit a field directly on the "Read from the document" confirm card (before
  // "Looks good") — so e.g. the bank statement can be corrected as soon as it's
  // read, like the table documents.
  function saveConfirmField(field: string, value: string) {
    const nextForm = { ...form, [field]: value };
    setForm(nextForm);
    void persistForm(nextForm);
    setConfirm((c) => (c ? { ...c, fields: c.fields.map((ff) => (ff.field === field ? { ...ff, value, ok: !!value } : ff)) } : c));
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

  // Progress = how COMPLETE the profile actually is (filled applicable steps),
  // not just how far the cursor has moved. This makes it consistent no matter how
  // the profile was filled — a profile built in the CLASSIC form (prefilled here
  // in edit mode) shows its true high %, and create mode still climbs as answers
  // come in.
  const progApplicable = script.filter((t) => isEditableTurn(t) && (!t.when || t.when(form)));
  const progFilled = progApplicable.filter((t) => isTurnFilled(t, form)).length;
  const progress = progApplicable.length ? Math.min(100, Math.round((progFilled / progApplicable.length) * 100)) : 0;
  const showEditIntro = editMode && (editStep === "q1" || editStep === "pick" || editStep === "q2");
  const showDock = !donId && !leadDoneId && !showEditIntro && active && !confirm && !sheetReview && active.kind !== "save" && active.kind !== "leadsave" && (editing ? true : turn === active);

  if (resuming) return <AdminChatLoading theme={THEME} label="Restoring your chat…" />;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={THEME.canvas}>
      <AdminChatHeader theme={THEME} title={leadMode ? "New lead" : editMode ? "Edit profile" : "New application"}
        subtitle={leadMode ? "capturing a lead" : editMode ? "completing the profile" : "building the profile"}
        progress={progress} onBack={() => void goBack()} onClose={() => void closeChat()}>
        <button onClick={undo} disabled={!undoStack.length || !!donId || !!leadDoneId} className="w-8 h-8 rounded-full hover:bg-white/10 grid place-items-center text-white/80 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent text-[17px] leading-none" aria-label="Undo last" title="Undo last">↶</button>
      </AdminChatHeader>

      {/* Messages */}
      <ChatMessages scrollRef={scrollRef}>
        <DateChip theme={THEME} />

        {msgs.map((m) => m.fetched
          ? <FetchedCard key={m.id} theme={THEME} m={m} onSave={saveFetchedField} />
          : <MessageRow key={m.id} theme={THEME} m={m} rmName={rmName} onEdit={() => startEdit(m)} editingId={editing ? msgs[editing.index]?.id : null} canEdit={m.editable || m.turnId === "epc"} />
        )}

        {busy && <AdminTypingBubble />}

        {/* Read-from-document card — every value with a field is editable before "Looks good" */}
        {confirm && (
          <ConfirmCard theme={THEME} thumbs={confirm.thumbs} note={confirm.note} onReattach={retryDocs}
            onLooksGood={() => { const c = confirm; if (c) pushFetched(c.fields); const wasEdit = c?.edit; setConfirm(null); if (wasEdit) setEditing(null); else advance(); }}>
            {confirm.fields.map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-[13px] min-h-[26px]">
                <span className="text-text-muted shrink-0">{f.label}</span>
                {cfEdit === f.field && f.field ? (
                  <span className="flex items-center gap-1.5">
                    <input autoFocus value={cfVal} onChange={(e) => setCfVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { saveConfirmField(f.field!, cfVal.trim()); setCfEdit(null); } if (e.key === "Escape") setCfEdit(null); }}
                      className="border border-cc-green rounded-lg px-2.5 py-1 text-[13px] w-44 text-right outline-none" />
                    <button onClick={() => { saveConfirmField(f.field!, cfVal.trim()); setCfEdit(null); }} className="text-cc-green text-[11.5px] font-semibold">Save</button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2 min-w-0">
                    {f.ok
                      ? <span className="text-text font-medium text-right break-words">{f.value}</span>
                      : <span className="text-amber-600 text-[12px] italic">not found</span>}
                    {f.field && <button onClick={() => { setCfEdit(f.field!); setCfVal(f.ok ? f.value : ""); }} className="opacity-60 hover:opacity-100 text-cc-green text-[11px] hover:underline shrink-0" aria-label="Edit">✎</button>}
                  </span>
                )}
              </div>
            ))}
          </ConfirmCard>
        )}

        {/* Info-sheet confirm card — parsed fields, every one editable */}
        {sheetReview && (
          <SheetConfirmCard parsed={sheetReview.parsed} onEdit={editSheetField} onConfirm={confirmSheet} onSkip={skipSheet} />
        )}

        {error && <ChatError text={error} />}

        {editMode && !donId && !turn && !resuming && !busy && !error && (
          <DonePanel theme={THEME} message="All set — the profile is up to date."
            actionLabel="Open the profile →" onAction={() => router.push(`/admin/app/${appId}/view`)} />
        )}

        {leadDoneId && (
          <DonePanel theme={THEME} message="✓ Lead saved — it's in your Lead tab."
            actionLabel="Open the lead →" onAction={() => router.push(`/admin/lead/${leadDoneId}/view`)}
            secondaryLabel="Go to console" onSecondary={() => router.push("/admin")} />
        )}

        {donId && (
          <DonePanel theme={THEME}
            message={donDraft ? "Draft saved — the profile is in your applications table." : "✓ Profile is ready — it's in your applications table."}
            actionLabel="Open the profile →" onAction={() => router.push(`/admin/app/${donId}/view`)}
            secondaryLabel="Go to applications table" onSecondary={() => router.push("/admin")} />
        )}
      </ChatMessages>

      {/* Edit-in-chat intro: Q1 (edit filled?) → pick list → Q2 (complete?) */}
      {showEditIntro && (
        <ChatDock>
          {editStep === "q1" && (
            <div className="flex gap-2">
              <button onClick={() => answerQ1(true)} className="flex-1 px-4 py-2.5 rounded-xl bg-cc-green text-white text-[14px] font-semibold hover:bg-cc-green-hover">Yes — edit details</button>
              <button onClick={() => answerQ1(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid hover:bg-bg-soft">No</button>
            </div>
          )}
          {editStep === "pick" && (
            <EditPickList form={form} pickSel={pickSel} setPickSel={setPickSel} onEditSelected={editSelected} onBack={() => setEditStep("q1")} />
          )}
          {editStep === "q2" && (
            <div className="flex gap-2">
              <button onClick={() => answerQ2(true)} className="flex-1 px-4 py-2.5 rounded-xl bg-cc-green text-white text-[14px] font-semibold hover:bg-cc-green-hover">Yes — complete it</button>
              <button onClick={() => answerQ2(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid hover:bg-bg-soft">No, later</button>
            </div>
          )}
        </ChatDock>
      )}

      {/* Dock — the controls for the active question. Caps its height and scrolls
          internally so a tall dock (e.g. the document table, once rows expand
          their extracted fields) can never overflow the fixed chat frame and
          strand the lower rows / the "Done" button out of reach. */}
      {showDock && active && (
        <ChatDock cap="max-h-[75vh]">
          {editing && <EditingBanner theme={THEME} onCancel={cancelEdit} />}

          {active.kind === "epc" && (
            <EpcPicker epcs={epcs} filteredEpcs={filteredEpcs} epcSearch={epcSearch} setEpcSearch={setEpcSearch} epcOpen={epcOpen} setEpcOpen={setEpcOpen}
              onPick={(e) => void answer(e.value, e.label, { createApp: true, editable: true })} onNewLead={startLead} />
          )}

          {active.kind === "choice" && (
            <div className="flex flex-col gap-2">
              <ChoiceGrid theme={THEME} choices={choicesOf(active, form)} onPick={(c) => void answer(c.value, c.label, { editable: true })} />
              {!editing && <button onClick={() => void skipText()} className="self-start px-3 py-1.5 text-[13px] text-text-muted hover:text-text" title="Continue without this — you can add it later">Skip</button>}
            </div>
          )}

          {(active.kind === "text" || active.kind === "pincode") && (
            <div className="flex flex-col gap-1">
              {/* Applied loan amount: 80 / 90 / 100 % of the project cost, or Custom. */}
              {active.field === "loan_amount_required" && (
                <div className="mb-1">
                  <LoanShareChips cost={Number(form.total_project_cost) || 0} value={input}
                    onPick={setInput} onCustom={() => inputRef.current?.focus()} />
                </div>
              )}
              <AdminComposer theme={THEME} inputRef={inputRef} value={input} onChange={setInput}
                onSend={() => void (active.kind === "pincode" ? submitPincode() : submitText())}
                editing={!!editing} onCancelEdit={cancelEdit} placeholder={active.placeholder || "Type a message…"}
                skipLabel={active.optional ? "Skip" : "Don't have it"} onSkip={() => void skipText()} />
              {active.field && AMOUNT_FIELDS.has(active.field) && amountInWords(Number(input)) && (
                <div className="text-[11.5px] text-cc-ink px-3">₹{Number(input).toLocaleString("en-IN")} — <span className="font-medium">{amountInWords(Number(input))} rupees</span></div>
              )}
            </div>
          )}

          {active.kind === "consent" && (
            <div className="flex gap-2">
              <button onClick={() => void answer("yes", "Yes, consent given")} className="flex-1 px-4 py-2.5 rounded-xl bg-cc-green text-white text-[14px] font-semibold hover:bg-cc-green-hover">Yes, consent given</button>
              {!editing && <button onClick={() => void skipText()} className="px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid hover:bg-bg-soft" title="Continue without this — you can record it later">Skip</button>}
              <button onClick={() => router.push("/admin")} className="px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid">Cancel</button>
            </div>
          )}

          {active.kind === "paste" && (
            <div className="flex flex-col gap-2">
              <textarea autoFocus value={input} onChange={(e) => setInput(e.target.value)} rows={6}
                placeholder={active.placeholder || "Paste the applicant's info sheet here…"}
                className="w-full border border-line rounded-xl px-3.5 py-2.5 text-[13.5px] leading-snug bg-white focus:outline-none focus:border-cc-green focus:ring-2 focus:ring-cc-green/15 resize-y" />
              <div className="flex items-center gap-2">
                <button onClick={parseSheet} disabled={!input.trim()} className="px-4 py-2 rounded-lg bg-cc-green text-white text-[13px] font-semibold hover:bg-cc-green-hover disabled:opacity-50">Read the sheet →</button>
                <button onClick={skipSheet} className="px-3 py-2 rounded-lg text-[12.5px] text-text-muted hover:text-text hover:bg-bg-soft">Skip</button>
              </div>
            </div>
          )}

          {active.kind === "docs" && (
            <DocDock theme={THEME} uploads={active.uploads!} files={files} thumbs={thumbs} onPick={setFileFor}
              onClear={clearFileFor} onRun={() => void runDocs()} onSkip={skipDoc} replacing={!!editing}
              runLabel={editing ? "Re-read & replace" : `Read ${active.extractRoute ? "document" : "& attach"}`} />
          )}

          {active.kind === "doc_table" && appId && (
            <DocTable key="doc_table" appId={appId} form={form}
              onPatch={applyDocPatch} onSkipChange={docSkipChange} onDone={finishDocTable}
              limitUnits={editMode && editStage === "selected" ? editUnits : undefined} />
          )}

          {active.kind === "loanconfig" && (
            <LoanConfigDock loanAmt={loanAmt} subsidyCase={subsidyCase} setSubsidyCase={setSubsidyCase}
              centralSub={centralSub} setCentralSub={setCentralSub} stateSub={stateSub} setStateSub={setStateSub}
              tenure={tenure} setTenure={setTenure} onFinish={() => void finishLoanConfig()} finishLabel={editMode ? "Save changes" : "Create application →"} />
          )}
        </ChatDock>
      )}
    </div>
  );
}
