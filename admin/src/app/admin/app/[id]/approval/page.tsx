"use client";

// Loan Application — approval details screen.
//
// Step 3 of the approval flow:
//   View → "Approval" → popup (pick lender + confirm) → THIS SCREEN →
//   fill the table → Save → back to the View (read-only from then on).
//
// The lender arrives as ?lender=<key> from the popup. Saving writes, in one
// update: status='approved', approved_lender, approved_at, approval_details
// (the table payload), plus a status_history entry and a loan_activity_log
// row so the Activity log shows the approval.
//
// The table itself lives in @/components/ApprovalDetailsTable — that's the
// single place to change its fields (stored as jsonb, so no migration).

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getBusiness } from "@/lib/auth";
import { logLoanActivity } from "@/lib/loanAudit";
import ApprovalDetailsTable, { LENDER_LABEL, type ApprovalDetails } from "@/components/ApprovalDetailsTable";
import type { LenderKey } from "@/components/LenderPickerModal";
import { rupeesInWords } from "@/lib/numberToWords";
import { I, SectionCard } from "@/components/view/ViewKit";
import FileUpload from "@/components/FileUpload";

function fmtRs(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export default function LoanApprovalPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const lender = (search.get("lender") ?? "") as LenderKey | "";
  // ?edit=approval / ?edit=sanction → editing one section once (from the
  // profile's Edit dropdown). Absent → the initial approval flow.
  const editMode = search.get("edit"); // null | "approval" | "sanction"

  const [loan, setLoan] = useState<Record<string, any> | null>(null);
  const [details, setDetails] = useState<ApprovalDetails>({});
  const [sanctionChoice, setSanctionChoice] = useState<"upload" | "unavailable" | null>(null);
  const [creditScore, setCreditScore] = useState<string>("");
  const [creditNone, setCreditNone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("epc_applications")
        .select("*")
        .eq("id", params.id)
        .maybeSingle();
      setLoan(data);
      if (data) {
        // Seed the table: lender from the popup, "applied" columns snapshotted
        // from what the applicant asked for. The APPROVED columns start at
        // ZERO — the admin must type what the lender actually sanctioned, so
        // a pre-filled value can never be saved by accident.
        // When editing (from the profile's Edit dropdown), seed the approved
        // columns from what was saved; on a fresh approval they start at ZERO
        // so a pre-filled value can never be saved by accident.
        const existing = (data.approval_details ?? null) as ApprovalDetails | null;
        const editing = editMode != null;
        setDetails({
          approved_by: lender || data.approved_lender || null,
          applied_loan_amount:   data.loan_amount_required ?? null,
          approved_loan_amount:  editing ? (existing?.approved_loan_amount ?? 0) : 0,
          applied_tenure_years:  data.selected_tenure_years ?? null,
          approved_tenure_years: editing ? (existing?.approved_tenure_years ?? 0) : 0,
          tentative_emi:         data.selected_monthly_emi ?? null,
          approved_emi:          editing ? (existing?.approved_emi ?? 0) : 0,
        });
        if (data.sanction_letter_unavailable) setSanctionChoice("unavailable");
        if (data.credit_score != null) setCreditScore(String(data.credit_score));
      }
      setLoading(false);
    })();
  }, [params.id, lender]);

  const applicantName = useMemo(
    () => loan?.borrower_name || loan?.aadhaar_name || "(unnamed applicant)",
    [loan],
  );

  async function save() {
    if (!loan || saving) return;
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
    if (!(approvedAmt < applied)) {
      setError(`Approved amount must be less than the applied amount (${fmtRs(applied)} — ${rupeesInWords(applied)}).`);
      return;
    }
    if (!(approvedTen > 0)) { setError("Approved tenure (years) is required."); return; }
    if (!(approvedEmi > 0)) { setError("Approved EMI is required."); return; }

    // Credit score is required on approval — a positive integer or "None".
    if (!creditNone && !(Number(creditScore) > 0)) {
      setError("Enter a credit score (a positive number) or tick “None”.");
      return;
    }

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
    };

    // Approval details are fully editable, repeatedly — no edit-once lock. On an
    // EDIT (editMode === "approval") the status is left untouched so a case
    // already at RFD/disbursed doesn't regress.
    if (editMode !== "approval") {
      // Fresh approval — set status + supersede any prior rejection.
      patch.status = "approved";
      patch.approved_at = now;
      patch.rejected_lender = null;
      patch.rejected_at = null;
      const entry = { from: loan.status ?? "", to: "approved", by, at: now, note: `Approved by ${LENDER_LABEL[String(details.approved_by)] ?? details.approved_by}` };
      patch.status_history = Array.isArray(loan.status_history) ? [...loan.status_history, entry] : [entry];
    }

    const { error: err } = await supabase().from("epc_applications").update(patch).eq("id", loan.id);
    if (err) {
      setError("Couldn't save the approval — " + err.message);
      setSaving(false);
      return;
    }

    // Per-lender record (loan_application_lenders): mark THIS lender approved and
    // store ITS OWN approval details (6h), so multiple lenders each keep a
    // separate record and the Lender Status box shows the approved tick.
    if (lender) {
      const label = search.get("label") || LENDER_LABEL[String(lender)] || String(lender);
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
        : `Approved by ${LENDER_LABEL[String(details.approved_by)] ?? details.approved_by}`,
    });

    router.push(`/admin/app/${loan.id}/view` as any);
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-[#5a8a76]">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Loan application not found.</p></main>;
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button
            onClick={() => router.push(`/admin/app/${loan.id}/view` as any)}
            className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1"
          >
            ← Back to profile
          </button>
          <span className="font-display font-bold text-[18px] text-[#0f3d2e]">Capital Craft</span>
        </div>
      </header>

      <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 py-8" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>
        <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-5 sm:p-6 mb-4">
          <div className="text-[24px] font-semibold text-[#0f3d2e] truncate">
            {editMode === "approval" ? "Edit approval details" : "Approval details"}
          </div>
          <div className="text-[14px] text-[#5a8a76] mt-0.5 truncate">
            {applicantName}
            {details.approved_by && (
              <> · approved by <span className="font-semibold text-[#178a5c]">{LENDER_LABEL[String(details.approved_by)] ?? details.approved_by}</span></>
            )}
          </div>
        </div>

        {editMode !== "sanction" && (
          <SectionCard title="Approval details" accent="green" icon={I.money}>
            <ApprovalDetailsTable value={details} onChange={setDetails} />

            {/* Credit score — required: a positive integer or "None". */}
            <div className="mt-4 pt-4 border-t border-[#eef1f4]">
              <label className="block text-[13px] font-medium text-[#0f3d2e] mb-1.5">Credit score</label>
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
              All fields are required. The approved amount must be greater than 0 and
              less than the applied amount. Saved once, then editable one more time
              from the profile&rsquo;s Edit menu before it locks.
            </p>
          </SectionCard>
        )}

        {/* Sanction letter — part of Approval details (collected here at approval
            time). Shown for both the initial approval and the Approval-details edit. */}
        {(
          <SectionCard title="Sanction letter" accent="green" icon={I.money}>
            <p className="text-[13px] text-[#5a8a76] mb-3">
              Attach the sanction letter, or mark it unavailable for now — you can
              update it later from the profile&rsquo;s Edit → Approval details.
            </p>
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
          </SectionCard>
        )}

        {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push(`/admin/app/${loan.id}/view` as any)}
            disabled={saving}
            className="px-5 py-3 text-[15px] font-semibold bg-white border border-[#cdeadd] text-[#5a8a76] rounded-[10px] hover:bg-[#f0faf5] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="px-6 py-3 text-[15px] font-semibold bg-[#178a5c] text-white rounded-[10px] hover:bg-[#12734c] disabled:opacity-70 inline-flex items-center gap-2"
          >
            {I.check} {saving ? "Saving…" : "Save approval"}
          </button>
        </div>
      </div>
    </main>
  );
}
