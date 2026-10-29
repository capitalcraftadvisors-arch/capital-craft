"use client";

// Loan Application — approval details screen (Pendings / deep links).
//
// The lender arrives as ?lender=<key>; ?edit=approval edits saved details. The
// form itself is the shared LoanApprovalForm — the same one the loan profile's
// "Approved" stage shows.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import LoanApprovalForm from "@/components/LoanApprovalForm";
import { useLenders } from "@/lib/lenders";
import { lenderLabelIn } from "@/lib/loan-lenders";

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
  const lenders = useLenders();
  const lender = search.get("lender") ?? "";
  const editMode = search.get("edit") as "approval" | "sanction" | null;

  const [loan, setLoan] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().from("epc_applications").select("*").eq("id", params.id).maybeSingle();
      setLoan(data);
      setLoading(false);
    })();
  }, [params.id]);

  const applicantName = useMemo(
    () => loan?.aadhaar_name || loan?.borrower_name || "(unnamed applicant)",
    [loan],
  );
  const back = () => router.push((search.get("from") === "pendings" ? "/admin/pendings" : `/admin/app/${params.id}/view`) as any);

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-[#5a8a76]">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Loan application not found.</p></main>;
  }
  const lenderKey = lender || loan.approved_lender || "";

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/capital-craft.png" alt="Capital Craft" className="h-7 w-auto object-contain" />
        </div>
      </header>

      <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 py-8" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>
        <div className="mb-2">
          <div className="text-[24px] font-semibold text-[#0f3d2e] truncate">
            {editMode === "approval" ? "Edit approval details" : "Approval details"}
          </div>
          <div className="text-[14px] text-[#5a8a76] mt-0.5 truncate">
            {applicantName}
            {lenderKey && (
              <> · approved by <span className="font-semibold text-[#178a5c]">{search.get("label") || lenderLabelIn(lenders, lenderKey)}</span></>
            )}
          </div>
        </div>
        <LoanApprovalForm
          loan={loan}
          lender={lender}
          lenderLabel={search.get("label")}
          editMode={editMode}
          onSaved={back}
          onCancel={back}
        />
      </div>
    </main>
  );
}
