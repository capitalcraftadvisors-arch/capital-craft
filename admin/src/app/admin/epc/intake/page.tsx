"use client";

// EPC onboarding chatbot — a premium, WhatsApp-style guided chat that builds a
// FULL EPC partner profile (the same six-step onboarding the classic wizard
// collects) and submits it for verification. It MIRRORS the loan intake chatbot
// (src/app/admin/app/intake/page.tsx): same canvas, bubbles, doc-upload turns,
// "Read from the document" OCR card, editable typed answers (✎), and the
// "Don't have it — skip" behaviour. Those shared pieces live in the chat kit
// (src/components/chat); this chat draws them in its blue EPC_INTAKE_THEME.
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

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/auth";
import { uploadDocument } from "@/lib/storage";
import FileUpload from "@/components/FileUpload";
import { MOBILE_RE, ACCOUNT_RE } from "@/lib/validators";
// The chat kit (src/components/chat) — this chat's blue palette is EPC_INTAKE_THEME.
import { EPC_INTAKE_THEME as THEME } from "@/components/chat/theme";
import type { ChatMsg, Choice, Fetched, Form, ReadConfirm } from "@/components/chat/types";
import { useChatLog, useRmFirstName, useScrollToBottom } from "@/components/chat/hooks";
import { ChatDock, ChatError, ChatMessages, EditingBanner } from "@/components/chat/ChatFrame";
import { AdminChatHeader, AdminChatLoading, AdminComposer, ChoiceGrid, DonePanel } from "@/components/chat/AdminChrome";
import { AdminTypingBubble, DateChip, MessageRow } from "@/components/chat/MessageRow";
import { ConfirmCard, FetchedCard } from "@/components/chat/ReadCards";
import { DocDock, useDocDockFiles } from "@/components/chat/DocDock";
// This chat's own pieces: the script, the document reader and the two multi-row docks.
import { SCRIPT, PREFILL_KEYS, extraDocLabel, fieldLabel, missingRequired, type Turn } from "./_parts/script";
import { ocrDoc } from "./_parts/ocr";
import StakeholdersDock from "./_parts/StakeholdersDock";
import ReferencesDock from "./_parts/ReferencesDock";
import { normalizeStakeholder, type EpcReference as Ref, type Stakeholder } from "@/lib/epc-stakeholders";

export default function EpcIntakePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const rmName = useRmFirstName();

  // The message list + pushBot / pushUser / say (chat kit).
  const { msgs, setMsgs, uid, pushBot, pushUser, say, pushFetched, updateFetched } = useChatLog();
  const [idx, setIdx] = useState(0);
  const [form, setForm] = useState<Form>({});
  const [epcId, setEpcId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Files attached to the current docs turn's slots (chat kit).
  const { files, thumbs, setFileFor, clearFileFor, fillNextSlot, clearFiles } = useDocDockFiles();
  const [confirm, setConfirm] = useState<ReadConfirm | null>(null);
  const [donId, setDonId] = useState<string | null>(null);
  const [donDraft, setDonDraft] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ index: number; turnId: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [docCats, setDocCats] = useState<Set<string>>(new Set());
  const [bankStmtCount, setBankStmtCount] = useState(0);

  // Stakeholders + references seed data (from an existing row on resume/edit).
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [initCustomers, setInitCustomers] = useState<Ref[]>([]);
  const [initSuppliers, setInitSuppliers] = useState<Ref[]>([]);
  const [initReferral, setInitReferral] = useState("");
  const [initReferralOther, setInitReferralOther] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const stepReached = useRef(1);

  const turn = SCRIPT[idx] ?? null;
  const editTurn = editing ? SCRIPT.find((t) => t.id === editing.turnId) ?? null : null;
  const active = editTurn ?? turn;

  const advance = () => setIdx((i) => i + 1);
  const merge = (patch: Form) => setForm((f) => ({ ...f, ...patch }));

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
      const cats = ((docs ?? []) as { category: string }[]);
      setDocCats(new Set(cats.map((d) => d.category)));
      setBankStmtCount(cats.filter((d) => d.category === "bank_statement").length);
    } catch { /* ignore */ }
  }

  // Advance the script — running `when` skips, and (in edit/resume) skipping
  // turns that are already filled so we only ask for what's missing.
  useEffect(() => {
    if (resuming || !turn) return;
    if (turn.when && !turn.when(form)) { setIdx((i) => i + 1); return; }
    if (editMode && turn.id !== "submit" && isTurnFilled(turn)) { replay(turn); setIdx((i) => i + 1); return; }
    pushBot(botText(turn), turn.id);
    if (turn.id === "office") pushBot("Geo-tagged on-site photos can be redone later from the classic form — plain images are fine here.", "office_note");
    setInput(""); setError(null); clearFiles(); setConfirm(null); setEditing(null);
    if (turn.id === "mobile") { const p = new URLSearchParams(window.location.search).get("mobile"); if (p) setInput(p.replace(/\D/g, "").slice(0, 10)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, editMode, resuming]);

  // Keep the view pinned to the newest message (the first scroll with messages jumps, later ones animate).
  const scrollRef = useScrollToBottom([msgs, confirm, idx, busy], { instantFirst: true, hasMessages: msgs.length > 0 });
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  // Paste-to-attach while on a document turn.
  useEffect(() => {
    if (!active || active.kind !== "docs" || confirm) return;
    const h = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0];
      if (f) { e.preventDefault(); fillNextSlot(active?.uploads ?? [], f); }
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
      case "bankstatements": return bankStmtCount >= 1;
      case "docs": return (t.filledCats ?? []).length > 0 && (t.filledCats ?? []).every((c) => docCats.has(c));
      case "stakeholders": return stakeholders.length > 0 && stakeholders.every((s) => !!s.name?.trim());
      case "references": return initCustomers.length + initSuppliers.length > 0;
      case "submit": return false;
    }
    return false;
  }

  function botText(t: Turn): string {
    return t.id === "extra_doc" ? `Upload the ${extraDocLabel(form.business_type) ?? "entity document"}.` : t.bot;
  }

  // Edit / resume: an already-answered turn is shown as it was answered — the
  // question, then the answer from the saved profile (editable like a live one,
  // plus the "Read from the document" card for PAN / GST / cheque) — so the
  // earlier chat is there instead of a blank screen.
  function replay(t: Turn) {
    const f = (label: string, field: string): Fetched => ({ label, value: form[field] ?? "", ok: !!form[field], field });
    let answer: Partial<ChatMsg> | null = null;
    let fetched: Fetched[] | null = null;
    switch (t.kind) {
      case "text":
        answer = { text: form[t.field ?? ""] ?? "", editable: true };
        break;
      case "choice": {
        const v = form[t.filledBy ?? t.field ?? ""] ?? "";
        answer = { text: t.choices?.find((c) => c.value === v)?.label ?? v, editable: true };
        break;
      }
      case "docs":
        answer = { files: (t.uploads ?? []).filter((u) => docCats.has(u.category)).map((u) => ({ name: u.label, thumb: null })), editable: true };
        if (t.ocr === "pan") fetched = [f("PAN", "pan_number")];
        else if (t.ocr === "gst") fetched = [f("Legal name", "legal_name"), f("Trade name", "trade_name"), f("GSTIN", "gstin_number"), f("GST address", "gst_address")];
        else if (t.ocr === "cheque") fetched = [f("Account no.", "bank_account_number"), f("IFSC", "bank_ifsc"), f("Bank", "bank_name")];
        break;
      case "confirmacct": answer = { text: "Account number confirmed ✓" }; break;
      case "bankstatements": answer = { text: `${bankStmtCount} bank statements uploaded` }; break;
      case "stakeholders": answer = { text: stakeholders.map((s) => s.name).filter(Boolean).join(", ") }; break;
      case "references": answer = { text: `Saved ${initCustomers.length + initSuppliers.length} references` }; break;
    }
    if (!answer) return;
    const a = answer;
    setMsgs((m) => {
      if (m.some((x) => x.turnId === t.id)) return m;
      const out: ChatMsg[] = [...m,
        { id: uid(), from: "bot", text: botText(t), time: "", turnId: t.id },
        { id: uid(), from: "user", time: "", turnId: t.id, field: t.field, ...a },
      ];
      if (fetched) out.push({ id: uid(), from: "bot", time: "", fetched });
      return out;
    });
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

  // ── 12-month bank statements ──
  function submitBankStatements() {
    const t = active; if (!t) return;
    if (bankStmtCount < 1) { setError("Please upload the last 12 months' bank statements."); return; }
    pushUser(`${bankStmtCount} bank statements uploaded`, { turnId: t.id });
    if (t.step) maybeBumpStep(t.step);
    advance();
  }
  function skipBankStatements() {
    const t = active; if (!t || editing) return;
    setMissing((s) => (s.includes("Bank statements") ? s : [...s, "Bank statements"]));
    pushUser("— skipped —", { turnId: t.id });
    advance();
  }

  // ── Editing a previous answer ──
  function startEdit(m: ChatMsg) {
    if (!m.turnId || !m.editable) return;
    const t = SCRIPT.find((x) => x.id === m.turnId);
    if (!t) return;
    setEditing({ index: msgs.findIndex((x) => x.id === m.id), turnId: m.turnId });
    setError(null);
    if (t.kind === "text" || t.kind === "confirmacct") setInput((t.field && form[t.field]) || "");
    if (t.kind === "docs") { clearFiles(); setConfirm(null); }
  }
  async function applyEdit(value: string, label: string) {
    if (!editing) return;
    const { index, turnId } = editing;
    const t = SCRIPT.find((x) => x.id === turnId);
    const nf: Form = { ...form, ...(t?.field ? { [t.field]: value } : {}) };
    setForm(nf);
    // index -1 = a question asked during the edit that had no answer yet → add the answer.
    if (index < 0) pushUser(label, { turnId, field: t?.field, editable: true });
    else setMsgs((m) => m.map((x, i) => (i === index ? { ...x, text: label, edited: true } : x)));
    if (t?.write) await patchBiz(t.write(value, nf));
    // Designation changed to "Other" → ask the first pass's "Please specify" turn
    // (re-editing its earlier answer if there is one) and save that answer.
    if (turnId === "contact_designation" && value === "Other" && turn?.id !== "designation_other") {
      const spec = SCRIPT.find((x) => x.id === "designation_other")!;
      const at = msgs.findIndex((x) => x.from === "user" && x.turnId === spec.id);
      if (at < 0) pushBot(spec.bot, spec.id);
      setEditing({ index: at, turnId: spec.id });
      setInput(at < 0 ? "" : form.contact_designation || "");
      return;
    }
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

  function retryDocs() { setConfirm(null); clearFiles(); setError(null); }
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
    updateFetched(msgId, field, value);
  }

  // ── Mobile → create the EPC (or open the existing one) ──
  async function submitMobile() {
    const m = input.replace(/\D/g, "");
    if (!MOBILE_RE.test(m)) { setError("Enter a valid 10-digit mobile."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/create-epc", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ mobile: m }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't create the EPC."); setBusy(false); return; }
      const biz = j.business;
      pushUser(m, { turnId: "mobile" });
      setEpcId(biz.id);
      // The EPC in the address: a refresh (e.g. during a slow OCR) reopens it and
      // replays every saved answer, then asks only what's still missing.
      window.history.replaceState(null, "", `${window.location.pathname}?epc=${biz.id}`);
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

  if (resuming) return <AdminChatLoading theme={THEME} label="Loading the EPC…" />;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={THEME.canvas}>
      <AdminChatHeader theme={THEME} title={editMode ? "Edit EPC" : "New EPC"} subtitle={editMode ? "completing the profile" : "building the profile"}
        progress={progress}
        // ← from a profile's "Continue in chat" (?edit=1) goes back to that profile.
        onBack={() => router.push(epcId && new URLSearchParams(window.location.search).get("edit") === "1" ? `/admin/epc/${epcId}/view` : "/admin")}
        onClose={() => router.push("/admin")} />

      {/* Messages */}
      <ChatMessages scrollRef={scrollRef}>
        <DateChip theme={THEME} />

        {msgs.map((m) => m.fetched
          ? <FetchedCard key={m.id} theme={THEME} m={m} onSave={saveFetchedField} />
          : <MessageRow key={m.id} theme={THEME} m={m} rmName={rmName} onEdit={() => startEdit(m)} editingId={editing ? msgs[editing.index]?.id : null} />
        )}

        {busy && <AdminTypingBubble />}

        {/* Read-from-document card — this chat shows the values read-only */}
        {confirm && (
          <ConfirmCard theme={THEME} thumbs={confirm.thumbs} note={confirm.note} onReattach={retryDocs}
            onLooksGood={() => { const c = confirm; if (c) pushFetched(c.fields); const wasEdit = c?.edit; setConfirm(null); if (wasEdit) setEditing(null); else advance(); }}>
            {confirm.fields.map((f, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-text-muted shrink-0">{f.label}</span>
                {f.ok
                  ? <span className="text-text font-medium text-right break-words">{f.value}</span>
                  : <span className="text-amber-600 text-[12px] italic">not found</span>}
              </div>
            ))}
          </ConfirmCard>
        )}

        {error && <ChatError text={error} />}

        {donId && (
          <DonePanel theme={THEME}
            message={donDraft ? "Draft saved — the EPC is on your Task Manager board." : "✓ EPC submitted — it's in “Review by CC”."}
            actionLabel="Open the EPC →" onAction={() => router.push(`/admin/epc/${donId}/view`)}
            secondaryLabel="Go to console" onSecondary={() => router.push("/admin")} />
        )}
      </ChatMessages>

      {/* Dock — the controls for the active question */}
      {showDock && active && (
        <ChatDock>
          {editing && <EditingBanner theme={THEME} onCancel={cancelEdit} />}

          {active.kind === "mobile" && (
            <div className="flex items-center gap-2">
              <input ref={inputRef} autoFocus value={input} onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => { if (e.key === "Enter") void submitMobile(); }}
                inputMode="numeric" placeholder="10-digit mobile" className="flex-1 border border-line rounded-full px-4 py-2.5 text-[14px] bg-white focus:outline-none focus:border-cc-blue focus:ring-2 focus:ring-cc-blue/15" />
              <button onClick={() => void submitMobile()} className="px-4 h-11 shrink-0 rounded-full bg-cc-blue text-white text-[13px] font-semibold grid place-items-center hover:bg-cc-blue-dark shadow-sm">Create EPC</button>
            </div>
          )}

          {active.kind === "choice" && (
            <div className="flex flex-col gap-2">
              <ChoiceGrid theme={THEME} choices={active.choices!} onPick={chooseChoice} />
            </div>
          )}

          {(active.kind === "text" || active.kind === "confirmacct") && (
            <AdminComposer theme={THEME} inputRef={inputRef} value={input} onChange={setInput}
              onSend={() => void (active.kind === "confirmacct" ? submitConfirmAcct() : submitText())}
              editing={!!editing} onCancelEdit={cancelEdit} placeholder={active.placeholder || "Type a message…"}
              skipLabel={active.kind === "text" ? (active.optional ? "Skip" : "Don't have it") : undefined} onSkip={() => skipText()} />
          )}

          {active.kind === "docs" && (
            <DocDock theme={THEME} uploads={active.uploads!} files={files} thumbs={thumbs} onPick={setFileFor}
              onClear={clearFileFor} onRun={() => void runDocs()} onSkip={skipDoc} replacing={!!editing}
              runLabel={active.ocr ? (editing ? "Re-read & replace" : "Read document") : (editing ? "Replace" : "Upload & attach")} />
          )}

          {active.kind === "bankstatements" && epcId && (
            <div className="flex flex-col gap-2">
              <FileUpload businessId={epcId} table="epc_documents" category="bank_statement" maxFiles={Infinity} dedupe uploadedBy="admin" onCountChange={setBankStmtCount} uploadHint="PDF or image" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-text-muted">{bankStmtCount} uploaded</span>
                <div className="flex items-center gap-2">
                  <button onClick={skipBankStatements} className="px-3 py-2 text-[13px] text-text-muted hover:text-text">Skip</button>
                  <button onClick={submitBankStatements} disabled={bankStmtCount < 1} className="px-4 py-2 rounded-xl bg-cc-blue text-white text-[14px] font-semibold hover:bg-cc-blue-dark disabled:opacity-50">Continue →</button>
                </div>
              </div>
            </div>
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
              <button onClick={() => void doSubmit()} className="px-4 py-2.5 rounded-xl bg-cc-blue text-white text-[14px] font-semibold hover:bg-cc-blue-dark">Submit for verification →</button>
            </div>
          )}
        </ChatDock>
      )}
    </div>
  );
}
