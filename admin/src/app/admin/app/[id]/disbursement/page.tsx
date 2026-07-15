"use client";

// Loan Application — DISBURSEMENT screen (admin).
//
// Reached from the "Disbursement" button on an approved row. Header carries
// the 45-day countdown + sanctioned amount + a short profile overview, then
// three tabs:
//   1. Disbursement details — 1st amount (starts the 45-day clock), remaining,
//      the 3 completion docs, admin review, then the 2nd amount.
//   2. View profile         — routes to the EXISTING loan View, untouched.
//   3. Activity log         — opens the EXISTING LoanActivityLogModal, untouched.
//
// Only admins reach this page (AuthGuard) AND only admins can write the
// amounts — migration 0044's trg_disbursement_admin_only enforces that at the
// DB level, so the EPC's read-only view can't be bypassed via the API.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getBusiness } from "@/lib/auth";
import { logLoanActivity } from "@/lib/loanAudit";
import CompletionDocsSection from "@/components/CompletionDocsSection";
import LoanActivityLogModal from "@/components/LoanActivityLogModal";
import { I, SectionCard, KV, Pill, StatusBtn } from "@/components/view/ViewKit";
import {
  deadlineState, DEADLINE_PILL, remainingAmount, fmtRupees, fmtDateShort,
  DISBURSEMENT_WINDOW_DAYS,
} from "@/lib/disbursement";

type Loan = Record<string, any>;
type Tab = "disbursement" | "activity";

// Local calendar date as YYYY-MM-DD (never toISOString — that shifts IST back a day).
function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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
  const [tab, setTab] = useState<Tab>("disbursement");
  const [activityOpen, setActivityOpen] = useState(false);

  const [firstAmt, setFirstAmt]   = useState("");
  const [firstDate, setFirstDate] = useState(todayISO());
  const [secondAmt, setSecondAmt]   = useState("");
  const [secondDate, setSecondDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docsUploaded, setDocsUploaded] = useState(0);
  const [docsTotal, setDocsTotal] = useState(3);

  async function load() {
    const { data } = await supabase()
      .from("epc_applications")
      .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
      .eq("id", params.id)
      .maybeSingle();
    setLoan(data);
    if (data) {
      if (data.first_disbursement_amount != null) setFirstAmt(String(data.first_disbursement_amount));
      if (data.first_disbursement_date) setFirstDate(String(data.first_disbursement_date).slice(0, 10));
      if (data.second_disbursement_amount != null) setSecondAmt(String(data.second_disbursement_amount));
      if (data.second_disbursement_date) setSecondDate(String(data.second_disbursement_date).slice(0, 10));
    }
    setLoading(false);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

  const applicantName = useMemo(
    () => loan?.borrower_name || loan?.aadhaar_name || "(unnamed applicant)",
    [loan],
  );
  const epcName = useMemo(() => {
    if (!loan?.epc_business) return "—";
    return loan.epc_business.trade_name || loan.epc_business.legal_name || loan.epc_business.contact_name || "—";
  }, [loan]);

  async function saveFirst() {
    if (!loan || busy) return;
    const amt = Number(firstAmt);
    if (!Number.isFinite(amt) || amt <= 0) { setError("Enter a valid first disbursement amount."); return; }
    const sanctioned = Number(loan.sanctioned_amount ?? 0);
    if (sanctioned > 0 && amt > sanctioned) {
      const ok = window.confirm(
        `The first disbursement (${fmtRupees(amt)}) is MORE than the sanctioned amount (${fmtRupees(sanctioned)}).\n\nAre you sure?`,
      );
      if (!ok) return;
    }
    setBusy(true); setError(null); setMsg(null);
    const { error: e } = await supabase()
      .from("epc_applications")
      .update({ first_disbursement_amount: amt, first_disbursement_date: firstDate })
      .eq("id", loan.id);
    if (e) { setError("Couldn't save — " + e.message); setBusy(false); return; }
    await logLoanActivity(loan.id, "status_change", {
      detail: `First disbursement ${fmtRupees(amt)} on ${fmtDateShort(firstDate)} — 45-day clock started`,
    });
    setMsg("First disbursement saved — the 45-day clock has started.");
    await load();
    setBusy(false);
  }

  async function saveReview(next: "approved" | "rejected") {
    if (!loan || busy) return;
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
    await load();
    setBusy(false);
  }

  async function saveSecond() {
    if (!loan || busy) return;
    const amt = Number(secondAmt);
    if (!Number.isFinite(amt) || amt <= 0) { setError("Enter a valid second disbursement amount."); return; }
    setBusy(true); setError(null); setMsg(null);
    const { error: e } = await supabase()
      .from("epc_applications")
      .update({ second_disbursement_amount: amt, second_disbursement_date: secondDate })
      .eq("id", loan.id);
    if (e) { setError("Couldn't save — " + e.message); setBusy(false); return; }
    await logLoanActivity(loan.id, "status_change", {
      detail: `Second disbursement ${fmtRupees(amt)} on ${fmtDateShort(secondDate)}`,
    });
    setMsg("Second disbursement saved.");
    await load();
    setBusy(false);
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-[#5a8a76]">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Loan application not found.</p></main>;
  }

  const dl = deadlineState(loan.first_disbursement_date);
  const sanctioned = loan.sanctioned_amount != null ? Number(loan.sanctioned_amount) : null;
  const firstSaved = loan.first_disbursement_amount != null;
  const remaining = remainingAmount(sanctioned, loan.first_disbursement_amount);
  const reviewState: string | null = loan.completion_docs_status ?? null;
  const allDocsIn = docsUploaded >= docsTotal;
  const secondUnlocked = reviewState === "approved";

  const inputCls =
    "w-full border border-[#cdeadd] rounded-[8px] px-3 py-2.5 text-[14px] " +
    "focus:border-[#185fa5] outline-none bg-white";

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button
            onClick={() => router.push("/admin")}
            className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1"
          >
            ← Back
          </button>
          <span className="font-display font-bold text-[18px] text-[#0f3d2e]">Capital Craft</span>
        </div>
      </header>

      <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 py-6" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>

        {/* ── HEADER — days left, sanctioned, overview ─────────── */}
        <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-5 sm:p-6 mb-4">
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
              <div className="text-[26px] font-bold text-[#178a5c] leading-none">{fmtRupees(sanctioned)}</div>
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

        {/* ── TABS ─────────────────────────────────────────────── */}
        <div className="flex gap-2 mb-4 border-b border-[#cdeadd]">
          <TabBtn active={tab === "disbursement"} onClick={() => setTab("disbursement")}>Disbursement details</TabBtn>
          {/* Leads to the EXISTING View profile — deliberately unchanged. */}
          <TabBtn active={false} onClick={() => router.push(`/admin/app/${loan.id}/view` as any)}>View profile</TabBtn>
          {/* Opens the EXISTING activity log modal — deliberately unchanged. */}
          <TabBtn active={false} onClick={() => setActivityOpen(true)}>Activity log</TabBtn>
        </div>

        {tab === "disbursement" && (
          <div className="space-y-4">
            {/* 1st disbursement */}
            <SectionCard title="First disbursement" accent="green" icon={I.money}>
              {firstSaved ? (
                <>
                  <KV k="Amount" v={fmtRupees(loan.first_disbursement_amount)} valueClass="text-[#178a5c]" />
                  <KV k="Date" v={fmtDateShort(loan.first_disbursement_date)} />
                  <KV k="Deadline (45 days)" v={fmtDateShort(loan.disbursement_deadline)} />
                  <KV k="Remaining (pending)" v={fmtRupees(remaining)} />
                </>
              ) : (
                <>
                  <p className="text-[13px] text-[#5a8a76] mb-3">
                    Entering the first disbursement starts the {DISBURSEMENT_WINDOW_DAYS}-day completion clock from the date below.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-[12px] text-[#5a8a76] mb-1">First disbursement amount</p>
                      <input type="text" inputMode="decimal" className={inputCls} placeholder="0"
                        value={firstAmt} onChange={(e) => setFirstAmt(e.target.value.replace(/[^\d.]/g, ""))} />
                    </div>
                    <div>
                      <p className="text-[12px] text-[#5a8a76] mb-1">Date</p>
                      <input type="date" className={inputCls} value={firstDate} onChange={(e) => setFirstDate(e.target.value)} />
                    </div>
                  </div>
                  {sanctioned != null && firstAmt && Number(firstAmt) > 0 && (
                    <p className="text-[12px] text-[#5a8a76] mt-2">
                      Remaining after this: <span className="font-semibold text-[#0f3d2e]">{fmtRupees(remainingAmount(sanctioned, Number(firstAmt)))}</span>
                    </p>
                  )}
                  <div className="mt-4">
                    <button type="button" onClick={() => void saveFirst()} disabled={busy}
                      className="px-4 py-2 bg-[#178a5c] text-white rounded text-[13px] font-semibold hover:bg-[#12734c] disabled:opacity-60">
                      {busy ? "Saving…" : "Save first disbursement"}
                    </button>
                  </div>
                </>
              )}
            </SectionCard>

            {/* Completion docs — only meaningful once the clock is running. */}
            <SectionCard title={`Completion documents (${docsUploaded}/${docsTotal})`} accent="blue" icon={I.files}>
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
                    onCountChange={(u, t) => { setDocsUploaded(u); setDocsTotal(t); }}
                  />
                </>
              )}
            </SectionCard>

            {/* Admin review — gate for the 2nd disbursement. */}
            {firstSaved && (
              <SectionCard title="Review" accent="blue" icon={I.lock} adminOnly>
                <KV k="Status" v={reviewState ? reviewState[0].toUpperCase() + reviewState.slice(1) : "Not reviewed"} />
                {loan.completion_reviewed_at && (
                  <KV k="Reviewed" v={`${fmtDateShort(loan.completion_reviewed_at)}${loan.completion_reviewed_by ? ` · ${loan.completion_reviewed_by}` : ""}`} />
                )}
                {!allDocsIn && reviewState !== "approved" && (
                  <p className="text-[12px] text-[#854f0b] mt-2">
                    All {docsTotal} completion documents must be uploaded before review.
                  </p>
                )}
                <div className="flex gap-2 mt-3">
                  <StatusBtn kind="approve" busy={busy || !allDocsIn} onClick={() => void saveReview("approved")}>
                    Approve documents
                  </StatusBtn>
                  <StatusBtn kind="danger" busy={busy || !allDocsIn} onClick={() => void saveReview("rejected")}>
                    Reject
                  </StatusBtn>
                </div>
              </SectionCard>
            )}

            {/* 2nd disbursement — unlocked by an approved review. */}
            {firstSaved && (
              <SectionCard title="Second disbursement" accent="green" icon={I.money}>
                {loan.second_disbursement_amount != null ? (
                  <>
                    <KV k="Amount" v={fmtRupees(loan.second_disbursement_amount)} valueClass="text-[#178a5c]" />
                    <KV k="Date" v={fmtDateShort(loan.second_disbursement_date)} />
                  </>
                ) : !secondUnlocked ? (
                  <p className="text-[13px] text-[#5a8a76]">
                    Available once the completion documents are reviewed and approved above.
                  </p>
                ) : (
                  <>
                    <p className="text-[13px] text-[#5a8a76] mb-3">
                      Pending after the first disbursement: <span className="font-semibold text-[#0f3d2e]">{fmtRupees(remaining)}</span>
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <p className="text-[12px] text-[#5a8a76] mb-1">Second disbursement amount</p>
                        <input type="text" inputMode="decimal" className={inputCls} placeholder="0"
                          value={secondAmt} onChange={(e) => setSecondAmt(e.target.value.replace(/[^\d.]/g, ""))} />
                      </div>
                      <div>
                        <p className="text-[12px] text-[#5a8a76] mb-1">Date</p>
                        <input type="date" className={inputCls} value={secondDate} onChange={(e) => setSecondDate(e.target.value)} />
                      </div>
                    </div>
                    <div className="mt-4">
                      <button type="button" onClick={() => void saveSecond()} disabled={busy}
                        className="px-4 py-2 bg-[#178a5c] text-white rounded text-[13px] font-semibold hover:bg-[#12734c] disabled:opacity-60">
                        {busy ? "Saving…" : "Save second disbursement"}
                      </button>
                    </div>
                  </>
                )}
              </SectionCard>
            )}

            {msg && <p className="text-[13px] text-[#178a5c]">{msg}</p>}
            {error && <p className="text-[13px] text-red-600">{error}</p>}
          </div>
        )}
      </div>

      <LoanActivityLogModal
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        loan={loan}
        borrowerName={applicantName}
      />
    </main>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-4 py-2.5 text-[14px] font-semibold border-b-2 -mb-px transition-colors",
        active
          ? "border-[#178a5c] text-[#178a5c]"
          : "border-transparent text-[#5a8a76] hover:text-[#0f3d2e]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
