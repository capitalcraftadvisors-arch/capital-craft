"use client";

// EPC-facing loan application — Page 3 of 3 (Project & Loan).
//
// Inputs: project size (kW), total project cost, loan amount required,
// tenure — with the SAME live EMI display as admin Step 5 (shared math
// in lib/emi.ts; indicative ROI since no RM has priced the file yet).
//
// Submit merges Page-2's sessionStorage payload with these fields and
// POSTs /api/epc/loan-apply phase=submit → the record enters the same
// pipeline as admin-created applications (status 'submitted') and
// appears on the admin Loan Applications table with the EPC auto-tagged.

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import EpcApplyTracker from "@/components/EpcApplyTracker";
import { getToken } from "@/lib/auth";
import {
  TENURES, DEFAULT_INDICATIVE_ROI,
  computeCentralSubsidy, computeEmi, formatRupees,
} from "@/lib/emi";

export default function EpcApplyLoanPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const appId = params.id;

  const [sizeKw, setSizeKw]         = useState("");
  const [totalCost, setTotalCost]   = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [tenure, setTenure]         = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const sizeN = Number(sizeKw);
  const costN = Number(totalCost);
  const loanN = Number(loanAmount);
  const validSize = Number.isFinite(sizeN) && sizeN > 0;
  const validCost = Number.isFinite(costN) && costN > 0;
  const validLoan = Number.isFinite(loanN) && loanN > 0;
  const loanExceeds = validCost && validLoan && loanN > costN;

  const centralSubsidy = useMemo(() => computeCentralSubsidy(validSize ? sizeN : null), [validSize, sizeN]);
  const subsidyPrincipal = Math.max(0, (validLoan ? loanN : 0) - centralSubsidy);

  const emiRows = useMemo(() => {
    if (!validLoan) return TENURES.map((t) => ({ years: t, monthly: null as number | null, subsidy: null as number | null }));
    return TENURES.map((t) => ({
      years: t,
      monthly: computeEmi(loanN, DEFAULT_INDICATIVE_ROI, t),
      subsidy: computeEmi(subsidyPrincipal, DEFAULT_INDICATIVE_ROI, t),
    }));
  }, [validLoan, loanN, subsidyPrincipal]);

  const canSubmit = validSize && validCost && validLoan && !loanExceeds && tenure !== null && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      // Page-2 payload (documents + OCR results) stashed by the docs page.
      const raw = sessionStorage.getItem(`epcApply:${appId}`);
      const docs = raw ? JSON.parse(raw) : {};
      const chosen = emiRows.find((r) => r.years === tenure)!;

      const res = await fetch("/api/epc/loan-apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify({
          phase: "submit",
          id: appId,
          ...docs,
          project_size: sizeN,
          total_project_cost: costN,
          loan_amount_required: loanN,
          central_subsidy: centralSubsidy,
          selected_tenure_years: tenure,
          selected_monthly_emi: chosen.monthly,
          selected_subsidy_emi: chosen.subsidy,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setSubmitError(data?.error || `Submit failed (HTTP ${res.status}).`);
        setSubmitting(false);
        return;
      }
      sessionStorage.removeItem(`epcApply:${appId}`);
      setDone(true);
    } catch (e) {
      setSubmitError((e as Error)?.message || "Network error.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-[#f0faf5] via-white to-[#dceffb] grid place-items-center px-5 py-10">
        <div className="max-w-[560px] w-full text-center space-y-6">
          <div className="relative w-24 h-24 mx-auto">
            <div className="absolute inset-0 rounded-full bg-[#178a5c] opacity-20 animate-ping" />
            <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-[#178a5c] to-[#12734c] flex items-center justify-center shadow-[0_10px_30px_-8px_rgba(23,138,92,0.6)]">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-widest text-[#5a8a76] font-bold">Capital Craft Financial Advisors</p>
            <h1 className="mt-2 font-display text-[34px] sm:text-[40px] font-bold bg-gradient-to-r from-[#0f3d2e] via-[#178a5c] to-[#185fa5] bg-clip-text text-transparent">
              Congratulations!
            </h1>
          </div>
          <p className="text-text-mid text-[15px] leading-relaxed max-w-md mx-auto">
            Your loan application is submitted. Our team will reach you soon.
          </p>
          <Button type="button" variant="primary" onClick={() => router.push("/dashboard")}>
            Back to dashboard
          </Button>
        </div>
      </main>
    );
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
        <EpcApplyTracker step={3} />

        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-[#0f3d2e]">
            Project &amp; loan
          </h1>
          <p className="text-text-mid mt-2 text-[15px]">
            Enter the project details and pick a tenure — EMIs update live.
          </p>
        </div>

        <Card className="p-7 space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <Input
              label="Project size (kW)"
              inputMode="decimal"
              value={sizeKw}
              onChange={(e) => setSizeKw(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="e.g. 5"
            />
            <Input
              label="Total project cost (₹)"
              inputMode="numeric"
              value={totalCost}
              onChange={(e) => setTotalCost(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="e.g. 350000"
            />
            <Input
              label="Loan amount required (₹)"
              inputMode="numeric"
              value={loanAmount}
              onChange={(e) => setLoanAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="e.g. 250000"
              error={loanExceeds ? "Cannot exceed project cost." : undefined}
            />
          </div>
          {validSize && validCost && (
            <p className="text-[12px] text-[#5a8a76]">
              Per kW price:{" "}
              <span className="font-semibold text-[#0f3d2e]">{formatRupees(Math.round(costN / sizeN))}/kW</span>
              <span className="text-text-muted"> (total project cost ÷ project size)</span>
            </p>
          )}
        </Card>

        {/* Tenure + live EMI — same math as admin Step 5 (lib/emi.ts) */}
        <Card className="p-6 space-y-4">
          <div>
            <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">Select loan tenure</h2>
            <p className="text-[13px] text-text-mid mt-1">
              {validLoan
                ? `Indicative EMIs @ ${DEFAULT_INDICATIVE_ROI}% p.a. — final rate is set after review.`
                : "Enter the loan amount to see EMI options."}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {emiRows.map((row) => {
              const active = tenure === row.years;
              return (
                <button
                  key={row.years}
                  type="button"
                  onClick={() => validLoan && setTenure(row.years)}
                  disabled={!validLoan}
                  className={[
                    "text-left rounded-input border-2 p-4 transition-colors relative",
                    !validLoan ? "border-line bg-white opacity-60 cursor-not-allowed" :
                    active ? "border-[#178a5c] bg-[#f0faf5]" : "border-line bg-white hover:border-[#185fa5]",
                  ].join(" ")}
                >
                  <span className={[
                    "absolute top-3 right-3 w-4 h-4 rounded-full border-2 flex items-center justify-center",
                    active ? "border-[#178a5c]" : "border-line",
                  ].join(" ")} aria-hidden>
                    {active && <span className="w-2 h-2 rounded-full bg-[#178a5c]" />}
                  </span>
                  <p className="font-display font-bold text-[16px] text-[#0f3d2e]">
                    {row.years} {row.years === 1 ? "Year" : "Years"}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="rounded-input border-l-4 border-l-amber-400 border border-amber-200 bg-amber-50 p-3.5">
            <p className="text-[11px] text-[#854f0b] leading-relaxed">
              <span className="font-semibold">Disclaimer:</span> ROI and EMI figures shown are
              indicative only and subject to the lender&rsquo;s discretion, finalized after
              document verification and lender approval.
            </p>
          </div>
        </Card>

        <Card className="p-6">
          {submitError && (
            <div className="p-3.5 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700 mb-4">
              {submitError}
            </div>
          )}
          <div className="flex justify-between gap-2">
            <Button type="button" variant="outline" onClick={() => router.push(`/dashboard/apply/${appId}/docs` as any)}>
              ← Previous
            </Button>
            <Button type="button" variant="primary" onClick={submit} loading={submitting} disabled={!canSubmit}>
              Submit application
            </Button>
          </div>
        </Card>
      </section>
    </main>
  );
}
