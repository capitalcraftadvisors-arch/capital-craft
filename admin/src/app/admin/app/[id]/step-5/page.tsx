"use client";

// Loan Application — Step 5 (Loan Offers)
//
// Sections:
//   a. Header + tracker (Step 5 of 6, 67% complete)
//   b. Your Loan Profile — read-only recap of loan amount / monthly
//      bill / annual income captured earlier
//   c. Info box (Capital Craft language — no "Solfin", no "pre-approved")
//   d. RM inputs: ROI (enforced 7.5–10.8), auto central subsidy, state subsidy
//   e. Five tenure cards (1..5 years) with live-computed Monthly EMI + Subsidy EMI
//   f. Prev / Save & Continue
//
// EMI math is REDUCING BALANCE, computed client-side and reactive to
// ROI / state-subsidy changes. The subsidy EMI applies to (loan - central - state),
// floored at zero.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import LoanAppStepTracker from "@/components/LoanAppStepTracker";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";

type Loan = {
  id: string;
  current_step: number;
  created_at: string;
  loan_amount_required:  number | null;
  monthly_bill_amount:   number | null;
  annual_income:         number | null;
  project_size:          number | null;
  project_size_unit:     "kw" | "mw" | null;
  // Prior Step 5 selections (to prefill on re-visit)
  roi_percent:            number | null;
  central_subsidy:        number | null;
  state_subsidy:          number | null;
  selected_tenure_years:  number | null;
  epc_business: {
    contact_name: string | null;
    trade_name: string | null;
    legal_name: string | null;
    epc_display_id: string | null;
  } | null;
};

const ROI_MIN = 7.5;
const ROI_MAX = 10.8;
const CENTRAL_CAP = 78000;
const TENURES = [1, 2, 3, 4, 5] as const;

// PM Surya Ghar central subsidy tiers, computed on the project's
// installed capacity in kW:
//   1 kW  → ₹30,000
//   2 kW  → ₹60,000  (30,000 × 2)
//   ≥3 kW → ₹78,000  (60,000 + 18,000 cap)
function computeCentralSubsidy(kw: number | null): number {
  if (kw == null || !Number.isFinite(kw) || kw <= 0) return 0;
  const whole = Math.floor(kw);
  if (whole <= 0) return 0;
  if (whole === 1) return 30000;
  if (whole === 2) return 60000;
  return CENTRAL_CAP;
}

// Reducing-balance EMI, rounded to nearest rupee.
// principal in rupees, roi in percent per annum, years in whole years.
function computeEmi(principal: number, roiPct: number, years: number): number {
  if (principal <= 0 || roiPct <= 0 || years <= 0) return 0;
  const r = (roiPct / 100) / 12;
  const n = years * 12;
  const pow = Math.pow(1 + r, n);
  const emi = principal * r * pow / (pow - 1);
  return Math.round(emi);
}

function formatRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export default function LoanAppStep5Page() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loan, setLoan] = useState<Loan | null>(null);
  const [loading, setLoading] = useState(true);

  // Inputs
  const [roi, setRoi]                 = useState<string>("");
  const [stateSubsidy, setStateSub]   = useState<string>("");
  const [selectedTenure, setTenure]   = useState<number | null>(null);

  // Save
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("epc_applications")
        .select(
          "id, current_step, created_at, " +
          "loan_amount_required, monthly_bill_amount, annual_income, " +
          "project_size, project_size_unit, " +
          "roi_percent, central_subsidy, state_subsidy, selected_tenure_years, " +
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .eq("id", params.id)
        .maybeSingle();
      const l = data as unknown as Loan | null;
      setLoan(l);
      if (l) {
        if (l.roi_percent != null)   setRoi(String(l.roi_percent));
        if (l.state_subsidy != null) setStateSub(String(l.state_subsidy));
        if (l.selected_tenure_years != null) setTenure(l.selected_tenure_years);
      }
      setLoading(false);
    })();
  }, [params.id]);

  // Kick past-Step-5 apps to Step 6.
  useEffect(() => {
    if (loan && loan.current_step > 5) {
      router.replace(`/admin/app/${loan.id}/step-6` as any);
    }
  }, [loan, router]);

  // Convert project_size to kW for subsidy math.
  const sizeKw = useMemo(() => {
    if (!loan?.project_size) return null;
    return loan.project_size_unit === "mw"
      ? loan.project_size * 1000
      : loan.project_size;
  }, [loan]);

  const centralSubsidy = useMemo(() => computeCentralSubsidy(sizeKw), [sizeKw]);

  // Numeric parsing
  const roiNum         = Number(roi);
  const roiValid       = Number.isFinite(roiNum) && roiNum >= ROI_MIN && roiNum <= ROI_MAX;
  const stateSubsidyN  = Math.max(0, Number(stateSubsidy) || 0);
  const totalSubsidy   = centralSubsidy + stateSubsidyN;

  const loanAmount     = loan?.loan_amount_required ?? 0;
  const subsidyPrincipal = Math.max(0, loanAmount - totalSubsidy);

  // Per-tenure EMIs
  const emiRows = useMemo(() => {
    if (!roiValid) return TENURES.map((t) => ({ years: t, monthly: null as number | null, subsidy: null as number | null }));
    return TENURES.map((t) => ({
      years: t,
      monthly: computeEmi(loanAmount, roiNum, t),
      subsidy: computeEmi(subsidyPrincipal, roiNum, t),
    }));
  }, [roiValid, loanAmount, roiNum, subsidyPrincipal]);

  const canSave = roiValid && selectedTenure !== null && !saving;

  async function saveAndNext() {
    if (!loan || !canSave) return;
    setSaveError(null);
    setSaving(true);
    try {
      const chosen = emiRows.find((r) => r.years === selectedTenure);
      if (!chosen) {
        setSaveError("Please pick a tenure.");
        setSaving(false);
        return;
      }
      const res = await fetch(`/api/admin/loan-app/${loan.id}/complete-step-5`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify({
          roi_percent:           roiNum,
          central_subsidy:       centralSubsidy,
          state_subsidy:         stateSubsidyN,
          selected_tenure_years: chosen.years,
          selected_monthly_emi:  chosen.monthly,
          selected_subsidy_emi:  chosen.subsidy,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setSaveError(data?.error || `Save failed (HTTP ${res.status}).`);
        setSaving(false);
        return;
      }
      router.push(`/admin/app/${loan.id}/step-6` as any);
    } catch (e) {
      setSaveError((e as Error)?.message || "Network error.");
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-text-muted">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Loan application not found.</p></main>;
  }

  const customerName =
    loan.epc_business?.trade_name ||
    loan.epc_business?.legal_name ||
    loan.epc_business?.contact_name ||
    "(customer)";

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-[20px] grad-text">Capital Craft</span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">
              Loan Application · Step 5
            </span>
          </div>
          <a href="/admin" className="text-[13px] text-text-muted hover:text-text">← Back to console</a>
        </div>
      </header>

      <section className="max-w-[900px] mx-auto px-5 sm:px-7 py-8 space-y-6">
        <LoanAppStepTracker
          applicationId={loan.id}
          displayId={loan.epc_business?.epc_display_id ?? null}
          name={customerName}
          createdAt={loan.created_at}
          currentStep={5}
        />

        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-[#0f3d2e]">
            Loan Offers
          </h1>
          <p className="text-text-mid mt-2 text-[15px]">
            Set the ROI + subsidy inputs, then pick a tenure. Monthly EMI and
            Subsidy EMI recompute live as you adjust the fields.
          </p>
        </div>

        {/* b. Your Loan Profile */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[18px] text-[#0f3d2e]">
            Your loan profile
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <ProfileTile label="Loan amount"  value={formatRupees(loan.loan_amount_required)}  accent="green" />
            <ProfileTile label="Monthly bill" value={formatRupees(loan.monthly_bill_amount)}   accent="sky" />
            <ProfileTile label="Annual income" value={formatRupees(loan.annual_income)}         accent="green" />
          </div>
        </Card>

        {/* c. Info box — Capital Craft wording */}
        <div className="rounded-input border border-[#d3e9f7] bg-[#dceffb] p-5 flex gap-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#185fa5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p className="text-[13px] text-[#0f3d2e] leading-relaxed">
            Based on the details declared, here are indicative loan options for your
            solar project from <span className="font-semibold">Capital Craft Financial Advisors</span>.
            Final terms are subject to document verification and lender approval.
          </p>
        </div>

        {/* Amber disclaimer strip — regulatory-friendly wording */}
        <div className="rounded-input border-l-4 border-l-amber-400 border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#854f0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className="text-[12px] text-[#854f0b] leading-relaxed">
            <span className="font-semibold">Disclaimer:</span> The interest rate (ROI) and EMI figures
            displayed above are <span className="font-semibold">indicative</span> and are provided solely
            for reference. All rates and repayment amounts are subject to the sole discretion of the
            lending bank / NBFC and will be finalized only after complete document verification and
            formal approval by the lender. Capital Craft Financial Advisors makes no guarantee that the
            indicative terms shown will be offered by the eventual lender.
          </p>
        </div>

        {/* d. RM inputs */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[18px] text-[#0f3d2e]">
            Loan configuration
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block mb-1.5 text-[13px] font-medium text-text-mid">
                Set ROI (%)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={roi}
                onChange={(e) => setRoi(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="7.5 – 10.8"
                className={[
                  "w-full rounded-input border-2 px-3.5 py-2.5 text-[15px] outline-none transition-colors bg-white",
                  roi && !roiValid
                    ? "border-red-400 focus:border-red-500"
                    : roiValid
                    ? "border-[#178a5c] focus:border-[#178a5c]"
                    : "border-line focus:border-[#185fa5]",
                ].join(" ")}
              />
              <p className={"mt-1.5 text-[11px] " + (roi && !roiValid ? "text-red-600" : "text-text-muted")}>
                {roi && !roiValid
                  ? `ROI must be between ${ROI_MIN}% and ${ROI_MAX}%.`
                  : `Allowed range: ${ROI_MIN}% – ${ROI_MAX}%.`}
              </p>
            </div>

            <div>
              <label className="block mb-1.5 text-[13px] font-medium text-text-mid">
                Central Subsidy (₹)
              </label>
              <div className="w-full rounded-input border-2 border-line bg-bg-tint px-3.5 py-2.5 text-[15px] text-[#0f3d2e] font-semibold">
                {formatRupees(centralSubsidy)}
              </div>
              <p className="mt-1.5 text-[11px] text-text-muted">
                Auto-computed from PM Surya Ghar tiers ({sizeKw ? `${sizeKw} kW` : "—"}).
              </p>
            </div>

            <Input
              label="State Subsidy (₹)"
              type="text"
              inputMode="numeric"
              value={stateSubsidy}
              onChange={(e) => setStateSub(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0"
              hint="Enter applicable state subsidy if any; conditional per state/eligibility."
            />
          </div>
        </Card>

        {/* e. Tenure cards */}
        <Card className="p-6 space-y-4">
          <div>
            <h2 className="font-display font-semibold text-[18px] text-[#0f3d2e]">
              Select loan tenure
            </h2>
            <p className="text-[13px] text-text-mid mt-1">
              {roiValid
                ? "Pick the tenure the customer prefers. EMIs recompute automatically."
                : "Enter a valid ROI above to see EMI options."}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {emiRows.map((row) => {
              const active = selectedTenure === row.years;
              return (
                <button
                  key={row.years}
                  type="button"
                  onClick={() => roiValid && setTenure(row.years)}
                  disabled={!roiValid}
                  className={[
                    "text-left rounded-input border-2 p-4 transition-colors relative",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#185fa5]",
                    !roiValid
                      ? "border-line bg-white opacity-60 cursor-not-allowed"
                      : active
                      ? "border-[#178a5c] bg-[#f0faf5]"
                      : "border-line bg-white hover:border-[#185fa5]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "absolute top-3 right-3 w-4 h-4 rounded-full border-2 flex items-center justify-center",
                      active ? "border-[#178a5c]" : "border-line",
                    ].join(" ")}
                    aria-hidden
                  >
                    {active && <span className="w-2 h-2 rounded-full bg-[#178a5c]" />}
                  </span>

                  <p className="font-display font-bold text-[18px] text-[#0f3d2e]">
                    {row.years} {row.years === 1 ? "Year" : "Years"}
                  </p>

                  <div className="mt-3 space-y-1.5">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold">
                        Monthly EMI
                      </p>
                      <p className="font-display font-bold text-[16px] text-[#185fa5]">
                        {row.monthly !== null ? formatRupees(row.monthly) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold">
                        Subsidy EMI
                      </p>
                      <p className="text-[13px] font-semibold text-[#0f3d2e]">
                        {row.subsidy !== null ? formatRupees(row.subsidy) : "—"}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {!roiValid && (
            <p className="text-[12px] text-text-muted italic">
              Enter ROI to see EMIs.
            </p>
          )}
        </Card>

        {/* f. Prev / Save */}
        <Card className="p-6">
          {saveError && (
            <div className="p-3.5 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700 mb-4">
              {saveError}
            </div>
          )}
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/admin/app/${loan.id}/step-4` as any)}
            >
              ← Previous
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={saveAndNext}
              loading={saving}
              disabled={!canSave}
            >
              Save &amp; Continue
            </Button>
          </div>
        </Card>
      </section>
    </main>
  );
}

// ── Small helpers ────────────────────────────────────────────────────

function ProfileTile({
  label, value, accent,
}: {
  label: string;
  value: string;
  accent: "green" | "sky";
}) {
  const border = accent === "green" ? "border-[#cdeadd]" : "border-[#d3e9f7]";
  const bg     = accent === "green" ? "bg-[#f0faf5]"    : "bg-[#dceffb]";
  const text   = accent === "green" ? "text-[#0f3d2e]"  : "text-[#0f2447]";
  return (
    <div className={"rounded-input border-2 p-4 " + border + " " + bg}>
      <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">{label}</p>
      <p className={"mt-1.5 font-display font-bold text-[20px] " + text}>{value}</p>
    </div>
  );
}
