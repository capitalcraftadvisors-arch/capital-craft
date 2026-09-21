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
// Flow: warm greeting → profile questions one-by-one → create → labelled
// document TABLE (incl. bank statement) → quotation → loan amount → tenure →
// success screen. All uploads/OCR run against the EPC's own token; RLS scopes
// every write to their own rows.

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { getToken, getBusiness, greetingName } from "@/lib/auth";
import { computeCentralSubsidy, computeEmi, DEFAULT_INDICATIVE_ROI, TENURES, formatRupees } from "@/lib/emi";

const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^[1-9]\d{5}$/;

type Form = Record<string, string>;
type Msg = { id: string; _id?: string; from: "bot" | "user"; text?: string; time: string; files?: { name: string; thumb: string | null }[] };
type Choice = { value: string; label: string; sub?: string };
type Turn = {
  id: string;
  bot: string;
  kind: "text" | "pincode" | "choice" | "consent" | "doc_table" | "quotation" | "number" | "tenure";
  field?: string;
  placeholder?: string;
  choices?: Choice[];
  validate?: (v: string) => string | null;
};

const SCRIPT: Turn[] = [
  { id: "borrower_name", bot: "Let's start with the applicant. What is the customer's full name?", kind: "text", field: "borrower_name", placeholder: "Full name", validate: (v) => (v.trim().length < 2 ? "Please enter the applicant's name." : null) },
  { id: "borrower_mobile", bot: "What is the applicant's 10-digit mobile number?", kind: "text", field: "borrower_mobile", placeholder: "10-digit mobile", validate: (v) => (MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile number.") },
  { id: "borrower_email", bot: "And their email address?", kind: "text", field: "borrower_email", placeholder: "name@example.com", validate: (v) => (EMAIL_RE.test(v.trim()) ? null : "Enter a valid email address.") },
  { id: "install_pincode", bot: "Which area is the plant being installed in? Share the 6-digit pincode.", kind: "pincode", field: "install_pincode" },
  { id: "system_type", bot: "What type of solar system is this?", kind: "choice", field: "system_type", choices: [
    { value: "on_grid", label: "On-Grid", sub: "Connected to the grid" },
    { value: "off_grid", label: "Off-Grid", sub: "Battery / standalone" },
    { value: "hybrid", label: "Hybrid", sub: "Grid + battery" },
  ] },
  { id: "plant_use_type", bot: "Is the plant for residential or commercial use?", kind: "choice", field: "plant_use_type", choices: [
    { value: "residential", label: "Residential", sub: "Home / society" },
    { value: "commercial", label: "Commercial", sub: "Shop / office / factory" },
  ] },
  { id: "_has_coapp", bot: "Is there a co-applicant on this loan?", kind: "choice", field: "_has_coapp", choices: [
    { value: "1", label: "Yes", sub: "Add co-applicant documents" },
    { value: "", label: "No", sub: "Single applicant" },
  ] },
  { id: "consent", bot: "Before we upload documents — does the customer agree to the Terms, Privacy & Cookie policies and allow a credit check?", kind: "consent" },
  { id: "doc_table", bot: "Now the documents. Add each one into its box below — I'll read it as it lands. Tick “Don't have it” for anything you can't add right now.", kind: "doc_table" },
  { id: "quotation", bot: "Great. Now the quotation / proforma invoice — upload it and I'll read the project size and cost, or enter them yourself.", kind: "quotation" },
  { id: "loan_amount", bot: "How much loan does the customer need? (₹)", kind: "number", field: "loan_amount_required", placeholder: "e.g. 210000" },
  { id: "tenure", bot: "Last step — choose the loan tenure and I'll estimate the EMI.", kind: "tenure" },
];

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const turn = SCRIPT[idx] ?? null;
  const rmName = greetingName(getBusiness());

  const pushBot = (text: string, id?: string) =>
    setMsgs((m) => (id && m.some((x) => x.from === "bot" && x._id === id) ? m : [...m, { id: uidGen(), _id: id, from: "bot", text, time: nowLabel() }]));
  const pushUser = (text: string, files?: Msg["files"]) =>
    setMsgs((m) => [...m, { id: uidGen(), from: "user", text, time: nowLabel(), files }]);

  // Warm greeting on mount, then the first question.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const name = rmName && rmName !== "there" ? ` ${rmName}` : "";
    pushBot(`नमस्ते${name}! 🙏`, "g1");
    setTimeout(() => pushBot("Welcome to Capital Craft. I'll help you file this loan application in a few quick steps — it only takes a couple of minutes.", "g2"), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask the active turn's question (deduped). The very first question waits for
  // the two greeting bubbles so the order is greeting → welcome → question.
  useEffect(() => {
    if (!turn || done) return;
    const t = setTimeout(() => pushBot(turn.bot, turn.id), idx === 0 ? 800 : 300);
    setError(null); setInput("");
    if ((turn.kind === "text" || turn.kind === "pincode" || turn.kind === "number")) setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, done]);

  // Keep pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, done]);

  const merge = (patch: Form) => setForm((f) => ({ ...f, ...patch }));
  const advance = () => setIdx((i) => i + 1);
  const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });

  // ── Register: create the application after consent ─────────────────────────
  async function register(): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/epc/loan-apply", {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "register",
          borrower_name: form.borrower_name,
          borrower_mobile: form.borrower_mobile,
          borrower_email: form.borrower_email,
          install_pincode: form.install_pincode,
          install_state: form.install_state,
          install_district: form.install_district || null,
          install_city: form.install_city || null,
          system_type: form.system_type,
          plant_use_type: form.plant_use_type,
          consented: true,
        }),
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
    const v = input.trim();
    if (turn.validate) { const e = turn.validate(v); if (e) { setError(e); return; } }
    if (!v) { setError("This field is required."); return; }
    pushUser(v);
    if (turn.field) merge({ [turn.field]: v });
    advance();
  }

  async function submitNumber() {
    if (!turn) return;
    const n = Number(input.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) { setError("Enter a valid amount."); return; }
    const cost = Number(form.total_project_cost) || 0;
    if (cost > 0 && n > cost) { setError(`Loan amount can't exceed the project cost (₹${cost.toLocaleString("en-IN")}).`); return; }
    pushUser(`₹${n.toLocaleString("en-IN")}`);
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
      pushUser(pin);
      merge({ install_pincode: pin, install_state: String(j.state), install_district: String(j.district ?? ""), install_city: String(j.city ?? "") });
      pushBot(`Got it — ${[j.city, j.state].filter(Boolean).join(", ")}.`);
      advance();
    } catch {
      setError("Lookup failed — please try again.");
    } finally { setBusy(false); }
  }

  async function choose(c: Choice) {
    if (!turn?.field) return;
    pushUser(c.label);
    merge({ [turn.field]: c.value });
    advance();
  }

  async function giveConsent() {
    pushUser("Yes, the customer consents.");
    const ok = await register();
    if (ok) advance();
  }

  function finishDocTable(receipt: { name: string; thumb: string | null }[]) {
    if (receipt.length) pushUser(receipt.map((r) => r.name).join(" · "), receipt);
    else pushUser("Continuing without documents for now.");
    advance();
  }

  async function submitApplication() {
    if (!appId) { setError("Application not created."); return; }
    setBusy(true); setError(null);
    try {
      const kw = Number(form.project_size) || 0;
      const commercial = form.plant_use_type === "commercial";
      const loanAmt = Number(form.loan_amount_required) || 0;
      const tenure = Number(form.selected_tenure_years) || 0;
      const central = commercial ? 0 : computeCentralSubsidy(kw);
      const monthlyEmi = tenure ? computeEmi(loanAmt, DEFAULT_INDICATIVE_ROI, tenure) : 0;
      const subsidyEmi = tenure ? computeEmi(Math.max(0, loanAmt - central), DEFAULT_INDICATIVE_ROI, tenure) : 0;
      const res = await fetch("/api/epc/loan-apply", {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "submit", id: appId,
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
          // Co-applicant
          has_coapp: form._has_coapp === "1",
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

  const progress = done ? 100 : Math.round((idx / SCRIPT.length) * 100);

  // ── Success screen ─────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="h-screen grid place-items-center px-5" style={{ background: "linear-gradient(135deg,#e9f4ee 0%,#d6e9df 55%,#cbe3d7 100%)" }}>
        <div className="w-full max-w-[440px] bg-white rounded-3xl shadow-2xl px-7 py-9 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#e6f6ee] grid place-items-center mb-5">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#178a5c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h1 className="font-display text-[23px] font-bold text-[#0f3d2e]">Application filed successfully</h1>
          {done.loanId && <div className="mt-1 text-[12px] font-mono text-[#185fa5]">{done.loanId}</div>}
          <p className="text-[14px] text-text-mid mt-3 leading-relaxed">
            Our team will reach out to you shortly.
          </p>
          <button onClick={() => router.push("/dashboard")} className="mt-7 w-full px-5 py-3 rounded-xl bg-[#178a5c] text-white text-[15px] font-semibold hover:bg-[#12734c] transition-colors">
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const showDock = !!turn && !busy;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "linear-gradient(160deg,#f2f9f5 0%,#e7f2ec 100%)" }}>
      {/* Header */}
      <header className="shrink-0 px-4 sm:px-5 py-2.5 bg-[#0f3d2e] text-white flex items-center gap-3 shadow-sm">
        <button onClick={() => router.push("/dashboard")} className="p-1 -ml-1 text-white/80 hover:text-white text-[20px] leading-none" aria-label="Back">←</button>
        <img src="/brand/capital-craft-mark.png" alt="" className="w-9 h-9 rounded-full bg-white/10 object-contain p-1" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[15px] leading-tight truncate">Capital Craft · New loan application</div>
          <div className="text-[11.5px] text-white/70 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#5df2ad]" /> building the application</div>
        </div>
        <span className="text-[11px] text-white/60 tabular-nums">{progress}%</span>
      </header>
      <div className="h-1.5 bg-black/15 shrink-0"><div className="h-1.5 bg-[#34e39b] rounded-r-full transition-all duration-500" style={{ width: progress + "%" }} /></div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4">
        <div className="max-w-xl mx-auto py-4 flex flex-col gap-1.5">
          {msgs.map((m) => (
            <div key={m.id} className={m.from === "bot" ? "self-start max-w-[88%]" : "self-end max-w-[88%]"}>
              <div className={[
                "rounded-2xl px-3.5 py-2 text-[14px] shadow-sm whitespace-pre-wrap break-words",
                m.from === "bot" ? "bg-white rounded-tl-md border border-[#cdeadd] text-text" : "bg-[#178a5c] rounded-tr-md text-white",
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
            </div>
          ))}
          {busy && (
            <div className="self-start">
              <div className="rounded-2xl rounded-tl-md bg-white border border-[#cdeadd] px-4 py-3 shadow-sm flex gap-1">
                <span className="w-2 h-2 rounded-full bg-[#178a5c]/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-[#178a5c]/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-[#178a5c]/40 animate-bounce" style={{ animationDelay: "300ms" }} />
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
            {(turn.kind === "text" || turn.kind === "pincode" || turn.kind === "number") && (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef} autoFocus value={input}
                  inputMode={turn.kind === "text" ? "text" : "numeric"}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void (turn.kind === "pincode" ? submitPincode() : turn.kind === "number" ? submitNumber() : submitText()); }}
                  placeholder={turn.placeholder || "Type your answer…"}
                  className="flex-1 border border-line rounded-full px-4 py-2.5 text-[14px] bg-white focus:outline-none focus:border-[#178a5c] focus:ring-2 focus:ring-[#178a5c]/15" />
                <button onClick={() => void (turn.kind === "pincode" ? submitPincode() : turn.kind === "number" ? submitNumber() : submitText())} className="w-11 h-11 shrink-0 rounded-full bg-[#178a5c] text-white grid place-items-center hover:bg-[#12734c] shadow-sm" aria-label="Send">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                </button>
              </div>
            )}

            {turn.kind === "choice" && (
              <div className="grid sm:grid-cols-2 gap-2">
                {turn.choices!.map((c) => (
                  <button key={c.value || c.label} onClick={() => void choose(c)} className="text-left px-4 py-3 rounded-xl border border-line bg-white hover:border-[#178a5c] hover:bg-[#f7fcf9] transition">
                    <div className="text-[14px] font-semibold text-text">{c.label}</div>{c.sub && <div className="text-[12px] text-text-muted">{c.sub}</div>}
                  </button>
                ))}
              </div>
            )}

            {turn.kind === "consent" && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => void giveConsent()} className="flex-1 px-4 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold hover:bg-[#12734c]">Yes, the customer consents</button>
                <button onClick={() => router.push("/dashboard")} className="px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid hover:bg-bg-soft">Cancel</button>
              </div>
            )}

            {turn.kind === "doc_table" && appId && (
              <DocTable appId={appId} form={form} onPatch={merge} onDone={finishDocTable} />
            )}

            {turn.kind === "quotation" && appId && (
              <QuotationDock appId={appId} form={form} onPatch={merge} onDone={() => advance()} />
            )}

            {turn.kind === "tenure" && (
              <TenureDock form={form} onPick={(t) => merge({ selected_tenure_years: String(t) })} onSubmit={() => void submitApplication()} />
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

const DOC_ROWS: Row[] = [
  { slot: "aadhaar_front", label: "Applicant Aadhaar — front", unit: "aadhaar", parts: ["aadhaar_front", "aadhaar_back"] },
  { slot: "aadhaar_back", label: "Applicant Aadhaar — back", unit: "aadhaar", parts: ["aadhaar_front", "aadhaar_back"], lastOfUnit: true },
  { slot: "pan", label: "Applicant PAN", unit: "pan", parts: ["pan"], lastOfUnit: true },
  { slot: "ebill", label: "Electricity bill", unit: "ebill", parts: ["ebill"], lastOfUnit: true },
  { slot: "rooftop", label: "Rooftop photo", unit: "rooftop", parts: ["rooftop"], lastOfUnit: true },
  { slot: "selfie", label: "Applicant photo", unit: "selfie", parts: ["selfie"], lastOfUnit: true },
  { slot: "bank", label: "Bank statement", unit: "bank", parts: ["bank"], lastOfUnit: true },
  { slot: "coapp_aadhaar_front", label: "Co-applicant Aadhaar — front", unit: "coapp_aadhaar", parts: ["coapp_aadhaar_front", "coapp_aadhaar_back"], coappOnly: true },
  { slot: "coapp_aadhaar_back", label: "Co-applicant Aadhaar — back", unit: "coapp_aadhaar", parts: ["coapp_aadhaar_front", "coapp_aadhaar_back"], coappOnly: true, lastOfUnit: true },
  { slot: "coapp_pan", label: "Co-applicant PAN", unit: "coapp_pan", parts: ["coapp_pan"], coappOnly: true, lastOfUnit: true },
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

function DocTable({ appId, form, onPatch, onDone }: { appId: string; form: Form; onPatch: (p: Form) => void; onDone: (r: { name: string; thumb: string | null }[]) => void }) {
  const [files, setFiles] = useState<Partial<Record<Slot, SlotFile>>>({});
  const [skipped, setSkipped] = useState<Partial<Record<Slot, boolean>>>({});
  const [reads, setReads] = useState<Partial<Record<Unit, { status: "reading" | "done" | "error"; error?: string }>>>({});
  const filesRef = useRef<Partial<Record<Slot, SlotFile>>>({});
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const rows = DOC_ROWS.filter((r) => !r.coappOnly || form._has_coapp === "1");
  const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });
  const unitPrefilled = (u: Unit) => !!(form[UNIT_DONE_KEY[u]] && String(form[UNIT_DONE_KEY[u]]).trim());
  const unitDone = (u: Unit) => reads[u]?.status === "done" || unitPrefilled(u);
  const rowOpen = (slot: Slot, u: Unit) => !files[slot] && !skipped[slot] && !unitPrefilled(u);
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
      if (applicant) return { borrower_pan: x.pan ?? "", borrower_father_name: x.father_name ?? "", ...(x.dob ? { borrower_dob: x.dob } : {}), ...(x.name && !form.borrower_name ? { borrower_name: x.name } : {}) };
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
    const parts = DOC_ROWS.find((r) => r.slot === slot)!.parts;
    if (parts.every((p) => next[p])) void run(unit, next);
  }
  function toggleSkip(slot: Slot) {
    const now = !skipped[slot];
    setSkipped((s) => ({ ...s, [slot]: now }));
    if (now) { const n = { ...filesRef.current }; delete n[slot]; filesRef.current = n; setFiles(n); }
  }
  function replace(slot: Slot, unit: Unit) {
    const n = { ...filesRef.current };
    for (const p of DOC_ROWS.find((r) => r.slot === slot)!.parts) delete n[p];
    filesRef.current = n; setFiles(n);
    setReads((s) => { const x = { ...s }; delete x[unit]; return x; });
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
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line hover:border-[#178a5c] bg-white px-2.5 py-1.5 cursor-pointer text-[11.5px] font-semibold text-[#178a5c]">
          <span className="text-[13px] leading-none">＋</span> Add
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(r.slot, r.unit, f); e.currentTarget.value = ""; }} />
        </label>
      );
    }
    const live = files[r.slot];
    return (
      <span className="inline-flex items-center gap-1.5">
        {live?.thumb ? <img src={live.thumb} alt="" className="w-8 h-8 rounded-md object-cover border border-line" /> : <span className="w-8 h-8 rounded-md bg-[#f7fcf9] border border-[#cdeadd] grid place-items-center text-[13px]">📄</span>}
        <button onClick={() => replace(r.slot, r.unit)} className="text-[#178a5c] text-[11px] font-semibold hover:underline">Replace</button>
      </span>
    );
  }

  function strip(unit: Unit) {
    const rd = reads[unit];
    if (rd?.status === "reading") return <span className="flex items-center gap-2 text-[11.5px] text-text-muted"><span className="w-3.5 h-3.5 rounded-full border-2 border-[#178a5c]/30 border-t-[#178a5c] animate-spin" /> Reading…</span>;
    if (rd?.status === "error") {
      const canRetry = DOC_ROWS.find((r) => r.unit === unit)!.parts.every((p) => filesRef.current[p]);
      return <span className="flex flex-wrap items-center gap-2 text-[11.5px]"><span className="text-red-600">{rd.error || "Couldn't read that."}</span>{canRetry && <button onClick={() => void run(unit, filesRef.current)} className="text-[#178a5c] font-semibold hover:underline">Try again</button>}</span>;
    }
    if (unitDone(unit)) {
      const build = UNIT_FIELDS[unit];
      return build
        ? <FieldRows fields={build(form).map((x) => ({ ...x, value: form[x.field] || "" }))} onEdit={(field, value) => onPatch({ [field]: value })} />
        : <span className="text-[11.5px] text-[#178a5c] font-medium">Uploaded ✓</span>;
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#f0faf5] border-b border-[#e0f0e8] text-[11px] font-semibold text-[#0f3d2e]">
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
                    <td className="px-3 py-2 align-middle text-right"><input type="checkbox" checked={!!skipped[r.slot]} onChange={() => toggleSkip(r.slot)} className="w-4 h-4 accent-[#178a5c] cursor-pointer align-middle" aria-label={`Don't have ${r.label}`} /></td>
                  </tr>
                  {s && <tr><td colSpan={3} className="px-3 pb-2.5 pt-0">{s}</td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={done} disabled={!allSettled} className="px-4 py-2 rounded-lg bg-[#178a5c] text-white text-[13px] font-semibold hover:bg-[#12734c] disabled:opacity-50">Continue →</button>
        {!allSettled && <span className="text-[11px] text-text-muted">Add or tick “Don&apos;t have it” for every row to continue.</span>}
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
              <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onEdit(f.field, val.trim()); setEditKey(null); } if (e.key === "Escape") setEditKey(null); }} className="border border-[#178a5c] rounded-lg px-2.5 py-1 text-[12.5px] w-40 text-right outline-none" />
              <button onClick={() => { onEdit(f.field, val.trim()); setEditKey(null); }} className="text-[#178a5c] text-[11.5px] font-semibold">Save</button>
            </span>
          ) : (
            <span className="flex items-center gap-2 min-w-0">
              {f.value ? <span className="text-text font-medium text-right break-words">{f.value}</span> : <span className="text-amber-600 text-[11.5px] italic">not found</span>}
              <button onClick={() => { setEditKey(f.field); setVal(f.value); }} className="opacity-60 hover:opacity-100 text-[#178a5c] text-[11px] hover:underline shrink-0" aria-label="Edit">✎</button>
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
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#178a5c] bg-[#f7fcf9] px-4 py-3 cursor-pointer text-[13px] font-semibold text-[#178a5c] hover:bg-[#f0faf5]">
        {status === "reading" ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-[#178a5c]/30 border-t-[#178a5c] animate-spin" /> Reading…</> : <>＋ {status === "done" ? "Re-upload quotation" : "Upload quotation / proforma"}</>}
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
        <button onClick={onDone} disabled={!canContinue} className="px-4 py-2 rounded-lg bg-[#178a5c] text-white text-[13px] font-semibold hover:bg-[#12734c] disabled:opacity-50">Continue →</button>
        {!canContinue && <span className="text-[11px] text-text-muted">Add the project size and cost to continue.</span>}
      </div>
    </div>
  );
}

// ── Tenure + submit ────────────────────────────────────────────────────────
function TenureDock({ form, onPick, onSubmit }: { form: Form; onPick: (t: number) => void; onSubmit: () => void }) {
  const tenure = Number(form.selected_tenure_years) || 0;
  const loanAmt = Number(form.loan_amount_required) || 0;
  const emi = tenure ? computeEmi(loanAmt, DEFAULT_INDICATIVE_ROI, tenure) : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-5 gap-2">
        {TENURES.map((t) => (
          <button key={t} onClick={() => onPick(t)} className={["py-2.5 rounded-xl border text-[13px] font-semibold transition", tenure === t ? "bg-[#178a5c] text-white border-[#178a5c]" : "bg-white border-line text-text-mid hover:border-[#178a5c]"].join(" ")}>
            {t}y
          </button>
        ))}
      </div>
      {tenure > 0 && (
        <div className="rounded-xl border border-line bg-[#f7fcf9] px-4 py-3 text-[13px] text-[#0f3d2e]">
          Estimated EMI <span className="font-bold">{formatRupees(emi)}</span> / month
          <span className="text-text-muted"> · {tenure} year{tenure > 1 ? "s" : ""} · indicative</span>
        </div>
      )}
      <button onClick={onSubmit} disabled={tenure === 0} className="px-4 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold hover:bg-[#12734c] disabled:opacity-50">
        Submit application
      </button>
    </div>
  );
}
