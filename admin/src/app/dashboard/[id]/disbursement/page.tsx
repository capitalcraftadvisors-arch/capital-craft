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
//
// Send (0138): once all 5 are in, the EPC sends them to Capital Craft and they
// LOCK — like a submitted loan application. The team reopens chosen documents
// with Message to EPC; the EPC replaces them and sends again (locked again).

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notify";
import CompletionDocsSection from "@/components/CompletionDocsSection";
import { I, SectionCard, KV, Pill } from "@/components/view/ViewKit";
import {
  deadlineState, DEADLINE_PILL, remainingAmount, firstCharges,
  DISBURSEMENT_WINDOW_DAYS, tranche2Lock,
} from "@/lib/disbursement";
import { fmtRupeesExact } from "@/lib/money";
import { fmtDate } from "@/lib/dates";

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
  const [sending, setSending] = useState(false);

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
    return <main className="min-h-screen grid place-items-center"><p className="text-cc-muted">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Application not found.</p></main>;
  }

  const dl = deadlineState(loan.first_disbursement_date, loan.second_disbursement_amount != null);
  const sanctioned = loan.sanctioned_amount != null ? Number(loan.sanctioned_amount) : null;
  const firstSaved = loan.first_disbursement_amount != null;
  const remaining = remainingAmount(sanctioned, loan.first_disbursement_amount, firstCharges(loan));
  const allDocsIn = docsUploaded >= docsTotal;
  const { locked, reopened } = tranche2Lock(loan);
  const sentLocked = locked && reopened.length === 0;

  // Send the 2nd-tranche documents → locked (the DB stamps the time). After a
  // reopening it also answers the team's message, as an application re-submit does.
  async function sendDocs() {
    if (!loan || sending) return;
    setSending(true);
    const now = new Date().toISOString();
    const { data, error } = await supabase().from("epc_applications").update({
      tranche2_submitted_at: now,
      tranche2_allow: [],
      ...(loan.attention_status === "open" ? {
        attention_status: "resolved", attention_resolved_at: now, attention_resolved_by: "epc", epc_last_activity_at: now,
      } : {}),
    }).eq("id", loan.id).select("*").maybeSingle();
    setSending(false);
    if (error || !data) { notify.error("Couldn't send — please try again."); return; }
    setLoan(data);
    notify.success("Sent to Capital Craft.");
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-cc-line bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-[14px] text-cc-muted hover:text-cc-ink inline-flex items-center gap-1"
          >
            ← Back
          </button>
          <span className="font-display font-bold text-[18px] text-cc-ink">Capital Craft</span>
        </div>
      </header>

      <div className="w-full max-w-4xl mx-auto px-5 sm:px-8 py-6" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>

        {/* Header — what they got, what's left, how long they have. */}
        <div className="rounded-[12px] border border-cc-line bg-cc-wash p-5 sm:p-6 mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-[24px] font-semibold text-cc-ink truncate">{applicantName}</div>
              <div className="flex gap-2 items-center flex-wrap mt-3">
                <Pill tint="blue" icon={I.id}>{loan.loan_display_id ?? loan.id.slice(0, 8).toUpperCase()}</Pill>
                <Pill tint="amber">Approved by lender</Pill>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[11px] font-semibold text-cc-muted uppercase tracking-wider mb-1">Sanctioned</div>
              <div className="text-[26px] font-bold text-cc-green leading-none">{fmtRupeesExact(sanctioned)}</div>
              <div className={["inline-block mt-3 px-3 py-1.5 rounded-[8px] text-[13px] font-semibold", DEADLINE_PILL[dl.tone]].join(" ")}>
                {dl.label}
              </div>
              {dl.started && (
                <div className="text-[11px] text-cc-muted mt-1">Deadline {fmtDate(loan.disbursement_deadline)}</div>
              )}
            </div>
          </div>
        </div>

        {/* The deadline, said plainly — gone once the 2nd tranche is paid. */}
        {!dl.done && <div
          className={[
            "rounded-[12px] border p-4 sm:p-5 mb-4 text-[13px]",
            dl.overdue ? "border-red-200 bg-red-50 text-red-800" : "border-cc-blue-line bg-[#f4fafe] text-cc-ink",
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
        </div>}

        <div className="space-y-4">
          <SectionCard title="Disbursement" accent="green" icon={I.money}>
            <KV k="Sanctioned amount" v={fmtRupeesExact(sanctioned)} />
            <KV
              k="First disbursement (received)"
              v={firstSaved ? `${fmtRupeesExact(loan.first_disbursement_amount)} · ${fmtDate(loan.first_disbursement_date)}` : "Not released yet"}
              valueClass={firstSaved ? "text-cc-green" : undefined}
            />
            <KV k="Remaining (pending)" v={firstSaved ? fmtRupeesExact(remaining) : "—"} />
            <KV
              k="Second disbursement"
              v={loan.second_disbursement_amount != null
                ? `${fmtRupeesExact(loan.second_disbursement_amount)} · ${fmtDate(loan.second_disbursement_date)}`
                : "After work completion & review"}
              valueClass={loan.second_disbursement_amount != null ? "text-cc-green" : undefined}
            />
            {loan.completion_docs_status && (
              <KV k="Document review" v={String(loan.completion_docs_status)[0].toUpperCase() + String(loan.completion_docs_status).slice(1)} />
            )}
          </SectionCard>

          <SectionCard title={`Completion documents (${docsUploaded}/${docsTotal})`} accent="blue" icon={I.files}>
            <p className="text-[13px] text-cc-muted mb-4">
              Upload all {docsTotal}, then send them to Capital Craft.
            </p>
            <CompletionDocsSection
              applicationId={loan.id}
              uploadedBy="epc"
              locked={locked}
              reopened={reopened}
              onCountChange={(u, t) => { setDocsUploaded(u); setDocsTotal(t); }}
            />
            <div className="mt-4">
              {sentLocked ? (
                <p className="inline-flex items-center gap-1.5 text-[13px] text-cc-green font-medium">
                  {I.lock} Sent to Capital Craft · {fmtDate(loan.tranche2_submitted_at)} — our team will review them shortly.
                </p>
              ) : (
                <button type="button" onClick={() => void sendDocs()} disabled={!allDocsIn || sending}
                  title={allDocsIn ? undefined : `Upload all ${docsTotal} first`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-[13px] font-semibold bg-cc-green text-white hover:bg-cc-green-hover disabled:opacity-50">
                  {I.send} {sending ? "Sending…" : locked ? "Send again" : "Send to Capital Craft"}
                </button>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </main>
  );
}
