"use client";

// Partner dashboard · the EMI calculator (PM Surya Ghar subsidy + live EMI, from lib/emi).

import { useState } from "react";
import { NAVY_ACCENT } from "@/components/partner/PartnerShell";
import { amountInWords } from "@/lib/numberToWords";
import { computeCentralSubsidy, computeEmi, DEFAULT_INDICATIVE_ROI, TENURES } from "@/lib/emi";
import { amountInput, fmtRupees, numberInput } from "@/lib/money";

// ── EMI calculator ────────────────────────────────────────────────────────────
export default function EmiSection() {
  const [size, setSize] = useState("");
  const [cost, setCost] = useState("");
  const [loan, setLoan] = useState("");
  const [tenure, setTenure] = useState<number>(5);
  const sizeN = Number(size) || 0, costN = Number(cost) || 0, loanN = Number(loan) || 0;
  const central = sizeN > 0 ? computeCentralSubsidy(sizeN) : 0;
  const net = Math.max(0, loanN - central);
  const emi = net > 0 ? computeEmi(net, DEFAULT_INDICATIVE_ROI, tenure) : 0;
  // Dark, bold typed numbers; grey normal placeholder examples.
  const inputCls = "mt-2 w-full border border-line rounded-xl px-4 py-3 text-[17px] font-semibold text-[#0f3d2e] placeholder:font-normal placeholder:text-text-muted focus:outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/15";
  const labelCls = "block text-[13.5px] font-medium text-text-mid";
  const wordsBar = (n: number) => n > 0 ? (
    <div className="mt-2 text-[13px] font-semibold text-[#14235c] bg-[#f4f7fd] border border-[#e0e7f5] rounded-xl px-3.5 py-2">
      {amountInWords(n)} rupees
    </div>
  ) : null;
  return (
    <div className="max-w-[820px]">
      <h2 className="font-display text-[24px] font-bold text-[#0f3d2e] mb-6">EMI &amp; subsidy calculator</h2>
      <div className="bg-white rounded-3xl border border-line p-6 sm:p-7">
        <div className="grid md:grid-cols-2 gap-6 md:gap-9">
          {/* Left — inputs */}
          <div className="flex flex-col gap-5">
            <div>
              <label className={labelCls}>System size (kW)</label>
              <input value={size} inputMode="decimal" placeholder="e.g. 3" onChange={(e) => setSize(numberInput(e.target.value))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Project cost (₹)</label>
              <input value={cost} inputMode="numeric" placeholder="e.g. 3,00,000" onChange={(e) => setCost(amountInput(e.target.value))} className={inputCls} />
              {wordsBar(costN)}
            </div>
            <div>
              <label className={labelCls}>Loan amount (₹)</label>
              <input value={loan} inputMode="numeric" placeholder="e.g. 2,50,000" onChange={(e) => setLoan(amountInput(e.target.value))} className={inputCls} />
              {wordsBar(loanN)}
            </div>
          </div>

          {/* Right — results */}
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-bg-soft rounded-2xl px-5 py-4"><div className="text-[12.5px] text-text-muted">Central subsidy</div><div className="text-[20px] font-bold text-[#178a5c] mt-0.5">{sizeN > 0 ? `− ${fmtRupees(central)}` : "—"}</div></div>
              <div className="bg-bg-soft rounded-2xl px-5 py-4"><div className="text-[12.5px] text-text-muted">Net loan</div><div className="text-[20px] font-bold text-[#0f3d2e] mt-0.5">{loanN > 0 ? fmtRupees(net) : "—"}</div></div>
            </div>
            <div>
              <div className="text-[13.5px] font-medium text-text-mid mb-2.5">Tenure</div>
              <div className="grid grid-cols-5 gap-2.5">
                {TENURES.map((t) => (
                  <button key={t} onClick={() => setTenure(t)} className={["py-3 rounded-xl text-center border text-[14px] font-bold transition-colors", tenure === t ? "text-white border-transparent" : "bg-white border-line text-text-mid hover:border-[#1e3a8a]"].join(" ")} style={tenure === t ? { background: NAVY_ACCENT } : undefined}>{t}y</button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl px-6 py-5 flex-1 flex flex-col justify-center" style={{ background: "#e8effc" }}>
              <div className="text-[13px] text-[#1e3a8a]">Monthly EMI · {tenure} years</div>
              <div className="text-[34px] font-bold text-[#1e3a8a] leading-tight">{net > 0 ? fmtRupees(emi) : "—"}<span className="text-[15px] font-medium">/mo</span></div>
            </div>
          </div>
        </div>
        <p className="text-[12px] text-text-muted mt-5">Indicative only — the final rate is set by the lender after review.</p>
      </div>
    </div>
  );
}
