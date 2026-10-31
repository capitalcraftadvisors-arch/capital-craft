"use client";

// Shared header for the 3-step insurance flow — the partner portal's navy bar
// with the Capital Craft mark, same as the loan chat's header.

export default function InsuranceStepHeader({ step }: { step: number }) {
  return (
    <header className="bg-[#14235c] text-white shadow-sm">
      <div className="max-w-2xl mx-auto px-5 sm:px-7 h-16 flex items-center gap-3">
        <a href="/dashboard" className="p-1 -ml-1 text-white/80 hover:text-white text-[20px] leading-none" aria-label="Back to dashboard">←</a>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/capital-craft-mark.png" alt="" className="w-9 h-9 rounded-full bg-white object-contain p-1 shadow-sm" />
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[15px] leading-tight truncate">Capital Craft · Insurance</div>
          <div className="text-[11.5px] text-white/70">Step {step} of 3</div>
        </div>
      </div>
    </header>
  );
}
