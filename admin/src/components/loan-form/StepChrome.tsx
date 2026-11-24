"use client";

// The frame every page of the team's 6-step loan form shares:
//   StepHeader    — white top bar: "Back" + the "Loan Application · Step N" pill
//   StepLoading / StepNotFound — the two full-screen states before the form shows
//   StepTracker   — the tracker card, fed straight from the loaded loan row
//   StepTitle     — the big green page title + optional intro line
//   StepNav       — the bottom "← Previous / Next" card (with the save error)

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoanAppStepTracker from "@/components/LoanAppStepTracker";
import { ErrorBox } from "./Fields";

/** The EPC names every step reads alongside the loan row. */
export type EpcNames = {
  contact_name: string | null;
  trade_name: string | null;
  legal_name: string | null;
  epc_display_id: string | null;
};

/** The select fragment that joins those names onto an epc_applications read. */
export const EPC_JOIN = "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)";

/** Name shown on the tracker: trade name, else legal name, else contact, else `fallback`. */
export function customerNameOf(e: EpcNames | null | undefined, fallback = "(customer)"): string {
  return e?.trade_name || e?.legal_name || e?.contact_name || fallback;
}

/** Shown on Next while required fields are still empty (admins may continue anyway). */
export const INCOMPLETE_NOTE = "Some fields are incomplete — you can still continue as admin.";

/** Top bar. `backTo` is the page the Back button opens; `children` sits on the right. */
export function StepHeader({
  step, backTo, backLabel = "Back to previous step", children,
}: {
  step: number;
  backTo: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  return (
    <header className="border-b border-line bg-white">
      <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(backTo)}
            aria-label={backLabel}
            className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-cc-blue hover:text-cc-ink transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Back
          </button>
          <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">
            {`Loan Application · Step ${step}`}
          </span>
        </div>
        {children}
      </div>
    </header>
  );
}

export function StepLoading() {
  return <main className="min-h-screen grid place-items-center"><p className="text-text-muted">Loading…</p></main>;
}

export function StepNotFound() {
  return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Loan application not found.</p></main>;
}

/** The step tracker card for `loan` (its id, created date and EPC names). */
export function StepTracker({
  loan, step,
}: {
  loan: { id: string; created_at: string; epc_business: EpcNames | null };
  step: number;
}) {
  return (
    <LoanAppStepTracker
      applicationId={loan.id}
      displayId={loan.epc_business?.epc_display_id ?? null}
      name={customerNameOf(loan.epc_business)}
      createdAt={loan.created_at}
      currentStep={step}
    />
  );
}

/** Page title; `children` (optional) is the grey intro line under it. */
export function StepTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-cc-ink">
        {title}
      </h1>
      {children && <p className="text-text-mid mt-2 text-[15px]">{children}</p>}
    </div>
  );
}

/** Bottom card: save error (if any), "← Previous" (opens `prevTo`) and the Next button. */
export function StepNav({
  error, roomyError, prevTo, onNext, saving, nextLabel = "Next", nextTitle,
}: {
  error: string | null;
  roomyError?: boolean;     // p-3.5 error box instead of p-3
  prevTo: string;
  onNext: () => void;
  saving: boolean;
  nextLabel?: string;
  nextTitle?: string;       // tooltip on Next
}) {
  const router = useRouter();
  return (
    <Card className="p-6">
      <ErrorBox message={error} roomy={roomyError} className="mb-4" />
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(prevTo)}
        >
          ← Previous
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onNext}
          loading={saving}
          disabled={saving}
          title={nextTitle}
        >
          {nextLabel}
        </Button>
      </div>
    </Card>
  );
}
