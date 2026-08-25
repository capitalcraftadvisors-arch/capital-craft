"use client";

// AI intake — a premium, guided chat that builds a full loan application.
// Documents do the data entry (OCR), the chat collects everything else, and it
// writes through the SAME create + step routes the wizard uses, so the result
// is identical to a hand-entered profile. View/edit/wizard are untouched.
//
// Stage 1 (this file): the chat engine + UI + Step 1 (EPC + registration),
// creating a real application. Steps 2–5 (KYC/docs, loan, employment, config)
// plug into the same SCRIPT engine and are added next.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";

export default function IntakePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

// ── The conversation is a deterministic script. Each turn knows what to ask,
//    how to collect it, and how to validate — reliable, auditable, premium. ──
type Choice = { value: string; label: string; sub?: string };
type Turn = {
  id: string;
  bot: string;
  kind: "epc" | "text" | "pincode" | "choice" | "consent";
  field?: string;
  placeholder?: string;
  optional?: boolean;
  choices?: Choice[];
  validate?: (v: string) => string | null; // return error message or null
};

const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SCRIPT: Turn[] = [
  { id: "epc", bot: "Which EPC partner is this application for?", kind: "epc" },
  { id: "borrower_name", bot: "What's the applicant's full name?", kind: "text", field: "borrower_name", placeholder: "Full name", validate: (v) => (v.trim().length < 2 ? "Enter the applicant's name." : null) },
  { id: "borrower_mobile", bot: "Customer phone number?", kind: "text", field: "borrower_mobile", placeholder: "10-digit mobile", validate: (v) => (MOBILE_RE.test(v.trim()) ? null : "Enter a valid 10-digit mobile number.") },
  { id: "borrower_email", bot: "Email ID? (optional)", kind: "text", field: "borrower_email", placeholder: "name@example.com", optional: true, validate: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? null : "Enter a valid email or leave blank.") },
  { id: "install_pincode", bot: "Installation pincode?", kind: "pincode", field: "install_pincode" },
  { id: "system_type", bot: "Solar system preference?", kind: "choice", field: "system_type", choices: [
    { value: "on_grid", label: "On-Grid", sub: "Connected to grid, can sell excess" },
    { value: "off_grid", label: "Off-Grid", sub: "Independent, with battery" },
    { value: "hybrid", label: "Hybrid", sub: "Grid + battery" },
  ] },
  { id: "plant_use_type", bot: "Is the plant for residential or commercial use?", kind: "choice", field: "plant_use_type", choices: [
    { value: "residential", label: "Residential", sub: "Home / housing society" },
    { value: "commercial", label: "Commercial", sub: "Shop, office, factory" },
  ] },
  { id: "consent", bot: "Does the customer consent to the Terms, Privacy & Cookie policies and allow Capital Craft + lending partners to access their credit information?", kind: "consent", field: "consent" },
];

type Msg = { from: "bot" | "user"; text: string };
type Form = Record<string, string>;

function Inner() {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [turnIdx, setTurnIdx] = useState(0);
  const [form, setForm] = useState<Form>({});
  const [appId, setAppId] = useState<string | null>(null);
  const [epcs, setEpcs] = useState<Choice[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinInfo, setPinInfo] = useState<{ state: string; district: string; city: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const turn = SCRIPT[turnIdx] ?? null;

  // Load approved EPCs for the first turn.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("id, epc_display_id, contact_name, trade_name, legal_name")
        .eq("has_lender_approval", true)
        .neq("business_type", "admin")
        .order("trade_name", { ascending: true, nullsFirst: false });
      setEpcs(((data ?? []) as Record<string, string>[]).map((e) => ({
        value: e.id,
        label: e.trade_name || e.legal_name || e.contact_name || "(unnamed)",
        sub: e.epc_display_id || undefined,
      })));
    })();
  }, []);

  // Show the bot's message whenever we advance to a new turn.
  useEffect(() => {
    if (turn) setMsgs((m) => (m.length && m[m.length - 1].text === turn.bot ? m : [...m, { from: "bot", text: turn.bot }]));
    setInput(""); setError(null); setPinInfo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnIdx]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, pinInfo, turnIdx]);

  const say = useCallback((from: "bot" | "user", text: string) => setMsgs((m) => [...m, { from, text }]), []);

  // Advance the conversation, recording the user's answer.
  async function answer(value: string, label?: string, extra?: Form) {
    if (!turn) return;
    say("user", label ?? value);
    const nextForm = { ...form, ...(turn.field ? { [turn.field]: value } : {}), ...(extra ?? {}) };
    setForm(nextForm);

    // The EPC turn creates the application row immediately.
    if (turn.kind === "epc") {
      setBusy(true);
      try {
        const res = await fetch("/api/admin/create-loan-app", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
          body: JSON.stringify({ epc_business_id: value }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't start the application."); setBusy(false); say("user", "");  setMsgs((m)=>m.slice(0,-1)); return; }
        setAppId(j.application.id);
      } finally { setBusy(false); }
    }

    // Last turn → create/complete Step 1.
    if (turnIdx >= SCRIPT.length - 1) { await finishStep1(nextForm); return; }
    setTurnIdx((i) => i + 1);
  }

  async function submitText() {
    if (!turn) return;
    const v = input.trim();
    if (turn.validate) { const e = turn.validate(v); if (e) { setError(e); return; } }
    if (!v && !turn.optional) { setError("This field is required."); return; }
    await answer(v);
  }

  async function submitPincode() {
    if (!turn) return;
    const pin = input.trim();
    if (!/^[1-9]\d{5}$/.test(pin)) { setError("Enter a valid 6-digit pincode."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/pincode-lookup?pin=${pin}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      const j = await res.json().catch(() => ({}));
      if (j?.ok) {
        setPinInfo({ state: j.state, district: j.district, city: j.city });
        await answer(pin, `${pin} — ${j.state}`, { install_state: j.state, install_district: j.district || "", install_city: j.city || "" });
      } else {
        // lookup failed — still accept the pincode; state asked/edited in wizard
        await answer(pin, pin, { install_state: "" });
      }
    } finally { setBusy(false); }
  }

  async function finishStep1(f: Form) {
    if (!appId) { setError("Application not started."); return; }
    setCreating(true); setError(null);
    try {
      const res = await fetch(`/api/admin/loan-app/${appId}/complete-step-1`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({
          borrower_name: f.borrower_name || "",
          borrower_mobile: f.borrower_mobile || "",
          borrower_email: f.borrower_email || "",
          install_pincode: f.install_pincode || "",
          install_state: f.install_state || "",
          install_district: f.install_district || "",
          install_city: f.install_city || "",
          system_type: f.system_type || "",
          plant_use_type: f.plant_use_type || "",
          consent_policies: ["terms_conditions", "privacy_policy", "cookie_policy"],
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't save the details."); setCreating(false); return; }
      say("bot", "Registration saved. Next: KYC — upload the applicant's Aadhaar & PAN and I'll read them. (Coming next.)");
      setCreatedId(appId);
    } finally { setCreating(false); }
  }

  const progress = Math.min(100, Math.round((turnIdx / SCRIPT.length) * 100));

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
              {m.text && (
                <div className={["px-4 py-2.5 rounded-2xl text-[14px] max-w-[85%]",
                  m.from === "bot" ? "bg-white border border-line text-text rounded-tl-sm" : "bg-[#178a5c] text-white rounded-tr-sm ml-auto"].join(" ")}>
                  {m.text}
                </div>
              )}
            </div>
          ))}

          {pinInfo && (
            <div className="self-start text-[12px] text-text-muted px-1">District: <b>{pinInfo.district}</b> · Area: <b>{pinInfo.city}</b></div>
          )}

          {/* Input widget for the current turn */}
          {!createdId && turn && !busy && !creating && (
            <div className="self-stretch mt-1">
              {turn.kind === "epc" && (
                <div className="grid gap-2">
                  {epcs.length === 0 ? <div className="text-[13px] text-text-muted">Loading partners…</div> :
                    epcs.map((e) => (
                      <button key={e.value} onClick={() => void answer(e.value, e.label)}
                        className="text-left px-4 py-3 rounded-xl border border-line bg-white hover:border-[#178a5c] transition-colors">
                        <div className="text-[14px] font-semibold text-text">{e.label}</div>
                        {e.sub && <div className="text-[12px] text-text-muted font-mono">{e.sub}</div>}
                      </button>
                    ))}
                </div>
              )}

              {turn.kind === "choice" && (
                <div className="grid sm:grid-cols-2 gap-2">
                  {turn.choices!.map((c) => (
                    <button key={c.value} onClick={() => void answer(c.value, c.label)}
                      className="text-left px-4 py-3 rounded-xl border border-line bg-white hover:border-[#178a5c] transition-colors">
                      <div className="text-[14px] font-semibold text-text">{c.label}</div>
                      {c.sub && <div className="text-[12px] text-text-muted">{c.sub}</div>}
                    </button>
                  ))}
                </div>
              )}

              {(turn.kind === "text" || turn.kind === "pincode") && (
                <div className="flex gap-2">
                  <input autoFocus value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void (turn.kind === "pincode" ? submitPincode() : submitText()); }}
                    placeholder={turn.placeholder || "Type your answer…"}
                    className="flex-1 border border-line rounded-xl px-4 py-2.5 text-[14px] bg-white" />
                  <button onClick={() => void (turn.kind === "pincode" ? submitPincode() : submitText())}
                    className="px-4 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold">Send</button>
                </div>
              )}

              {turn.kind === "consent" && (
                <div className="flex gap-2">
                  <button onClick={() => void answer("yes", "Yes, consent given")}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold">Yes, consent given</button>
                  <button onClick={() => router.push("/admin")}
                    className="px-4 py-2.5 rounded-xl border border-line bg-white text-text text-[14px]">Cancel</button>
                </div>
              )}
            </div>
          )}

          {(busy || creating) && <div className="self-start text-[13px] text-text-muted px-1">Working…</div>}
          {error && <div className="self-stretch text-[13px] text-red-600 px-1">{error}</div>}

          {createdId && (
            <div className="self-stretch mt-2 flex gap-2">
              <button onClick={() => router.push(`/admin/app/${createdId}/step-2`)}
                className="flex-1 px-4 py-3 rounded-xl bg-[#178a5c] text-white text-[14px] font-semibold">Continue in the application →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
