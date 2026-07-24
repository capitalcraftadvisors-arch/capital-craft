"use client";

// PUBLIC customer lead form (non-EPC). Reached from the marketing site's
// "Loan Application" / "Solar Insurance" links (…/apply?type=loan|insurance).
//
// Flow:  mobile number  →  Loan or Insurance?  →  short basic form  →  done.
// Submitting posts to /api/leads, which creates a customer_leads row
// (source='non_epc'). The admin team then follows up from the "Leads" tab.
// No login/session — this is intentionally a lightweight lead capture.

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

type Step = "mobile" | "choose" | "form" | "done";
type LeadType = "loan" | "insurance";
const MOBILE_RE = /^[6-9]\d{9}$/;

export default function ApplyPage() {
  const [step, setStep] = useState<Step>("mobile");
  const [leadType, setLeadType] = useState<LeadType>("loan");
  const [mobile, setMobile] = useState("");

  // shared
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [pan, setPan] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  // loan
  const [projectCost, setProjectCost] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  // insurance
  const [plantValue, setPlantValue] = useState("");
  const [gstin, setGstin] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preselect loan/insurance from ?type= (link from the marketing site).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type");
    if (t === "loan" || t === "insurance") setLeadType(t);
  }, []);

  function submitMobile() {
    setError(null);
    if (!MOBILE_RE.test(mobile.trim())) { setError("Enter a valid 10-digit mobile number."); return; }
    setStep("choose");
  }
  function choose(t: LeadType) { setLeadType(t); setStep("form"); }

  async function submitLead() {
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { lead_type: leadType, mobile: mobile.trim(), name, city, pincode, pan, aadhaar };
      if (leadType === "loan") { body.project_cost = projectCost; body.loan_amount = loanAmount; }
      else { body.plant_value = plantValue; body.gstin = gstin; }
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) { setError(d?.error || `Something went wrong (HTTP ${res.status}).`); setBusy(false); return; }
      setStep("done");
    } catch (e) {
      setError((e as Error)?.message || "Network error."); setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-2xl mx-auto px-5 h-16 flex items-center">
          <span className="font-display font-bold text-[20px] text-[#178a5c]">Capital&nbsp;Craft</span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-5 py-10">
        <Card className="p-6 sm:p-8">
          {/* ── Step 1: mobile ── */}
          {step === "mobile" && (
            <>
              <h1 className="font-display text-[24px] font-bold text-text mb-1">Start your application</h1>
              <p className="text-[14px] text-text-mid mb-6">Enter your mobile number to begin. Our team will reach out to help you.</p>
              <Input
                label="Mobile number" inputMode="numeric" placeholder="10-digit mobile"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => { if (e.key === "Enter") submitMobile(); }}
              />
              {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}
              <div className="mt-6"><Button variant="primary" fullWidth onClick={submitMobile}>Continue →</Button></div>
            </>
          )}

          {/* ── Step 2: choose ── */}
          {step === "choose" && (
            <>
              <h1 className="font-display text-[24px] font-bold text-text mb-1">What are you applying for?</h1>
              <p className="text-[14px] text-text-mid mb-6">Choose one — you can always reach us for the other later.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <button type="button" onClick={() => choose("loan")}
                  className={["text-left p-5 rounded-card border-2 transition-colors",
                    leadType === "loan" ? "border-[#178a5c] bg-[#f0faf5]" : "border-line hover:border-[#178a5c]/50"].join(" ")}>
                  <div className="text-[17px] font-semibold text-text">Solar Loan</div>
                  <div className="text-[13px] text-text-mid mt-1">Finance your rooftop or commercial solar project.</div>
                </button>
                <button type="button" onClick={() => choose("insurance")}
                  className={["text-left p-5 rounded-card border-2 transition-colors",
                    leadType === "insurance" ? "border-[#178a5c] bg-[#f0faf5]" : "border-line hover:border-[#178a5c]/50"].join(" ")}>
                  <div className="text-[17px] font-semibold text-text">Solar Insurance</div>
                  <div className="text-[13px] text-text-mid mt-1">Protect your installed solar plant.</div>
                </button>
              </div>
              <div className="mt-6"><button type="button" onClick={() => setStep("mobile")} className="text-[13px] text-text-mid hover:text-text">← Back</button></div>
            </>
          )}

          {/* ── Step 3: form ── */}
          {step === "form" && (
            <>
              <h1 className="font-display text-[24px] font-bold text-text mb-1">
                {leadType === "loan" ? "Loan application" : "Solar insurance"}
              </h1>
              <p className="text-[14px] text-text-mid mb-6">A few basic details — our team takes it from here.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
                <Input label="Mobile number" value={mobile} readOnly />
                <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
                <Input label="Pincode" inputMode="numeric" value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                {leadType === "loan" ? (
                  <>
                    <Input label="Project cost (₹)" inputMode="numeric" value={projectCost} onChange={(e) => setProjectCost(e.target.value.replace(/[^\d]/g, ""))} />
                    <Input label="Loan amount wanted (₹)" inputMode="numeric" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value.replace(/[^\d]/g, ""))} />
                  </>
                ) : (
                  <>
                    <Input label="Approx. plant value (₹)" inputMode="numeric" value={plantValue} onChange={(e) => setPlantValue(e.target.value.replace(/[^\d]/g, ""))} />
                    <Input label="GSTIN (optional)" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
                  </>
                )}
                <Input label="PAN" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} />
                <Input label="Aadhaar number" inputMode="numeric" value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, "").slice(0, 12))} />
              </div>
              {error && <p className="text-[13px] text-red-600 mt-4">{error}</p>}
              <div className="mt-6 flex items-center gap-3">
                <button type="button" onClick={() => setStep("choose")} className="text-[13px] text-text-mid hover:text-text">← Back</button>
                <Button variant="primary" loading={busy} disabled={busy} onClick={submitLead} className="ml-auto">Submit</Button>
              </div>
              <p className="text-[11px] text-text-muted mt-4">By submitting you agree to be contacted by Capital Craft about your enquiry. Financing and coverage are subject to lender/insurer assessment and eligibility.</p>
            </>
          )}

          {/* ── Step 4: done ── */}
          {step === "done" && (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-[#e6f6ee] text-[#178a5c] grid place-items-center mx-auto mb-4">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
              </div>
              <h1 className="font-display text-[24px] font-bold text-text mb-2">Thank you!</h1>
              <p className="text-[15px] text-text-mid max-w-md mx-auto">We&rsquo;ve received your details. Our team will reach out on <b className="text-text">+91 {mobile}</b> shortly to help with your {leadType === "loan" ? "solar loan" : "solar insurance"}.</p>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
