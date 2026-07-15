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
import { I, SectionCard } from "@/components/view/ViewKit";

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

  const [loan, setLoan] = useState<Record<string, any> | null>(null);
  const [details, setDetails] = useState<ApprovalDetails>({});
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
        // from what the applicant asked for. Approved columns start blank and
        // default to the applied value so the common case is one click.
        setDetails({
          approved_by: lender || data.approved_lender || null,
          applied_loan_amount:   data.loan_amount_required ?? null,
          approved_loan_amount:  data.loan_amount_required ?? null,
          applied_tenure_years:  data.selected_tenure_years ?? null,
          approved_tenure_years: data.selected_tenure_years ?? null,
          tentative_emi:         data.selected_monthly_emi ?? null,
          approved_emi:          data.selected_monthly_emi ?? null,
        });
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
    if (!details.approved_by) {
      setError("No lender selected — go back to the View and start the approval again.");
      return;
    }
    setSaving(true);
    setError(null);

    const me = getBusiness();
    const by = me?.contact_name || "admin";
    const now = new Date().toISOString();
    const entry = { from: loan.status ?? "", to: "approved", by, at: now, note: `Approved by ${LENDER_LABEL[String(details.approved_by)] ?? details.approved_by}` };
    const history = Array.isArray(loan.status_history) ? [...loan.status_history, entry] : [entry];

    const { error: err } = await supabase()
      .from("epc_applications")
      .update({
        status: "approved",
        approved_lender: details.approved_by,
        approved_at: now,
        approval_details: details,
        // A fresh approval supersedes any previous rejection.
        rejected_lender: null,
        rejected_at: null,
        status_history: history,
        reviewed_by: by,
        reviewed_at: now,
      })
      .eq("id", loan.id);

    if (err) {
      setError("Couldn't save the approval — " + err.message);
      setSaving(false);
      return;
    }

    await logLoanActivity(loan.id, "approved", {
      detail: `Approved by ${LENDER_LABEL[String(details.approved_by)] ?? details.approved_by}`,
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

      <div className="w-full max-w-4xl mx-auto px-5 sm:px-8 py-6" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>
        <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-5 sm:p-6 mb-4">
          <div className="text-[24px] font-semibold text-[#0f3d2e] truncate">Approval details</div>
          <div className="text-[14px] text-[#5a8a76] mt-0.5 truncate">
            {applicantName}
            {details.approved_by && (
              <> · approved by <span className="font-semibold text-[#178a5c]">{LENDER_LABEL[String(details.approved_by)] ?? details.approved_by}</span></>
            )}
          </div>
        </div>

        <SectionCard title="Approval details" accent="green" icon={I.money}>
          <ApprovalDetailsTable value={details} onChange={setDetails} />
          <p className="text-[12px] text-[#5a8a76] mt-3">
            Saved once — these values become read-only on the profile afterwards.
          </p>
        </SectionCard>

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
