"use client";

// EPC-facing loan application — Page 1 of 3 (Registration).
//
// Shorter sibling of the admin 6-step flow. The applicant record is
// auto-tagged to the LOGGED-IN EPC (no EPC picker anywhere). Access is
// the existing loan gate: AuthGuard allow=["approved"] admits only
// EPCs with loan_app_unlocked (≥1 lender approval / grandfathered) —
// same gating as the rest of /dashboard.
//
// Fields mirror admin Step 1 minus PAN (that moves to Page 2), plus
// the applicant's name. On Continue → POST /api/epc/loan-apply
// phase=register creates the row; the LA-<last5>-<seq> id is assigned
// by the existing 0030 trigger; we route to Page 2 (documents).

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { getToken } from "@/lib/auth";
import EpcApplyTracker from "@/components/EpcApplyTracker";

const PIN_RE    = /^[1-9]\d{5}$/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SYSTEM_CARDS = [
  { value: "on_grid",  title: "On-Grid Solar System",  desc: "Connected to electricity grid, can sell excess power" },
  { value: "off_grid", title: "Off-Grid Solar System", desc: "Independent system with battery storage" },
  { value: "hybrid",   title: "Hybrid Solar System",   desc: "Connected to the grid with battery storage" },
] as const;

export default function EpcApplyPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();

  const [name, setName]         = useState("");
  const [phone, setPhone]       = useState("");
  const [email, setEmail]       = useState("");
  const [pin, setPin]           = useState("");
  const [state, setState]       = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity]         = useState("");
  const [pinBusy, setPinBusy]   = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [systemType, setSystemType] = useState<"off_grid" | "on_grid" | "hybrid" | "">("");
  const [plantUse, setPlantUse]     = useState<"residential" | "commercial" | "">("");
  const [consented, setConsented]   = useState(false);
  const [sending, setSending]       = useState(false);
  const [sendError, setSendError]   = useState<string | null>(null);

  async function lookupPincode(next: string) {
    setPinError(null);
    if (!PIN_RE.test(next)) return;
    setPinBusy(true);
    try {
      const res = await fetch(`/api/admin/pincode-lookup?pin=${next}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setPinError(data?.error || "Lookup failed — enter state manually.");
        return;
      }
      setState(String(data.state ?? ""));
      setDistrict(String(data.district ?? ""));
      setCity(String(data.city ?? ""));
    } catch {
      setPinError("Lookup failed — enter state manually.");
    } finally {
      setPinBusy(false);
    }
  }

  const canContinue =
    name.trim().length >= 2 &&
    MOBILE_RE.test(phone) &&
    EMAIL_RE.test(email) &&
    PIN_RE.test(pin) &&
    state.trim().length > 0 &&
    !!systemType &&
    !!plantUse &&
    consented &&
    !sending;

  async function continueToDocs() {
    if (!canContinue) return;
    setSendError(null);
    setSending(true);
    try {
      const res = await fetch("/api/epc/loan-apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify({
          phase: "register",
          borrower_name:    name.trim(),
          borrower_mobile:  phone,
          borrower_email:   email.trim(),
          install_pincode:  pin,
          install_state:    state,
          install_district: district || null,
          install_city:     city || null,
          system_type:      systemType,
          plant_use_type:   plantUse,
          consented:        true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setSendError(data?.error || `HTTP ${res.status}`);
        setSending(false);
        return;
      }
      router.push(`/dashboard/apply/${data.id}/docs` as any);
    } catch (e) {
      setSendError((e as Error)?.message || "Network error.");
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <a href="/dashboard" className="font-display font-bold text-[20px] grad-text">Capital Craft</a>
          <span className="text-[13px] text-text-muted">Loan Application</span>
        </div>
      </header>

      <section className="max-w-[760px] mx-auto px-5 sm:px-7 py-10 space-y-6">
        <EpcApplyTracker step={1} />

        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-[#0f3d2e]">
            Customer registration
          </h1>
          <p className="text-text-mid mt-2 text-[15px]">
            Tell us about the customer applying for the solar loan. It takes
            three short steps.
          </p>
        </div>

        <Card className="p-7 space-y-4">
          <Input
            label="Applicant name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Mobile number"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              placeholder="10-digit mobile"
              error={
                phone && !MOBILE_RE.test(phone)
                  ? `Needs 10 digits starting 6-9 (currently ${phone.length}).`
                  : undefined
              }
            />
            <Input
              label="Email ID"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              error={email && !EMAIL_RE.test(email) ? "Enter a valid email address." : undefined}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Pincode (installation address)"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onBlur={(e) => void lookupPincode(e.target.value)}
              error={pinError ?? undefined}
              hint={pinBusy ? "Looking up state…" : undefined}
            />
            <Input
              label="Installation state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder={pinBusy ? "Fetching…" : "State"}
              hint="Auto-filled from pincode. Edit if it looks wrong."
            />
          </div>

          <div>
            <p className="block mb-2 text-[13px] font-medium text-text-mid">
              Solar system preference
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              {SYSTEM_CARDS.map((opt) => {
                const active = systemType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSystemType(opt.value)}
                    className={[
                      "text-left rounded-input border-2 p-4 transition-colors relative",
                      active ? "border-[#178a5c] bg-[#f0faf5]" : "border-line bg-white hover:border-[#185fa5]",
                    ].join(" ")}
                  >
                    <span className={[
                      "absolute top-3 right-3 w-4 h-4 rounded-full border-2 flex items-center justify-center",
                      active ? "border-[#178a5c]" : "border-line",
                    ].join(" ")} aria-hidden>
                      {active && <span className="w-2 h-2 rounded-full bg-[#178a5c]" />}
                    </span>
                    <p className={"font-display font-semibold text-[13px] pr-6 " + (active ? "text-[#0f3d2e]" : "text-text")}>
                      {opt.title}
                    </p>
                    <p className="text-[11px] text-text-muted mt-1">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Residential / Commercial — required */}
          <div>
            <p className="block mb-2 text-[13px] font-medium text-text-mid">
              Is the solar plant for Residential or Commercial use?
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-[420px]">
              {([
                { value: "residential", label: "Residential", desc: "Home / housing society rooftop" },
                { value: "commercial",  label: "Commercial",  desc: "Shop, office, factory, or institution" },
              ] as const).map((opt) => {
                const active = plantUse === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPlantUse(opt.value)}
                    className={[
                      "text-left rounded-input border-2 p-4 transition-colors relative",
                      active ? "border-[#178a5c] bg-[#f0faf5]" : "border-line bg-white hover:border-[#185fa5]",
                    ].join(" ")}
                  >
                    <span className={[
                      "absolute top-3 right-3 w-4 h-4 rounded-full border-2 flex items-center justify-center",
                      active ? "border-[#178a5c]" : "border-line",
                    ].join(" ")} aria-hidden>
                      {active && <span className="w-2 h-2 rounded-full bg-[#178a5c]" />}
                    </span>
                    <p className={"font-display font-semibold text-[13px] pr-6 " + (active ? "text-[#0f3d2e]" : "text-text")}>
                      {opt.label}
                    </p>
                    <p className="text-[11px] text-text-muted mt-1">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-start gap-3 text-[14px] leading-relaxed cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[#178a5c]"
            />
            <span className="text-text">
              By clicking here, I state that the customer has read and understood the{" "}
              <a href="#" target="_blank" rel="noopener" className="text-[#185fa5] hover:underline font-medium">Terms and Conditions</a>,{" "}
              <a href="#" target="_blank" rel="noopener" className="text-[#185fa5] hover:underline font-medium">Privacy Policy</a> and{" "}
              <a href="#" target="_blank" rel="noopener" className="text-[#185fa5] hover:underline font-medium">Cookie Policy</a>{" "}
              and allows <span className="font-semibold">Capital Craft Financial Advisors</span>{" "}
              and its lending partners to access their credit information.
            </span>
          </label>

          {sendError && (
            <div className="p-3.5 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700">
              {sendError}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button type="button" variant="primary" onClick={continueToDocs} loading={sending} disabled={!canContinue}>
              Save &amp; continue
            </Button>
          </div>
        </Card>
      </section>
    </main>
  );
}
