"use client";

// Loan Application — DISBURSEMENT screen (admin).
//
// Header carries the 45-day countdown + sanctioned amount + a short profile
// overview; below it the sanction letter and the shared LoanDisbursementPanel
// (1st tranche docs + 1st amount, completion docs + review + 2nd amount) — the
// same panel the loan profile's disbursement stages show.
//
// Only admins reach this page (AuthGuard) AND only admins can write the
// amounts — migration 0044's trg_disbursement_admin_only enforces that at the
// DB level, so the EPC's read-only view can't be bypassed via the API.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import FileUpload from "@/components/FileUpload";
import LoanDisbursementPanel from "@/components/LoanDisbursementPanel";
import { I, Pill, Section } from "@/components/view/ViewKit";
import { deadlineState, DEADLINE_PILL, fmtRupeesExact, fmtDateShort } from "@/lib/disbursement";

type Loan = Record<string, any>;

export default function LoanDisbursementPage() {
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

  async function load() {
    const { data } = await supabase()
      .from("epc_applications")
      .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
      .eq("id", params.id)
      .maybeSingle();
    setLoan(data);
    setLoading(false);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

  const applicantName = useMemo(
    () => loan?.aadhaar_name || loan?.borrower_name || "(unnamed applicant)",
    [loan],
  );
  const epcName = useMemo(() => {
    if (!loan?.epc_business) return "—";
    return loan.epc_business.trade_name || loan.epc_business.legal_name || loan.epc_business.contact_name || "—";
  }, [loan]);

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-[#5a8a76]">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Loan application not found.</p></main>;
  }

  const dl = deadlineState(loan.first_disbursement_date, loan.second_disbursement_amount != null);
  const sanctioned = loan.sanctioned_amount != null ? Number(loan.sanctioned_amount) : null;

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button
            onClick={() => router.push(`/admin/app/${loan.id}/view` as any)}
            className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1"
          >
            ← Back to application
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/capital-craft.png" alt="Capital Craft" className="h-7 w-auto object-contain" />
        </div>
      </header>

      <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 py-6" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>

        {/* ── HEADER — days left, sanctioned, overview ─────────── */}
        <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-5 sm:p-6 mb-2">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-[24px] font-semibold text-[#0f3d2e] truncate">{applicantName}</div>
              <div className="text-[14px] text-[#5a8a76] truncate mt-0.5">via {epcName}</div>
              <div className="flex gap-2 items-center flex-wrap mt-3">
                <Pill tint="blue" icon={I.id}>{loan.loan_display_id ?? loan.id.slice(0, 8).toUpperCase()}</Pill>
                {loan.plant_use_type && <Pill tint="blue">{String(loan.plant_use_type)[0].toUpperCase() + String(loan.plant_use_type).slice(1)}</Pill>}
                <Pill tint="amber">Approved by lender</Pill>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[11px] font-semibold text-[#5a8a76] uppercase tracking-wider mb-1">Sanctioned</div>
              <div className="text-[26px] font-bold text-[#178a5c] leading-none">{fmtRupeesExact(sanctioned)}</div>
              <div className={["inline-block mt-3 px-3 py-1.5 rounded-[8px] text-[13px] font-semibold", DEADLINE_PILL[dl.tone]].join(" ")}>
                {dl.label}
              </div>
              {dl.started && (
                <div className="text-[11px] text-[#5a8a76] mt-1">Deadline {fmtDateShort(loan.disbursement_deadline)}</div>
              )}
              {!dl.started && (
                <div className="text-[11px] text-[#5a8a76] mt-1">Starts on 1st disbursement</div>
              )}
            </div>
          </div>
        </div>

        {/* Sanction letter — the same slot as Approval details (view / delete /
            upload here too). Uploading it clears "not available at filling". */}
        <Section title="Sanction letter">
          <FileUpload
            applicationId={loan.id}
            category="sanction_letter"
            table="user_application_docs"
            uploadedBy="admin"
            maxFiles={1}
            uploadHint="PDF or image"
            onUploaded={() => {
              if (loan.sanction_letter_unavailable) {
                void supabase().from("epc_applications").update({ sanction_letter_unavailable: false }).eq("id", loan.id)
                  .then(() => setLoan((l) => (l ? { ...l, sanction_letter_unavailable: false } : l)));
              }
            }}
          />
        </Section>

        <LoanDisbursementPanel loan={loan} part="all" onChanged={load} />
      </div>
    </main>
  );
}
