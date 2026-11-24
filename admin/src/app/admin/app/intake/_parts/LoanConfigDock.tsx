"use client";

// Intake chat — the last step's dock: subsidy case, central / state subsidy, and the tenure buttons with a live EMI.

import { computeEmi, DEFAULT_INDICATIVE_ROI, TENURES } from "@/lib/emi";
import { amountInput, fmtRupees } from "@/lib/money";

export default function LoanConfigDock({ loanAmt, subsidyCase, setSubsidyCase, centralSub, setCentralSub, stateSub, setStateSub, tenure, setTenure, onFinish, finishLabel }: {
  loanAmt: number; subsidyCase: "subsidy" | "non_subsidy"; setSubsidyCase: (s: "subsidy" | "non_subsidy") => void;
  centralSub: string; setCentralSub: (s: string) => void; stateSub: string; setStateSub: (s: string) => void;
  tenure: number | null; setTenure: (n: number) => void; onFinish: () => void; finishLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 max-h-[52vh] overflow-y-auto pr-0.5">
      <div>
        <div className="text-[12px] text-text-muted mb-1">Subsidy case</div>
        <div className="flex gap-2">
          {(["subsidy", "non_subsidy"] as const).map((s) => (
            <button key={s} onClick={() => setSubsidyCase(s)} className={["px-3 py-1.5 rounded-lg text-[13px] font-semibold border", subsidyCase === s ? "bg-[#178a5c] text-white border-[#178a5c]" : "bg-white border-line text-text-mid"].join(" ")}>{s === "subsidy" ? "Subsidy" : "Non-subsidy"}</button>
          ))}
        </div>
      </div>
      {subsidyCase === "subsidy" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[12px] text-text-muted">Central subsidy (₹)
            <input value={centralSub} onChange={(e) => setCentralSub(amountInput(e.target.value))} className="mt-1 w-full border border-line rounded-lg px-2 py-1.5 text-[13px]" /></label>
          <label className="text-[12px] text-text-muted">State subsidy (₹)
            <input value={stateSub} onChange={(e) => setStateSub(amountInput(e.target.value))} placeholder="0" className="mt-1 w-full border border-line rounded-lg px-2 py-1.5 text-[13px]" /></label>
        </div>
      )}
      <div>
        <div className="text-[12px] text-text-muted mb-1">Tenure — live EMI on ₹{loanAmt.toLocaleString("en-IN")}</div>
        <div className="grid grid-cols-5 gap-1.5">
          {TENURES.map((t) => (
            <button key={t} onClick={() => setTenure(t)} className={["px-1 py-2 rounded-lg text-center border", tenure === t ? "bg-[#178a5c] text-white border-[#178a5c]" : "bg-white border-line text-text-mid"].join(" ")}>
              <div className="text-[13px] font-bold">{t}y</div>
              <div className="text-[10px] opacity-80">{loanAmt > 0 ? fmtRupees(computeEmi(loanAmt, DEFAULT_INDICATIVE_ROI, t)) : "—"}</div>
            </button>
          ))}
        </div>
      </div>
      <button onClick={onFinish} disabled={tenure == null} className="mt-1 px-4 py-2.5 rounded-lg bg-[#178a5c] text-white text-[14px] font-semibold disabled:opacity-60 hover:bg-[#12734c]">{finishLabel}</button>
    </div>
  );
}
