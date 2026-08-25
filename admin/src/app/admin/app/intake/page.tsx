"use client";

// AI intake — a premium guided chat that builds a FULL loan application (all 5
// steps), then submits it as a complete profile. Documents do the data entry
// (OCR via the existing extract-* routes); the chat collects everything else.
// It writes through the SAME create + complete-step routes the wizard uses, so
// the result is identical to a hand-entered profile. View/edit/wizard untouched.
//
// Note: the document turns (KYC / e-bill / bank) call routes that store to
// Google Cloud Storage — locally that needs ADC (`gcloud auth
// application-default login`); on prod it's automatic.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
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
  kind: "epc" | "text" | "pincode" | "choice" | "consent" | "docs" | "save" | "loanconfig";
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
  // save turn:
  step?: number;
  method?: "POST" | "PATCH";
  payload?: (f: Form) => Record<string, unknown>;
};

const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isYes = (f: Form) => f.bill_on_applicant_name === "no"; // e-bill NOT in applicant name → co-applicant

const SCRIPT: Turn[] = [
  // ── Step 1 · Registration ──
  { id: "epc", bot: "Which EPC partner is this application for?", kind: "epc" },
  { id: "borrower_name", bot: "Applicant's full name?", kind: "text", field: "borrower_name", placeholder: "Full name", validate: (v) => (v.trim().length < 2 ? "Enter the applicant's name." : null) },
  { id: "borrower_mobile", bot: "Customer phone number?", kind: "text", field: "borrower_mobile", placeholder: "10-digit mobile", validate: (v) => (MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile.") },
  { id: "borrower_email", bot: "Email ID? (optional)", kind: "text", field: "borrower_email", placeholder: "name@example.com", optional: true, validate: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? null : "Enter a valid email or leave blank.") },
  { id: "install_pincode", bot: "Installation pincode?", kind: "pincode", field: "install_pincode" },
  { id: "system_type", bot: "Solar system preference?", kind: "choice", field: "system_type", choices: [
    { value: "on_grid", label: "On-Grid", sub: "Sells excess to grid" },
    { value: "off_grid", label: "Off-Grid", sub: "Battery, independent" },
    { value: "hybrid", label: "Hybrid", sub: "Grid + battery" },
  ] },
  { id: "plant_use_type", bot: "Residential or commercial use?", kind: "choice", field: "plant_use_type", choices: [
    { value: "residential", label: "Residential", sub: "Home / society" },
    { value: "commercial", label: "Commercial", sub: "Shop / office / factory" },
  ] },
  { id: "consent", bot: "Does the customer consent to the Terms, Privacy & Cookie policies and allow credit information access?", kind: "consent", field: "consent" },
  { id: "save1", bot: "Saving registration…", kind: "save", step: 1, method: "PATCH", payload: (f) => ({
    borrower_name: f.borrower_name || "", borrower_mobile: f.borrower_mobile || "", borrower_email: f.borrower_email || "",
    install_pincode: f.install_pincode || "", install_state: f.install_state || "", install_district: f.install_district || "", install_city: f.install_city || "",
    system_type: f.system_type || "", plant_use_type: f.plant_use_type || "",
    consent_policies: ["terms_conditions", "privacy_policy", "cookie_policy"],
  }) },

  // ── Step 2 · KYC (Aadhaar) ──
  { id: "aadhaar", bot: "Upload the applicant's Aadhaar (front & back) — I'll read the details.", kind: "docs",
    uploads: [{ name: "front", label: "Aadhaar front" }, { name: "back", label: "Aadhaar back" }], extractRoute: "extract-aadhaar" },
  { id: "save2", bot: "Saving KYC…", kind: "save", step: 2, method: "POST", payload: (f) => ({
    aadhaar_name: f.aadhaar_name || "", aadhaar_dob: f.aadhaar_dob || "", aadhaar_gender: f.aadhaar_gender || "",
    aadhaar_number: f.aadhaar_number || "", aadhaar_care_of: f.aadhaar_care_of || "", aadhaar_address: f.aadhaar_address || "",
    aadhaar_front_path: f.aadhaar_front_path || "", aadhaar_back_path: f.aadhaar_back_path || "", aadhaar_face_path: f.aadhaar_face_path || "",
  }) },

  // ── Step 3 · Loan requirement + installation ──
  { id: "loandocs", bot: "Upload the quotation / proforma invoice and the latest electricity bill.", kind: "docs",
    uploads: [{ name: "proforma", label: "Quotation / invoice" }, { name: "ebill", label: "Electricity bill" }], extractRoute: "extract-loan-docs" },
  { id: "loan_amount_required", bot: "Loan amount required (₹)?", kind: "text", field: "loan_amount_required", placeholder: "e.g. 200000", validate: (v) => (Number(v) > 0 ? null : "Enter a valid amount.") },
  { id: "rooftop", bot: "Upload the geo-tagged rooftop photo.", kind: "docs",
    uploads: [{ name: "photo", label: "Rooftop photo" }], extractRoute: "" },
  { id: "bill_on_applicant_name", bot: "Is the electricity bill in the applicant's name?", kind: "choice", field: "bill_on_applicant_name", choices: [
    { value: "yes", label: "Yes" }, { value: "no", label: "No — there's a co-applicant" },
  ] },
  // Co-applicant (only when the e-bill is NOT in the applicant's name)
  { id: "coapp_pan", bot: "Upload the co-applicant's PAN.", kind: "docs", when: isYes,
    uploads: [{ name: "file", label: "Co-applicant PAN" }], extractRoute: "extract-coapp-pan" },
  { id: "coapp_aadhaar", bot: "Upload the co-applicant's Aadhaar (front & back).", kind: "docs", when: isYes,
    uploads: [{ name: "front", label: "Aadhaar front" }, { name: "back", label: "Aadhaar back" }], extractRoute: "extract-aadhaar", extraForm: { _coapp: "1" } },
  { id: "coapp_relation", bot: "Co-applicant's relation to the applicant?", kind: "text", field: "coapp_relation", placeholder: "e.g. Spouse, Father", when: isYes, optional: true },
  { id: "save3", bot: "Saving loan & installation details…", kind: "save", step: 3, method: "POST", payload: (f) => ({
    project_size: f.project_size || "", project_size_unit: f.project_size_unit || "kw",
    total_project_cost: f.total_project_cost || "", loan_amount_required: f.loan_amount_required || "",
    monthly_bill_amount: f.monthly_bill_amount || "", discom_name: f.discom_name || "", ca_number: f.ca_number || "",
    ebill_address_line: f.ebill_address_line || "", ebill_name: f.ebill_name || "",
    ebill_path: f.ebill_path || "", ebill_uploaded_at: f.ebill_uploaded_at || "",
    proforma_invoice_path: f.proforma_invoice_path || "", proforma_uploaded_at: f.proforma_uploaded_at || "",
    rooftop_photo_path: f.rooftop_photo_path || "", rooftop_photo_uploaded_at: f.rooftop_photo_uploaded_at || "",
    install_pincode: f.install_pincode || "", install_state: f.install_state || "", install_city: f.install_city || "",
    bill_on_applicant_name: f.bill_on_applicant_name === "yes",
    coapp_name: f.coapp_name || "", coapp_father_name: f.coapp_father_name || "", coapp_dob: f.coapp_dob || "",
    coapp_pan: f.coapp_pan || "", coapp_pan_path: f.coapp_pan_path || "", coapp_relation: f.coapp_relation || "",
    coapp_aadhaar_name: f.coapp_aadhaar_name || "", coapp_aadhaar_dob: f.coapp_aadhaar_dob || "", coapp_aadhaar_gender: f.coapp_aadhaar_gender || "",
    coapp_aadhaar_number: f.coapp_aadhaar_number || "", coapp_aadhaar_care_of: f.coapp_aadhaar_care_of || "", coapp_aadhaar_address: f.coapp_aadhaar_address || "",
    coapp_aadhaar_front_path: f.coapp_aadhaar_front_path || "", coapp_aadhaar_back_path: f.coapp_aadhaar_back_path || "", coapp_aadhaar_face_path: f.coapp_aadhaar_face_path || "",
  }) },

  // ── Step 4 · Employment + bank ──
  { id: "employment_type", bot: "Employment type?", kind: "choice", field: "employment_type", choices: [
    { value: "salaried", label: "Salaried" }, { value: "self_employed", label: "Self-employed" },
  ] },
  { id: "profession", bot: "Profession?", kind: "text", field: "profession", placeholder: "e.g. Engineer", optional: true },
  { id: "organization_name", bot: "Organization / business name?", kind: "text", field: "organization_name", placeholder: "Organization", optional: true },
  { id: "annual_income", bot: "Annual income (₹)?", kind: "text", field: "annual_income", placeholder: "e.g. 600000", optional: true },
  { id: "bank", bot: "Upload the bank statement.", kind: "docs",
    uploads: [{ name: "file", label: "Bank statement" }], extractRoute: "extract-bank-statement", extraForm: { method: "manual_epdf" } },
  { id: "save4", bot: "Saving personal & bank details…", kind: "save", step: 4, method: "POST", payload: (f) => ({
    employment_type: f.employment_type || "", profession: f.profession || "", profession_other: "", organization_name: f.organization_name || "", annual_income: f.annual_income || "",
    bank_statement_method: f.bank_statement_method || "manual_epdf", bank_statement_path: f.bank_statement_path || "", bank_statement_uploaded_at: f.bank_statement_uploaded_at || "",
    bank_account_holder: f.bank_account_holder || "", bank_name: f.bank_name || "", bank_account_no: f.bank_account_no || "",
    bank_ifsc: f.bank_ifsc || "", bank_account_type: f.bank_account_type || "", bank_mobile: f.bank_mobile || "", bank_email: f.bank_email || "",
  }) },

  // ── Step 5 · Loan configuration (subsidy + tenure w/ live EMI) ──
  { id: "loanconfig", bot: "Last step — loan configuration.", kind: "loanconfig" },
];

type Msg = { from: "bot" | "user"; text: string };

function Inner() {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [idx, setIdx] = useState(0);
  const [form, setForm] = useState<Form>({});
  const [appId, setAppId] = useState<string | null>(null);
  const [epcs, setEpcs] = useState<Choice[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [pinInfo, setPinInfo] = useState<{ district: string; city: string } | null>(null);
  const [confirmLines, setConfirmLines] = useState<string[] | null>(null);
  const [donId, setDonId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Loan-config (step 5) local inputs
  const [subsidyCase, setSubsidyCase] = useState<"subsidy" | "non_subsidy">("subsidy");
  const [centralSub, setCentralSub] = useState("");
  const [stateSub, setStateSub] = useState("");
  const [tenure, setTenure] = useState<number | null>(null);

  const turn = SCRIPT[idx] ?? null;

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().from("epc_business")
        .select("id, epc_display_id, contact_name, trade_name, legal_name")
        .eq("has_lender_approval", true).neq("business_type", "admin")
        .order("trade_name", { ascending: true, nullsFirst: false });
      setEpcs(((data ?? []) as Record<string, string>[]).map((e) => ({ value: e.id, label: e.trade_name || e.legal_name || e.contact_name || "(unnamed)", sub: e.epc_display_id || undefined })));
    })();
  }, []);

  // Skip turns whose `when` predicate is false.
  useEffect(() => {
    if (turn && turn.when && !turn.when(form)) { setIdx((i) => i + 1); return; }
    if (turn && turn.kind === "save") { void doSave(turn); return; }
    if (turn) setMsgs((m) => (m.length && m[m.length - 1].text === turn.bot ? m : [...m, { from: "bot", text: turn.bot }]));
    setInput(""); setError(null); setPinInfo(null); setConfirmLines(null); setFiles({});
    if (turn?.kind === "loanconfig") setCentralSub(String(form.plant_use_type === "commercial" ? 0 : computeCentralSubsidy(kwOf(form))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, confirmLines, idx, pinInfo]);

  const say = useCallback((from: "bot" | "user", text: string) => setMsgs((m) => [...m, { from, text }]), []);
  const advance = () => setIdx((i) => i + 1);
  const merge = (patch: Form) => setForm((f) => ({ ...f, ...patch }));

  async function answer(value: string, label?: string, extra?: Form) {
    if (!turn) return;
    say("user", label ?? value);
    merge({ ...(turn.field ? { [turn.field]: value } : {}), ...(extra ?? {}) });
    if (turn.kind === "epc") {
      setBusy(true);
      try {
        const res = await fetch("/api/admin/create-loan-app", { method: "POST", headers: hdr(), body: JSON.stringify({ epc_business_id: value }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't start the application."); setBusy(false); return; }
        setAppId(j.application.id);
      } finally { setBusy(false); }
    }
    advance();
  }

  function hdr() { return { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` }; }

  async function submitText() {
    if (!turn) return;
    const v = input.trim();
    if (turn.validate) { const e = turn.validate(v); if (e) { setError(e); return; } }
    if (!v && !turn.optional) { setError("This field is required."); return; }
    await answer(v);
  }

  async function submitPincode() {
    const pin = input.trim();
    if (!/^[1-9]\d{5}$/.test(pin)) { setError("Enter a valid 6-digit pincode."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/pincode-lookup?pin=${pin}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      const j = await res.json().catch(() => ({}));
      if (j?.ok) { setPinInfo({ district: j.district, city: j.city }); await answer(pin, `${pin} — ${j.state}`, { install_state: j.state, install_district: j.district || "", install_city: j.city || "" }); }
      else await answer(pin, pin, {});
    } finally { setBusy(false); }
  }

  // Upload the turn's files → extract route → merge OCR fields + paths → confirm.
  async function runDocs() {
    if (!turn || !appId) return;
    const needed = turn.uploads ?? [];
    for (const u of needed) if (!files[u.name]) { setError(`Please upload: ${u.label}.`); return; }
    setBusy(true); setError(null);
    try {
      say("user", needed.map((u) => u.label).join(", ") + " uploaded");
      if (!turn.extractRoute) {
        // e.g. rooftop photo — store via generic upload (path only). For now, mark path pending.
        merge({ rooftop_photo_path: "pending", rooftop_photo_uploaded_at: new Date().toISOString() });
        advance(); return;
      }
      const fd = new FormData();
      for (const u of needed) fd.append(u.name, files[u.name]);
      for (const [k, v] of Object.entries(turn.extraForm ?? {})) fd.append(k, v);
      const res = await fetch(`/api/admin/loan-app/${appId}/${turn.extractRoute}`, { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't read the document(s). You can still continue and fix it in the application."); setBusy(false); return; }
      const { patch, lines } = mapExtract(turn, j);
      merge(patch);
      setConfirmLines(lines);
    } finally { setBusy(false); }
  }

  async function doSave(t: Turn) {
    if (!appId || !t.step || !t.payload) { advance(); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/loan-app/${appId}/complete-step-${t.step}`, { method: t.method || "POST", headers: hdr(), body: JSON.stringify(t.payload(form)) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't save step ${t.step}.`); setBusy(false); return; }
      advance();
    } finally { setBusy(false); }
  }

  // Step 5 → save config → submit (step 6) → done.
  async function finishLoanConfig() {
    if (!appId || tenure == null) { setError("Pick a tenure to continue."); return; }
    setBusy(true); setError(null);
    try {
      const central = subsidyCase === "non_subsidy" ? 0 : Math.max(0, Math.min(78000, Number(centralSub) || 0));
      const stateS = subsidyCase === "non_subsidy" ? 0 : Math.max(0, Number(stateSub) || 0);
      const loanAmt = Number(form.loan_amount_required) || 0;
      const principal = Math.max(0, loanAmt - central - stateS);
      const monthly = computeEmi(loanAmt, DEFAULT_INDICATIVE_ROI, tenure);
      const subEmi = computeEmi(principal, DEFAULT_INDICATIVE_ROI, tenure);
      const r5 = await fetch(`/api/admin/loan-app/${appId}/complete-step-5`, { method: "POST", headers: hdr(), body: JSON.stringify({
        roi_percent: DEFAULT_INDICATIVE_ROI, central_subsidy: central, state_subsidy: stateS,
        selected_tenure_years: tenure, selected_monthly_emi: monthly, selected_subsidy_emi: subEmi,
      }) });
      const j5 = await r5.json().catch(() => ({}));
      if (!r5.ok || !j5?.ok) { setError(j5?.error || "Couldn't save loan configuration."); setBusy(false); return; }
      const r6 = await fetch(`/api/admin/loan-app/${appId}/complete-step-6`, { method: "POST", headers: hdr(), body: JSON.stringify({}) });
      const j6 = await r6.json().catch(() => ({}));
      if (!r6.ok || !j6?.ok) { setError(j6?.error || "Couldn't submit the application."); setBusy(false); return; }
      say("bot", "Done — the complete loan application has been created and submitted. You can open it to review or edit anytime.");
      setDonId(appId);
    } finally { setBusy(false); }
  }

  const progress = Math.min(100, Math.round((idx / SCRIPT.length) * 100));
  const loanAmt = Number(form.loan_amount_required) || 0;

  return (
    <div className="min-h-screen bg-bg-soft flex flex-col">
      <header className="px-5 sm:px-8 py-4 border-b border-line bg-white flex items-center justify-between">
        <button onClick={() => router.push("/admin")} className="text-[13px] text-text-muted hover:text-text">← Console</button>
        <span className="font-display font-bold text-[16px] text-[#0f3d2e]">New loan application</span>
        <span className="text-[12px] text-text-muted w-16 text-right">{progress}%</span>
      </header>
      <div className="h-1 bg-[#e6f3ec]"><div className="h-1 bg-[#178a5c] transition-all" style={{ width: progress + "%" }} /></div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-0">
        <div className="max-w-xl mx-auto py-6 flex flex-col gap-3">
          {msgs.map((m, i) => (
            <div key={i} className={m.from === "bot" ? "self-start" : "self-end"}>
              {m.text && <div className={["px-4 py-2.5 rounded-2xl text-[14px] max-w-[85%]", m.from === "bot" ? "bg-white border border-line text-text rounded-tl-sm" : "bg-[#178a5c] text-white rounded-tr-sm ml-auto"].join(" ")}>{m.text}</div>}
            </div>
          ))}
          {pinInfo && <div className="self-start text-[12px] text-text-muted px-1">District: <b>{pinInfo.district}</b> · Area: <b>{pinInfo.city}</b></div>}

          {/* Confirm card after an OCR read */}
          {confirmLines && (
            <div className="self-start w-full max-w-[85%] rounded-xl border border-[#cdeadd] bg-[#f0faf5] p-3">
              <div className="text-[12px] font-semibold text-[#0f3d2e] mb-1">Read from the document</div>
              <div className="text-[13px] text-text-mid flex flex-col gap-0.5">{confirmLines.map((l, i) => <div key={i}>{l}</div>)}</div>
              <button onClick={() => { setConfirmLines(null); advance(); }} className="mt-2 px-3 py-1.5 rounded-lg bg-[#178a5c] text-white text-[12px] font-semibold">Looks good →</button>
              <span className="text-[11px] text-text-muted ml-2">You can fine-tune anything later in the application.</span>
            </div>
          )}

          {/* Input widget */}
          {!donId && turn && !busy && !confirmLines && (
            <div className="self-stretch mt-1">
              {turn.kind === "epc" && (
                <div className="grid gap-2">
                  {epcs.length === 0 ? <div className="text-[13px] text-text-muted">Loading partners…</div> : epcs.map((e) => (
                    <button key={e.value} onClick={() => void answer(e.value, e.label)} className="text-left px-4 py-3 rounded-xl border border-line bg-white hover:border-[#178a5c]">
                      <div className="text-[14px] font-semibold text-text">{e.label}</div>{e.sub && <div className="text-[12px] text-text-muted font-mono">{e.sub}</div>}
                    </button>
                  ))}
                </div>
              )}
              {turn.kind === "choice" && (
                <div className="grid sm:grid-cols-2 gap-2">
                  {turn.choices!.map((c) => (
                    <button key={c.value} onClick={() => void answer(c.value, c.label)} className="text-left px-4 py-3 rounded-xl border border-line bg-white hover:border-[#178a5c]">
                      <div className="text-[14px] font-semibold text-text">{c.label}</div>{c.sub && <div className="text-[12px] text-text-muted">{c.sub}</div>}
                    </button>
                  ))}
                </div>
              )}
              {(turn.kind === "text" || turn.kind === "pincode") && (
                <div className="flex gap-2">
                  <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void (turn.kind === "pincode" ? submitPincode() : submitText()); }}
                    placeholder={turn.placeholder || "Type…"} className="flex-1 border border-line rounded-xl px-4 py-2.5 text-[14px] bg-white" />
                  <button onClick={() => void (turn.kind === "pincode" ? submitPincode() : submitText())} className="px-4 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold">Send</button>
                  {turn.optional && <button onClick={() => void answer("")} className="px-3 py-2.5 rounded-xl border border-line text-[13px]">Skip</button>}
                </div>
              )}
              {turn.kind === "consent" && (
                <div className="flex gap-2">
                  <button onClick={() => void answer("yes", "Yes, consent given")} className="flex-1 px-4 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold">Yes, consent given</button>
                  <button onClick={() => router.push("/admin")} className="px-4 py-2.5 rounded-xl border border-line text-[14px]">Cancel</button>
                </div>
              )}
              {turn.kind === "docs" && (
                <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3">
                  {turn.uploads!.map((u) => (
                    <label key={u.name} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-text-mid">{u.label}{files[u.name] ? " ✓" : ""}</span>
                      <input type="file" accept="image/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFiles((s) => ({ ...s, [u.name]: f })); }} className="text-[12px]" />
                    </label>
                  ))}
                  <button onClick={() => void runDocs()} className="mt-1 px-4 py-2 rounded-lg bg-[#178a5c] text-white text-[13px] font-semibold self-start">Read documents</button>
                </div>
              )}
              {turn.kind === "loanconfig" && (
                <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
                  <div>
                    <div className="text-[12px] text-text-muted mb-1">Subsidy case?</div>
                    <div className="flex gap-2">
                      {(["subsidy", "non_subsidy"] as const).map((s) => (
                        <button key={s} onClick={() => setSubsidyCase(s)} className={["px-3 py-1.5 rounded-lg text-[13px] font-semibold border", subsidyCase === s ? "bg-[#178a5c] text-white border-[#178a5c]" : "bg-white border-line"].join(" ")}>{s === "subsidy" ? "Subsidy" : "Non-subsidy"}</button>
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
                    <div className="text-[12px] text-text-muted mb-1">Tenure (live EMI on ₹{loanAmt.toLocaleString("en-IN")})</div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {TENURES.map((t) => (
                        <button key={t} onClick={() => setTenure(t)} className={["px-1 py-2 rounded-lg text-center border", tenure === t ? "bg-[#178a5c] text-white border-[#178a5c]" : "bg-white border-line"].join(" ")}>
                          <div className="text-[13px] font-bold">{t}y</div>
                          <div className="text-[10px] opacity-80">{loanAmt > 0 ? formatRupees(computeEmi(loanAmt, DEFAULT_INDICATIVE_ROI, t)) : "—"}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => void finishLoanConfig()} disabled={tenure == null} className="mt-1 px-4 py-2.5 rounded-lg bg-[#178a5c] text-white text-[14px] font-semibold disabled:opacity-60 self-start">Create application →</button>
                </div>
              )}
            </div>
          )}

          {busy && <div className="self-start text-[13px] text-text-muted px-1">Working…</div>}
          {error && <div className="self-stretch text-[13px] text-red-600 px-1">{error}</div>}
          {donId && (
            <div className="self-stretch mt-2">
              <button onClick={() => router.push(`/admin/app/${donId}/view`)} className="w-full px-4 py-3 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold">Open the application →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function kwOf(f: Form): number | null {
  const s = Number(f.project_size);
  if (!s) return null;
  return f.project_size_unit === "mw" ? s * 1000 : s;
}

// Map an extract route's JSON response → { form patch, confirm lines }.
function mapExtract(turn: Turn, j: Record<string, any>): { patch: Form; lines: string[] } {
  const coapp = turn.extraForm?._coapp === "1";
  if (turn.extractRoute === "extract-aadhaar") {
    const f = j.fields ?? {}, p = j.storage_paths ?? {};
    if (coapp) return { patch: {
      coapp_aadhaar_name: f.name ?? "", coapp_aadhaar_dob: f.dob ?? "", coapp_aadhaar_gender: f.gender ?? "", coapp_aadhaar_number: f.aadhaar_number ?? "",
      coapp_aadhaar_care_of: f.care_of ?? "", coapp_aadhaar_address: f.address ?? "",
      coapp_aadhaar_front_path: p.front ?? "", coapp_aadhaar_back_path: p.back ?? "", coapp_aadhaar_face_path: p.face ?? "",
      coapp_name: f.name ?? "", coapp_dob: f.dob ?? "",
    }, lines: [`Name: ${f.name ?? "—"}`, `DOB: ${f.dob ?? "—"}`, `Aadhaar: ${f.aadhaar_masked ?? f.aadhaar_number ?? "—"}`] };
    return { patch: {
      aadhaar_name: f.name ?? "", aadhaar_dob: f.dob ?? "", aadhaar_gender: f.gender ?? "", aadhaar_number: f.aadhaar_number ?? "",
      aadhaar_care_of: f.care_of ?? "", aadhaar_address: f.address ?? "",
      aadhaar_front_path: p.front ?? "", aadhaar_back_path: p.back ?? "", aadhaar_face_path: p.face ?? "",
    }, lines: [`Name: ${f.name ?? "—"}`, `DOB: ${f.dob ?? "—"}`, `Gender: ${f.gender ?? "—"}`, `Aadhaar: ${f.aadhaar_masked ?? f.aadhaar_number ?? "—"}`] };
  }
  if (turn.extractRoute === "extract-coapp-pan") {
    const f = j.fields ?? {};
    return { patch: { coapp_pan: f.pan ?? "", coapp_name: f.name ?? "", coapp_father_name: f.father_name ?? "", coapp_dob: f.dob ?? "", coapp_pan_path: j.storage_path ?? "" },
      lines: [`PAN: ${f.pan ?? "—"}`, `Name: ${f.name ?? "—"}`, `Father: ${f.father_name ?? "—"}`] };
  }
  if (turn.extractRoute === "extract-loan-docs") {
    const pf = j.proforma?.fields ?? {}, eb = j.ebill?.fields ?? {};
    return { patch: {
      project_size: pf.project_size != null ? String(pf.project_size) : "", project_size_unit: pf.project_size_unit ?? "kw", total_project_cost: pf.total_project_cost != null ? String(pf.total_project_cost) : "",
      proforma_invoice_path: j.proforma?.storage_path ?? "", proforma_uploaded_at: j.proforma?.uploaded_at ?? "",
      monthly_bill_amount: eb.monthly_bill_amount != null ? String(eb.monthly_bill_amount) : "", discom_name: eb.discom_name ?? "", ca_number: eb.ca_number ?? "",
      ebill_address_line: eb.ebill_address_line ?? "", ebill_name: eb.ebill_name ?? "", ebill_path: j.ebill?.storage_path ?? "", ebill_uploaded_at: j.ebill?.uploaded_at ?? "",
    }, lines: [`Project: ${pf.project_size ?? "—"} ${pf.project_size_unit ?? "kW"} · ₹${pf.total_project_cost ?? "—"}`, `Bill: ₹${eb.monthly_bill_amount ?? "—"} · ${eb.discom_name ?? "—"}`] };
  }
  if (turn.extractRoute === "extract-bank-statement") {
    const f = j.fields ?? {};
    return { patch: {
      bank_statement_method: j.method ?? "manual_epdf", bank_statement_path: j.storage_path ?? "", bank_statement_uploaded_at: new Date().toISOString(),
      bank_account_holder: f.account_holder ?? "", bank_name: f.bank_name ?? "", bank_account_no: f.account_no ?? "", bank_ifsc: f.ifsc ?? "", bank_account_type: f.account_type ?? "", bank_mobile: f.mobile ?? "", bank_email: f.email ?? "",
    }, lines: [`Holder: ${f.account_holder ?? "—"}`, `Bank: ${f.bank_name ?? "—"}`, `A/C: ${f.account_no ?? "—"} · IFSC ${f.ifsc ?? "—"}`] };
  }
  return { patch: {}, lines: [] };
}
