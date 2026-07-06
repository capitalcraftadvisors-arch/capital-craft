"use client";

// Loan Application — Step 5 placeholder.
//
// Step 5 is not built yet. Landing here means Step 4 (Personal Details)
// has been saved. Real Step 5 content ships in a later batch.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoanAppStepTracker from "@/components/LoanAppStepTracker";
import { supabase } from "@/lib/supabase";

type Loan = {
  id: string;
  status: string;
  current_step: number;
  created_at: string;
  employment_type: string | null;
  bank_name: string | null;
  bank_account_holder: string | null;
  epc_business: {
    contact_name: string | null;
    trade_name: string | null;
    legal_name: string | null;
    epc_display_id: string | null;
  } | null;
};

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

  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("epc_applications")
        .select(
          "id, status, current_step, created_at, " +
          "employment_type, bank_name, bank_account_holder, " +
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .eq("id", params.id)
        .maybeSingle();
      setLoan(data as unknown as Loan | null);
      setLoading(false);
    })();
  }, [params.id]);

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

      <section className="max-w-[880px] mx-auto px-5 sm:px-7 py-8 space-y-5">
        <LoanAppStepTracker
          applicationId={loan.id}
          displayId={loan.epc_business?.epc_display_id ?? null}
          name={customerName}
          createdAt={loan.created_at}
          currentStep={5}
        />

        <Card className="p-8 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-[#f0faf5] flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#178a5c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="font-display text-[22px] sm:text-[26px] font-bold text-[#0f3d2e]">
            Step 4 complete
          </h1>
          <p className="text-text-mid text-[14px] max-w-md mx-auto">
            Personal details saved.
            {loan.bank_account_holder && loan.bank_name && (
              <>
                {" "}Bank verified:{" "}
                <span className="font-semibold text-text">
                  {loan.bank_account_holder}
                </span>
                {" "}·{" "}
                <span className="font-semibold text-text">{loan.bank_name}</span>.
              </>
            )}
          </p>
        </Card>

        <Card className="p-6 space-y-3">
          <h2 className="font-display font-semibold text-[16px]">Step 5 — coming soon</h2>
          <p className="text-[13px] text-text-mid">
            The next section of the flow is being built. This page will host it.
            For now, close this tab or head back to the console — Steps 1-4
            are safely saved.
          </p>
          <div className="pt-2 flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/admin")}
            >
              Back to console
            </Button>
          </div>
        </Card>

        <div className="text-[11px] text-text-muted">
          Application ID: <span className="font-mono">{loan.id}</span> · Current step: {loan.current_step}
        </div>
      </section>
    </main>
  );
}
