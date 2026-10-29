"use client";

// Loan approval-details form — ONE form used by the approval page and the loan
// profile's "Approved" stage (so the two never drift). Saving writes, in one
// update: status='approved', approved_lender, approved_at, approval_details
// (the table payload), plus a status_history entry, the per-lender record and a
// loan_activity_log row.
//
// editMode "approval" = editing saved details: the status/approved_at stay as
// they are, so a case already at RFD/disbursed doesn't regress. null = a fresh
// approval by `lender`.
//
// The table itself lives in @/components/ApprovalDetailsTable — that's the
// single place to change its fields (stored as jsonb, so no migration).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBusiness } from "@/lib/auth";
import { logLoanActivity } from "@/lib/loanAudit";
import { invalidateLoanBoards } from "@/lib/ops-board";
import ApprovalDetailsTable, { type ApprovalDetails } from "@/components/ApprovalDetailsTable";
import { useLenders } from "@/lib/lenders";
import { lenderLabelIn } from "@/lib/loan-lenders";
import { rupeesInWords } from "@/lib/numberToWords";
import { I, Section } from "@/components/view/ViewKit";
import FileUpload from "@/components/FileUpload";
import { fmtRupeesExact as fmtRs } from "@/lib/money"; // approval amounts are shown exact, never rounded
import { reviewPatch, invalidatePendingCount } from "@/lib/review";

type Loan = Record<string, any>;

export default function LoanApprovalForm({
  loan, lender, lenderLabel, editMode, hasSanctionLetter, onSaved, onCancel,
}: {
  loan: Loan;
  lender: string;               // the approving lender's key ("" → the saved one)
  lenderLabel?: string | null;  // its display name (custom lenders)
  editMode: "approval" | "sanction" | null;
  hasSanctionLetter?: boolean;  // a sanction_letter doc is already on file
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const lenders = useLenders();
  const [details, setDetails] = useState<ApprovalDetails>({});
  const [sanctionChoice, setSanctionChoice] = useState<"upload" | "unavailable" | null>(null);
  const [creditScore, setCreditScore] = useState<string>("");
  const [creditNone, setCreditNone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Seed the table: lender as chosen, "applied" columns snapshotted from what
    // the applicant asked for. Prefill from what was saved whenever this
    // application ALREADY has approval details — arrived via Edit, or just
    // re-opened — so nothing has to be re-typed (e.g. only adding the credit
    // score later). Only a genuinely fresh, first-time approval starts blank,
    // so a pre-filled value can never be saved by accident.
    const existing = (loan.approval_details ?? null) as ApprovalDetails | null;
    const hasSaved = !!(existing && (existing.approved_loan_amount != null || existing.approved_tenure_years != null || existing.approved_emi != null));
    const editing = editMode != null || hasSaved;
    const today = new Date().toISOString().slice(0, 10);
    setDetails({
      // On EDIT, restore EVERY previously-saved field (roi, approval_date,
      // approved_* …); only the "applied" snapshots refresh from the application.
      ...(editing && existing ? existing : {}),
      approved_by: lender || loan.approved_lender || existing?.approved_by || null,
      applied_loan_amount:   loan.loan_amount_required ?? existing?.applied_loan_amount ?? null,
      approved_loan_amount:  editing ? (existing?.approved_loan_amount ?? null) : null,
      applied_tenure_years:  loan.selected_tenure_years ?? existing?.applied_tenure_years ?? null,
      approved_tenure_years: editing ? (existing?.approved_tenure_years ?? null) : null,
      tentative_emi:         loan.selected_monthly_emi ?? existing?.tentative_emi ?? null,
      approved_emi:          editing ? (existing?.approved_emi ?? null) : null,
      approval_date:         (editing ? existing?.approval_date : null) ?? today,
    });
    // A letter already on file opens the upload slot, so it shows as filled.
    setSanctionChoice(loan.sanction_letter_unavailable ? "unavailable" : hasSanctionLetter ? "upload" : null);
    setCreditScore(loan.credit_score != null ? String(loan.credit_score) : "");
    // Re-seed only when the lender / mode changes — not on every loan re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan.id, lender, editMode]);

  async function save() {
    if (saving) return;
    const me = getBusiness();
    const by = me?.contact_name || "admin";
    const now = new Date().toISOString();

    // ── Approval details (initial approval OR edit) — all fields mandatory
    //    except the sanction letter; approved amount must be > 0 and < applied. ──
    if (!details.approved_by) {
      setError("No lender selected — go back to the profile and start the approval again.");
      return;
    }
    const applied      = Number(details.applied_loan_amount ?? 0);
    const approvedAmt  = Number(details.approved_loan_amount ?? 0);
    const approvedTen  = Number(details.approved_tenure_years ?? 0);
    const approvedEmi  = Number(details.approved_emi ?? 0);
    if (!(approvedAmt > 0)) { setError("Approved loan amount must be greater than 0."); return; }
    if (!(applied > 0))     { setError("The applied loan amount is missing on this application."); return; }
    if (!(approvedAmt <= applied)) {
      setError(`Approved amount can’t exceed the applied amount (${fmtRs(applied)} — ${rupeesInWords(applied)}).`);
      return;
    }
    if (!(approvedTen > 0)) { setError("Approved tenure (years) is required."); return; }
    if (!(approvedEmi > 0)) { setError("Approved EMI is required."); return; }

    // Credit score is OPTIONAL — if it isn't available yet, leave it blank (or
    // tick "None") and fill it in later.

    setSaving(true);
    setError(null);

    const patch: Record<string, any> = {
      approved_lender:  details.approved_by,
      approval_details: details,
      // The approval-complete gate — unlocks the Disbursement action + RFD.
      approval_details_filled: true,
      // Denormalised out of approval_details so disbursement math / lists / sort
      // key off a real column.
      sanctioned_amount: details.approved_loan_amount ?? null,
      // Sanction letter is part of approval details — record its state here.
      sanction_letter_unavailable: sanctionChoice === "unavailable",
      // Credit score — a positive integer, or null when "None" is chosen.
      credit_score: creditNone ? null : (Number(creditScore) > 0 ? Number(creditScore) : null),
      reviewed_by: by, reviewed_at: now,
      // Pendings: a team member's approval details wait for the main admin.
      ...reviewPatch("approval"),
    };

    // Approval details are fully editable, repeatedly — no edit-once lock. On an
    // EDIT the status is left untouched so a case already at RFD/disbursed
    // doesn't regress.
    if (editMode !== "approval") {
      // Fresh approval — set status + supersede any prior rejection.
      patch.status = "approved";
      patch.approved_at = now;
      patch.rejected_lender = null;
      patch.rejected_at = null;
      const entry = { from: loan.status ?? "", to: "approved", by, at: now, note: `Approved by ${lenderLabelIn(lenders, String(details.approved_by))}` };
      patch.status_history = Array.isArray(loan.status_history) ? [...loan.status_history, entry] : [entry];
    }

    // The captured approval date is authoritative for approved_at (TAT / sort),
    // for both a fresh approval and a later edit.
    if (details.approval_date) {
      patch.approved_at = new Date(details.approval_date + "T00:00:00").toISOString();
    }

    const { error: err } = await supabase().from("epc_applications").update(patch).eq("id", loan.id);
    if (err) {
      setError("Couldn't save the approval — " + err.message);
      setSaving(false);
      return;
    }

    // Per-lender record (loan_application_lenders): mark THIS lender approved and
    // store ITS OWN approval details, so multiple lenders each keep a separate
    // record and the lender list shows the approval.
    if (lender) {
      const label = lenderLabel || lenderLabelIn(lenders, String(lender));
      const { data: existingLender } = await supabase()
        .from("loan_application_lenders")
        .select("id, approved_at")
        .eq("application_id", loan.id)
        .eq("lender_key", lender)
        .maybeSingle();
      const lp: Record<string, unknown> = {
        approval_recorded_at: now,
        // Store credit score inside the per-lender details so each lender's card
        // shows its own score when comparing/finalizing.
        approval_details: { ...details, credit_score: creditNone ? null : (Number(creditScore) > 0 ? Number(creditScore) : null) },
        rejected_at: null,
        rejection_reason: null,
      };
      if (editMode !== "approval") lp.approved_at = now;
      if (existingLender) {
        const ex = existingLender as { id: string; approved_at: string | null };
        if (!ex.approved_at && lp.approved_at == null) lp.approved_at = now;
        await supabase().from("loan_application_lenders").update(lp).eq("id", ex.id);
      } else {
        await supabase().from("loan_application_lenders").insert({
          application_id: loan.id, lender_key: lender, lender_label: label,
          docs_sent_at: now, approved_at: now, ...lp,
        });
      }
    }

    await logLoanActivity(loan.id, "approved", {
      detail: editMode === "approval"
        ? "Approval details edited"
        : `Approved by ${lenderLabelIn(lenders, String(details.approved_by))}`,
    });

    invalidateLoanBoards(); // approval reflects on the Task Manager / Loans list / KPIs
    invalidatePendingCount();
    setSaving(false);
    onSaved();
  }

  const lenderName = details.approved_by ? (lenderLabel || lenderLabelIn(lenders, String(details.approved_by))) : null;

  return (
    <div>
      {editMode !== "sanction" && (
        <Section title="Approval details" summary={lenderName ?? undefined}>
          <ApprovalDetailsTable value={details} onChange={setDetails} />

          {/* Credit score — optional: a positive integer or "None". */}
          <div className="mt-4 pt-4 border-t border-[#eef1f4]">
            <label className="block text-[13px] font-medium text-[#0f3d2e] mb-1.5">Credit score <span className="text-[#5a8a76] font-normal">(optional)</span></label>
            <div className="flex items-center gap-4 flex-wrap">
              <input
                type="text"
                inputMode="numeric"
                value={creditNone ? "" : creditScore}
                disabled={creditNone}
                onChange={(e) => setCreditScore(e.target.value.replace(/\D/g, ""))}
                placeholder="e.g. 750"
                className="w-40 rounded-input border-2 border-line px-3.5 py-2.5 text-[15px] outline-none focus:border-[#178a5c] disabled:bg-bg-tint disabled:opacity-60"
              />
              <label className="flex items-center gap-2 text-[14px] text-[#0f3d2e] cursor-pointer">
                <input
                  type="checkbox"
                  checked={creditNone}
                  onChange={(e) => { setCreditNone(e.target.checked); if (e.target.checked) setCreditScore(""); }}
                  className="h-4 w-4 accent-[#178a5c]"
                />
                None
              </label>
            </div>
          </div>

          <p className="text-[12px] text-[#5a8a76] mt-3">
            The approved amount must be greater than 0 and not more than the applied
            amount. Credit score is optional. Everything you save here is restored when
            you edit approval details later — you won&rsquo;t need to re-enter it.
          </p>
        </Section>
      )}

      {/* Sanction letter — part of Approval details (collected at approval time). */}
      <Section title="Sanction letter">
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => setSanctionChoice("upload")}
            className={[
              "px-4 py-2 rounded-[8px] text-[13px] font-semibold border transition-colors",
              sanctionChoice === "upload" ? "bg-[#178a5c] text-white border-[#178a5c]" : "bg-white text-[#0f3d2e] border-[#cdeadd] hover:bg-[#f0faf5]",
            ].join(" ")}
          >
            Upload sanction letter
          </button>
          <button
            type="button"
            onClick={() => setSanctionChoice("unavailable")}
            className={[
              "px-4 py-2 rounded-[8px] text-[13px] font-semibold border transition-colors",
              sanctionChoice === "unavailable" ? "bg-[#854f0b] text-white border-[#854f0b]" : "bg-white text-[#0f3d2e] border-[#cdeadd] hover:bg-[#f0faf5]",
            ].join(" ")}
          >
            I don&rsquo;t have it now
          </button>
        </div>
        {sanctionChoice === "upload" && (
          <FileUpload
            applicationId={loan.id}
            category="sanction_letter"
            table="user_application_docs"
            uploadedBy="admin"
            maxFiles={1}
            uploadHint="PDF or image"
          />
        )}
        {sanctionChoice === "unavailable" && (
          <p className="text-[12px] text-[#854f0b] bg-[#fef8ee] border border-[#f3d9a4] rounded-[8px] px-3 py-2">
            Will be recorded as not available at the time of filling. You can upload it later.
          </p>
        )}
      </Section>

      {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}

      <div className="mt-5 flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-5 py-2.5 text-[14px] font-semibold bg-white border border-[#cdeadd] text-[#5a8a76] rounded-[10px] hover:bg-[#f0faf5] disabled:opacity-60"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="px-6 py-2.5 text-[14px] font-semibold bg-[#178a5c] text-white rounded-[10px] hover:bg-[#12734c] disabled:opacity-70 inline-flex items-center gap-2"
        >
          {I.check} {saving ? "Saving…" : "Save approval"}
        </button>
      </div>
    </div>
  );
}
