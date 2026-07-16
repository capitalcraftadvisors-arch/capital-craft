"use client";

// Shared header for the 3-step insurance flow.

export default function InsuranceStepHeader({ step }: { step: number }) {
  return (
    <header className="border-b border-line bg-white">
      <div className="max-w-2xl mx-auto px-5 sm:px-7 h-16 flex items-center justify-between">
        <a href="/dashboard" className="font-display font-bold text-[20px] grad-text">Capital Craft</a>
        <span className="text-[12px] text-text-muted">Insurance · Step {step} of 3</span>
      </div>
    </header>
  );
}
