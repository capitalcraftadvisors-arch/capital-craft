"use client";

// Loan Application — DISBURSEMENT screen (EPC side).
//
// Where an approved application lands when the EPC clicks it. Shows what they
// received, what's still pending, how long they have left, and gives them the
// SAME three completion-document slots the admin sees — whoever uploads first
// fills the slot for both.
//
// Amounts are READ-ONLY here. That isn't just a UI choice: migration 0044's
// trg_disbursement_admin_only rejects any non-admin write to the disbursement
// columns, so an EPC can't set them through the API either.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import CompletionDocsSection from "@/components/CompletionDocsSection";
import { I, SectionCard, KV, Pill } from "@/components/view/ViewKit";
import {
  deadlineState, DEADLINE_PILL, remainingAmount, fmtRupees, fmtDateShort,
  DISBURSEMENT_WINDOW_DAYS,
} from "@/lib/disbursement";

type Loan = Record<string, any>;

export default function EpcDisbursementPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [loading, setLoading] = useState(true);
  const [docsUploaded, setDocsUploaded] = useState(0);
  const [docsTotal, setDocsTotal] = useState(3);

  useEffect(() => {
    void (async () => {
      // RLS scopes this to the EPC's own applications.
      const { data } = await supabase()
        .from("epc_applications").select("*").eq("id", params.id).maybeSingle();
      setLoan(data);
      setLoading(false);
    })();
  }, [params.id]);

  const applicantName = useMemo(
    () => loan?.borrower_name || loan?.aadhaar_name || "(unnamed applicant)",
    [loan],
  );

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-[#5a8a76]">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Application not found.</p></main>;
  }

  const dl = deadlineState(loan.first_disbursement_date);
  const sanctioned = loan.sanctioned_amount != null ? Number(loan.sanctioned_amount) : null;
  const firstSaved = loan.first_disbursement_amount != null;
  const remaining = remainingAmount(sanctioned, loan.first_disbursement_amount);
  const allDocsIn = docsUploaded >= docsTotal;

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1"
          >
            ← Back
          </button>
          <span className="font-display font-bold text-[18px] text-[#0f3d2e]">Capital Craft</span>
        </div>
      </header>

      <div className="w-full max-w-4xl mx-auto px-5 sm:px-8 py-6" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>

        {/* Header — what they got, what's left, how long they have. */}
        <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-5 sm:p-6 mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-[24px] font-semibold text-[#0f3d2e] truncate">{applicantName}</div>
              <div className="flex gap-2 items-center flex-wrap mt-3">
                <Pill tint="blue" icon={I.id}>{loan.loan_display_id ?? loan.id.slice(0, 8).toUpperCase()}</Pill>
                <Pill tint="amber">Approved by lender</Pill>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[11px] font-semibold text-[#5a8a76] uppercase tracking-wider mb-1">Sanctioned</div>
              <div className="text-[26px] font-bold text-[#178a5c] leading-none">{fmtRupees(sanctioned)}</div>
              <div className={["inline-block mt-3 px-3 py-1.5 rounded-[8px] text-[13px] font-semibold", DEADLINE_PILL[dl.tone]].join(" ")}>
                {dl.label}
              </div>
              {dl.started && (
                <div className="text-[11px] text-[#5a8a76] mt-1">Deadline {fmtDateShort(loan.disbursement_deadline)}</div>
              )}
            </div>
          </div>
        </div>

        {/* The deadline, said plainly. */}
        <div
          className={[
            "rounded-[12px] border p-4 sm:p-5 mb-4 text-[13px]",
            dl.overdue ? "border-red-200 bg-red-50 text-red-800" : "border-[#d3e9f7] bg-[#f4fafe] text-[#0f3d2e]",
          ].join(" ")}
        >
          {!firstSaved ? (
            <p>
              Your first disbursement hasn&rsquo;t been released yet. Once it is, you&rsquo;ll have{" "}
              <span className="font-semibold">{DISBURSEMENT_WINDOW_DAYS} days</span> to complete the work and upload the
              three documents below.
            </p>
          ) : dl.overdue ? (
            <p>
              <span className="font-semibold">The {DISBURSEMENT_WINDOW_DAYS}-day window has passed ({dl.label}).</span>{" "}
              Upload the three completion documents as soon as possible — the second disbursement is held until they&rsquo;re
              reviewed.
            </p>
          ) : (
            <p>
              <span className="font-semibold">{dl.label}</span> to finish the work and upload the three completion
              documents. The second disbursement is released after our team reviews them.
            </p>
          )}
        </div>

        <div className="space-y-4">
          <SectionCard title="Disbursement" accent="green" icon={I.money}>
            <KV k="Sanctioned amount" v={fmtRupees(sanctioned)} />
            <KV
              k="First disbursement (received)"
              v={firstSaved ? `${fmtRupees(loan.first_disbursement_amount)} · ${fmtDateShort(loan.first_disbursement_date)}` : "Not released yet"}
              valueClass={firstSaved ? "text-[#178a5c]" : undefined}
            />
            <KV k="Remaining (pending)" v={firstSaved ? fmtRupees(remaining) : "—"} />
            <KV
              k="Second disbursement"
              v={loan.second_disbursement_amount != null
                ? `${fmtRupees(loan.second_disbursement_amount)} · ${fmtDateShort(loan.second_disbursement_date)}`
                : "After work completion & review"}
              valueClass={loan.second_disbursement_amount != null ? "text-[#178a5c]" : undefined}
            />
            {loan.completion_docs_status && (
              <KV k="Document review" v={String(loan.completion_docs_status)[0].toUpperCase() + String(loan.completion_docs_status).slice(1)} />
            )}
          </SectionCard>

          <SectionCard title={`Completion documents (${docsUploaded}/${docsTotal})`} accent="blue" icon={I.files}>
            <p className="text-[13px] text-[#5a8a76] mb-4">
              Upload all three to release the second disbursement.
            </p>
            <CompletionDocsSection
              applicationId={loan.id}
              uploadedBy="epc"
              onCountChange={(u, t) => { setDocsUploaded(u); setDocsTotal(t); }}
            />
            {allDocsIn && loan.completion_docs_status !== "approved" && (
              <p className="text-[13px] text-[#178a5c] font-medium mt-4">
                All three uploaded — our team will review them shortly.
              </p>
            )}
          </SectionCard>
        </div>
      </div>
    </main>
  );
}
