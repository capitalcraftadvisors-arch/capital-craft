"use client";

// Loan chat · the last step: subsidy, central subsidy and tenure with a live EMI.

import { computeEmi, DEFAULT_INDICATIVE_ROI, TENURES } from "@/lib/emi";
import { amountInput, fmtRupees } from "@/lib/money";

// ── Tenure + submit ────────────────────────────────────────────────────────
// Loan configuration — subsidy case + central subsidy + tenure with a
// live EMI, mirroring the team chatbot's last step.
export default function LoanConfigDock({ loanAmt, subsidyCase, setSubsidyCase, centralSub, setCentralSub, tenure, setTenure, onFinish }: {
  loanAmt: number; subsidyCase: "subsidy" | "non_subsidy"; setSubsidyCase: (s: "subsidy" | "non_subsidy") => void;
  centralSub: string; setCentralSub: (s: string) => void;
  tenure: number | null; setTenure: (n: number) => void; onFinish: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 max-h-[56vh] overflow-y-auto pr-0.5">
      <div>
        <div className="text-[12px] text-text-muted mb-1">Subsidy</div>
        <div className="flex gap-2">
          {(["subsidy", "non_subsidy"] as const).map((s) => (
            <button key={s} onClick={() => setSubsidyCase(s)} className={["px-3.5 py-1.5 rounded-lg text-[13px] font-semibold border", subsidyCase === s ? "bg-navy text-white border-navy" : "bg-white border-line text-text-mid hover:border-navy"].join(" ")}>{s === "subsidy" ? "With subsidy" : "No subsidy"}</button>
          ))}
        </div>
      </div>
      {subsidyCase === "subsidy" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[12px] text-text-muted">Central subsidy (₹)
            <input value={centralSub} inputMode="numeric" onChange={(e) => setCentralSub(amountInput(e.target.value))} className="mt-1 w-full border border-line rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-navy" /></label>
        </div>
      )}
      <div>
        <div className="text-[12px] text-text-muted mb-1">Tenure — live EMI on ₹{loanAmt.toLocaleString("en-IN")}</div>
        <div className="grid grid-cols-5 gap-1.5">
          {TENURES.map((t) => (
            <button key={t} onClick={() => setTenure(t)} className={["px-1 py-2 rounded-lg text-center border transition", tenure === t ? "bg-navy text-white border-navy" : "bg-white border-line text-text-mid hover:border-navy"].join(" ")}>
              <div className="text-[13px] font-bold">{t}y</div>
              <div className="text-[10px] opacity-80">{loanAmt > 0 ? fmtRupees(computeEmi(loanAmt, DEFAULT_INDICATIVE_ROI, t)) : "—"}</div>
            </button>
          ))}
        </div>
      </div>
      <button onClick={onFinish} disabled={tenure == null} className="mt-1 px-4 py-2.5 rounded-xl bg-navy text-white text-[14px] font-semibold hover:bg-navy-hover disabled:opacity-50">Continue →</button>
    </div>
  );
}
