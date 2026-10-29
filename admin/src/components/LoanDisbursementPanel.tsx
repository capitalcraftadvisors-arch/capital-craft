"use client";

// Loan disbursement panel — ONE implementation for the disbursement page and
// the loan profile's "1st Disbursement" / "2nd Disbursement" stages.
//   part "first"  → 1st-tranche documents + the 1st disbursement (starts the
//                   45-day clock)
//   part "second" → completion documents, their admin review, the 2nd amount
//   part "all"    → both (the disbursement page)
//
// Only admins can write the amounts — migration 0044's
// trg_disbursement_admin_only enforces that at the DB level.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { reviewPatch, invalidatePendingCount } from "@/lib/review";
import { logLoanActivity } from "@/lib/loanAudit";
import { invalidateLoanBoards } from "@/lib/ops-board";
import CompletionDocsSection from "@/components/CompletionDocsSection";
import EmailComposerModal from "@/components/EmailComposerModal";
import { lenderName } from "@/lib/lenders";
import DateField from "@/components/ui/DateField";
import { KV, Section, StatusBtn } from "@/components/view/ViewKit";
import {
  remainingAmount, fmtRupeesExact, fmtDateShort, DISBURSEMENT_WINDOW_DAYS,
} from "@/lib/disbursement";

type Loan = Record<string, any>;

// Local calendar date as YYYY-MM-DD (never toISOString — that shifts IST back a day).
function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function LoanDisbursementPanel({
  loan, part, onChanged,
}: {
  loan: Loan;
  part: "first" | "second" | "all";
  /** Re-read the loan row after a save. */
  onChanged: () => Promise<void> | void;
}) {
  const [firstAmt, setFirstAmt]   = useState("");
  const [firstDate, setFirstDate] = useState(todayISO());
  const [secondAmt, setSecondAmt]   = useState("");
  const [secondDate, setSecondDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docsUploaded, setDocsUploaded] = useState(0);
  // Completion set is 5 (invoice + 3 geo photos + report); the docs section
  // reports the live total via onCountChange, this is just the pre-load default.
  const [docsTotal, setDocsTotal] = useState(5);
  // Tranche-1 docs (Feasibility + MMR / Advance receipt) gate the 1st disbursement.
  const [t1Uploaded, setT1Uploaded] = useState(0);
  const [t1Total, setT1Total] = useState(0);

  // Show what's saved (the form opens filled in).
  useEffect(() => {
    if (loan.first_disbursement_amount != null) setFirstAmt(String(loan.first_disbursement_amount));
    if (loan.first_disbursement_date) setFirstDate(String(loan.first_disbursement_date).slice(0, 10));
    if (loan.second_disbursement_amount != null) setSecondAmt(String(loan.second_disbursement_amount));
    if (loan.second_disbursement_date) setSecondDate(String(loan.second_disbursement_date).slice(0, 10));
  }, [loan.first_disbursement_amount, loan.first_disbursement_date, loan.second_disbursement_amount, loan.second_disbursement_date]);

  async function saveFirst() {
    if (busy) return;
    if (!["approved", "rfd", "sent_to_nbfc", "disbursed"].includes(String(loan.status))) {
      setError("This application is not approved yet. A lender must approve it before any disbursement.");
      return;
    }
    const amt = Number(firstAmt);
    if (!Number.isFinite(amt) || amt <= 0) { setError("Enter a valid first disbursement amount."); return; }
    const sanctioned = Number(loan.sanctioned_amount ?? 0);
    if (sanctioned > 0 && amt > sanctioned) {
      const ok = window.confirm(
        `The first disbursement (${fmtRupeesExact(amt)}) is MORE than the sanctioned amount (${fmtRupeesExact(sanctioned)}).\n\nAre you sure?`,
      );
      if (!ok) return;
    }
    setBusy(true); setError(null); setMsg(null);
    const { error: e } = await supabase()
      .from("epc_applications")
      .update({ first_disbursement_amount: amt, first_disbursement_date: firstDate, ...reviewPatch("disb1") })
      .eq("id", loan.id);
    if (e) { setError("Couldn't save — " + e.message); setBusy(false); return; }
    await logLoanActivity(loan.id, "status_change", {
      detail: `First disbursement ${fmtRupeesExact(amt)} on ${fmtDateShort(firstDate)} — 45-day clock started`,
    });
    invalidateLoanBoards(); // disbursement moves the case on the Task Manager / list
    invalidatePendingCount();
    setMsg("First disbursement saved — the 45-day clock has started.");
    await onChanged();
    setBusy(false);
  }

  async function saveReview(next: "approved" | "rejected") {
    if (busy) return;
    setBusy(true); setError(null); setMsg(null);
    const me = getBusiness();
    const { error: e } = await supabase()
      .from("epc_applications")
      .update({
        completion_docs_status: next,
        completion_reviewed_at: new Date().toISOString(),
        completion_reviewed_by: me?.contact_name || "admin",
      })
      .eq("id", loan.id);
    if (e) { setError("Couldn't save the review — " + e.message); setBusy(false); return; }
    await logLoanActivity(loan.id, "status_change", {
      detail: next === "approved"
        ? "Completion documents reviewed and approved — 2nd disbursement unlocked"
        : "Completion documents rejected — resubmission required",
    });
    setMsg(next === "approved" ? "Documents approved." : "Documents rejected.");
    await onChanged();
    setBusy(false);
  }

  async function saveSecond() {
    if (busy) return;
    const amt = Number(secondAmt);
    if (!Number.isFinite(amt) || amt <= 0) { setError("Enter a valid second disbursement amount."); return; }
    setBusy(true); setError(null); setMsg(null);
    const { error: e } = await supabase()
      .from("epc_applications")
      .update({ second_disbursement_amount: amt, second_disbursement_date: secondDate, ...reviewPatch("disb2") })
      .eq("id", loan.id);
    if (e) { setError("Couldn't save — " + e.message); setBusy(false); return; }
    await logLoanActivity(loan.id, "status_change", {
      detail: `Second disbursement ${fmtRupeesExact(amt)} on ${fmtDateShort(secondDate)}`,
    });
    invalidateLoanBoards(); // 2nd disbursement moves the case on the Task Manager / list
    invalidatePendingCount();
    setMsg("Second disbursement saved.");
    await onChanged();
    setBusy(false);
  }

  // Pendings (maker-checker): a team member can't enter a disbursement while the
  // approval details await the main admin's check (the DB trigger enforces it too).
  const approvalLocked = !isMainAdmin(getBusiness()) && loan.approval_review_status === "pending";
  const sanctioned = loan.sanctioned_amount != null ? Number(loan.sanctioned_amount) : null;
  const firstSaved = loan.first_disbursement_amount != null;
  // No disbursement is allowed until a lender has APPROVED the application.
  const isApproved = ["approved", "rfd", "sent_to_nbfc", "disbursed"].includes(String(loan.status));
  // The 1st-disbursement entry opens once both Tranche-1 documents are uploaded
  // (or it was already recorded) AND the application is approved.
  const tranche1Complete = isApproved && (firstSaved || (t1Total > 0 && t1Uploaded >= t1Total));
  const remaining = remainingAmount(sanctioned, loan.first_disbursement_amount);
  const reviewState: string | null = loan.completion_docs_status ?? null;
  const allDocsIn = docsUploaded >= docsTotal;
  const secondUnlocked = reviewState === "approved";
  const showFirst = part !== "second";
  const showSecond = part !== "first";

  const inputCls =
    "w-full border border-[#cdeadd] rounded-[8px] px-3 py-2.5 text-[14px] " +
    "focus:border-[#185fa5] outline-none bg-white";

  return (
    <div>
      {!isApproved && (
        <div className="mt-5 rounded-[8px] border border-[#f3d9a4] bg-[#fef8ee] px-4 py-3 text-[13px] text-[#854f0b]">
          This application is not approved yet. Disbursement opens only after a lender approves it (which requires the documents to have been sent).
        </div>
      )}

      {showFirst && (
        <>
          <Section title="1st tranche documents">
            <p className="text-[13px] text-[#5a8a76] mb-3">
              {loan.approved_lender === "solfin"
                ? "Upload the Feasibility Report. The MMR / Advance Receipt is optional for Solfin. Once the required document is in, the 1st-disbursement entry below opens."
                : "Upload the Feasibility Report and MMR / Advance Receipt. Once both are in, the 1st-disbursement entry below opens."}
            </p>
            <CompletionDocsSection
              applicationId={loan.id}
              uploadedBy="admin"
              mode="tranche1"
              advanceReceiptOptional={loan.approved_lender === "solfin"}
              onCountChange={(u, t) => { setT1Uploaded(u); setT1Total(t); }}
            />
          </Section>

          <Section title="1st disbursement">
            {!tranche1Complete || approvalLocked ? (
              <p className="text-[13px] text-[#854f0b] bg-[#fef8ee] border border-[#f3d9a4] rounded-[8px] px-3 py-2">
                {approvalLocked
                  ? "Waiting for the admin to approve the approval details."
                  : !isApproved
                  ? "The application must be approved by a lender before the 1st disbursement can be entered."
                  : "Upload both Tranche-1 documents above to open the 1st disbursement."}
              </p>
            ) : (
              <>
                {firstSaved ? (
                  <div className="mb-3 text-[12px] text-[#5a8a76]">
                    Deadline (45 days): <span className="font-semibold text-[#0f3d2e]">{fmtDateShort(loan.disbursement_deadline)}</span>
                    {" · "}Remaining (pending): <span className="font-semibold text-[#0f3d2e]">{fmtRupeesExact(remaining)}</span>
                  </div>
                ) : (
                  <p className="text-[13px] text-[#5a8a76] mb-3">
                    Entering the first disbursement starts the {DISBURSEMENT_WINDOW_DAYS}-day completion clock from the date below.
                  </p>
                )}
                <div className="grid sm:grid-cols-2 gap-3 max-w-[640px]">
                  <div>
                    <p className="text-[12px] text-[#5a8a76] mb-1">First disbursement amount</p>
                    <input type="text" inputMode="decimal" className={inputCls} placeholder="0"
                      value={firstAmt} onChange={(e) => setFirstAmt(e.target.value.replace(/[^\d.]/g, ""))} />
                  </div>
                  <div>
                    <p className="text-[12px] text-[#5a8a76] mb-1">Date</p>
                    <DateField className={inputCls} value={firstDate} onChange={(iso) => setFirstDate(iso)} ariaLabel="First disbursement date" />
                  </div>
                </div>
                {sanctioned != null && firstAmt && Number(firstAmt) > 0 && (
                  <p className="text-[12px] text-[#5a8a76] mt-2">
                    Remaining after this: <span className="font-semibold text-[#0f3d2e]">{fmtRupeesExact(remainingAmount(sanctioned, Number(firstAmt)))}</span>
                  </p>
                )}
                <div className="mt-4">
                  <button type="button" onClick={() => void saveFirst()} disabled={busy}
                    className="px-4 py-2 bg-[#178a5c] text-white rounded-[8px] text-[13px] font-semibold hover:bg-[#12734c] disabled:opacity-60">
                    {busy ? "Saving…" : firstSaved ? "Update first disbursement" : "Save first disbursement"}
                  </button>
                </div>
              </>
            )}
          </Section>
        </>
      )}

      {showSecond && (
        <>
          {/* Completion docs — only meaningful once the clock is running. */}
          <Section title="Completion documents" summary={`${docsUploaded}/${docsTotal}`}>
            {!firstSaved ? (
              <p className="text-[13px] text-[#5a8a76]">
                Enter the first disbursement to begin collecting completion documents.
              </p>
            ) : (
              <>
                <p className="text-[13px] text-[#5a8a76] mb-4">
                  Collected from the customer. The EPC can upload these too — same slots.
                </p>
                <CompletionDocsSection
                  applicationId={loan.id}
                  uploadedBy="admin"
                  mode="tranche2"
                  onCountChange={(u, t) => { setDocsUploaded(u); setDocsTotal(t); }}
                />
              </>
            )}
          </Section>

          {/* Admin review — gate for the 2nd disbursement. */}
          {firstSaved && (
            <Section title="Documents review">
              <div className="max-w-[520px]">
                <KV k="Status" v={reviewState ? reviewState[0].toUpperCase() + reviewState.slice(1) : "Not reviewed"} />
                {loan.completion_reviewed_at && (
                  <KV k="Reviewed" v={`${fmtDateShort(loan.completion_reviewed_at)}${loan.completion_reviewed_by ? ` · ${loan.completion_reviewed_by}` : ""}`} />
                )}
              </div>
              {!allDocsIn && reviewState !== "approved" && (
                <p className="text-[12px] text-[#854f0b] mt-2">
                  All {docsTotal} completion documents must be uploaded before review.
                </p>
              )}
              <div className="flex gap-2 mt-3 flex-wrap">
                {/* Email the 2nd-tranche completion docs to the lender who approved
                    this loan (opens the editable email popup). */}
                {loan.approved_lender && (
                  <button
                    type="button"
                    disabled={busy || !allDocsIn}
                    onClick={() => setEmailOpen(true)}
                    title={allDocsIn ? "Email the completion documents to the lender" : "Upload all completion documents first"}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-[13px] font-semibold bg-[#178a5c] text-white hover:bg-[#12734c] disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                    Email to {lenderName(loan.approved_lender) || "lender"}
                  </button>
                )}
                <StatusBtn kind="approve" busy={busy || !allDocsIn} onClick={() => void saveReview("approved")}>
                  Approve documents
                </StatusBtn>
                <StatusBtn kind="danger" busy={busy || !allDocsIn} onClick={() => void saveReview("rejected")}>
                  Reject
                </StatusBtn>
              </div>
            </Section>
          )}

          {/* 2nd disbursement — unlocked by an approved review. */}
          {firstSaved && (
            <Section title="2nd disbursement">
              {approvalLocked || (!secondUnlocked && loan.second_disbursement_amount == null) ? (
                <p className="text-[13px] text-[#5a8a76]">
                  {approvalLocked
                    ? "Waiting for the admin to approve the approval details."
                    : "Available once the completion documents are reviewed and approved above."}
                </p>
              ) : (
                <>
                  <p className="text-[13px] text-[#5a8a76] mb-3">
                    Pending after the first disbursement: <span className="font-semibold text-[#0f3d2e]">{fmtRupeesExact(remaining)}</span>
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3 max-w-[640px]">
                    <div>
                      <p className="text-[12px] text-[#5a8a76] mb-1">Second disbursement amount</p>
                      <input type="text" inputMode="decimal" className={inputCls} placeholder="0"
                        value={secondAmt} onChange={(e) => setSecondAmt(e.target.value.replace(/[^\d.]/g, ""))} />
                    </div>
                    <div>
                      <p className="text-[12px] text-[#5a8a76] mb-1">Date</p>
                      <DateField className={inputCls} value={secondDate} onChange={(iso) => setSecondDate(iso)} ariaLabel="Second disbursement date" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <button type="button" onClick={() => void saveSecond()} disabled={busy}
                      className="px-4 py-2 bg-[#178a5c] text-white rounded-[8px] text-[13px] font-semibold hover:bg-[#12734c] disabled:opacity-60">
                      {busy ? "Saving…" : loan.second_disbursement_amount != null ? "Update second disbursement" : "Save second disbursement"}
                    </button>
                  </div>
                </>
              )}
            </Section>
          )}
        </>
      )}

      {msg && <p className="text-[13px] text-[#178a5c] mt-3">{msg}</p>}
      {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}

      <EmailComposerModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        endpoint={`/api/admin/loan-app/${loan.id}/send-to-lender`}
        extraParams={{ scope: "completion" }}
        defaultLender={(loan.approved_lender as string) ?? null}
        title="Email completion documents"
        onSent={() => { setEmailOpen(false); setMsg("Completion documents emailed to the lender."); }}
      />
    </div>
  );
}
