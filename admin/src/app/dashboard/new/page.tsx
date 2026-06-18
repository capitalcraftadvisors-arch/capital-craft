"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import LoanAppForm from "@/components/LoanAppForm";
import { getBusiness } from "@/lib/auth";

export default function NewLoanPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const [bizId, setBizId] = useState<string | null>(null);
  useEffect(() => { const b = getBusiness(); if (b) setBizId(b.id); }, []);
  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <a href="/dashboard" className="font-display font-bold text-[20px] grad-text">Capital Craft</a>
          <a href="/dashboard" className="text-[13px] text-text-muted hover:text-text">← Back to dashboard</a>
        </div>
      </header>

      <section className="max-w-[920px] mx-auto px-5 sm:px-7 py-10">
        <h1 className="font-display text-[26px] sm:text-[30px] font-bold mb-6">New loan application</h1>
        {bizId && <LoanAppForm epcBusinessId={bizId} createdBy="epc" />}
      </section>
    </main>
  );
}
