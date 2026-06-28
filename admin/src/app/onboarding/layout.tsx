"use client";

import { ReactNode } from "react";
import AuthGuard from "@/components/AuthGuard";

// Allow:
//   draft       — initial onboarding (status='draft').
//   self_edit   — EPC's one-time post-submit edit pass: status='under_review'
//                 AND epc_self_edited=false.
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allow={["draft", "self_edit"]}>
      <main className="min-h-screen bg-bg-soft">
        <header className="border-b border-line bg-white">
          <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
            <a href="/" className="font-display font-bold text-[20px] grad-text">Capital Craft</a>
            <span className="text-[12px] text-text-muted">EPC Onboarding</span>
          </div>
        </header>

        <div className="max-w-[760px] mx-auto px-5 sm:px-7 py-8 sm:py-12">
          {children}
        </div>
      </main>
    </AuthGuard>
  );
}
