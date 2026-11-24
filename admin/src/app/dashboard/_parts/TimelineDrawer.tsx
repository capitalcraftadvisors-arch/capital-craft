"use client";

// Partner dashboard · the per-application timeline drawer.

import Modal from "@/components/ui/Modal";
import { NAVY_ACCENT } from "@/components/partner/PartnerShell";
import { fmtRupees } from "@/lib/money";
import { STAGE4_LABEL, STAGE4_PILL, appliedAmount, borrower, canEpcEdit, capacity, fmtDateTimeOrBlank, stage4, type AppRow } from "./rows";

// ── Per-application timeline drawer ─────────────────────────────────────────────
export default function TimelineDrawer({ row, onClose, onEdit, onTranche, onMessage, readOnly }: {
  row: AppRow; onClose: () => void; onEdit: () => void; onTranche: () => void; onMessage: () => void; readOnly: boolean;
}) {
  const stg = stage4(row);
  const rejected = stg === "rejected";
  type Step = { label: string; at: string | null; note?: string; amount?: number | null };
  const steps: Step[] = [
    { label: "Submitted", at: row.submitted_at ?? row.created_at },
    { label: "Under review", at: row.submitted_at ?? row.created_at, note: "Our team is reviewing the file" },
    { label: "Documents verified", at: row.docs_sent_at ?? row.reviewed_at },
    { label: "Sanctioned", at: row.approved_at, amount: row.sanctioned_amount },
    { label: "1st disbursement", at: row.first_disbursement_date, amount: row.first_disbursement_amount },
    { label: "2nd disbursement", at: row.second_disbursement_date, amount: row.second_disbursement_amount },
  ];
  const firstPendingIdx = steps.findIndex((s) => !s.at);
  return (
    <Modal onClose={onClose} overlayClassName="fixed inset-0 z-50 flex justify-end" backdropClassName="absolute inset-0 bg-black/30" as="aside" className="relative w-full max-w-[440px] h-full bg-white shadow-2xl overflow-y-auto">
      <div className="sticky top-0 bg-white border-b border-line px-5 py-4 flex items-start justify-between gap-3">
        <div><div className="font-display text-[18px] font-bold text-[#0f3d2e]">{borrower(row)}</div>
          <div className="text-[11px] font-mono text-[#185fa5]">{row.loan_display_id ?? row.id.slice(0, 8).toUpperCase()}</div></div>
        <button onClick={onClose} className="text-text-muted hover:text-text text-[20px] leading-none">✕</button>
      </div>

      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-4">
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STAGE4_PILL[stg]}`}>{STAGE4_LABEL[stg]}</span>
          <span className="text-[12px] text-text-mid">{appliedAmount(row)} applied · {capacity(row)}</span>
        </div>

        {/* Timeline */}
        <div className="flex flex-col">
          {steps.map((s, i) => {
            const done = !!s.at;
            const current = !rejected && i === firstPendingIdx;
            const showLine = i < steps.length - 1;
            const stop = rejected && !done; // stop drawing active steps past the rejection
            return (
              <div key={s.label} className={["flex gap-3", stop ? "opacity-40" : ""].join(" ")}>
                <div className="flex flex-col items-center">
                  <div className={["w-6 h-6 rounded-full grid place-items-center shrink-0",
                    done ? "bg-[#178a5c] text-white" : current ? "text-white" : "border-2 border-line text-text-muted"].join(" ")}
                    style={current ? { background: NAVY_ACCENT } : undefined}>
                    {done ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : current ? <span className="w-2 h-2 rounded-full bg-white" /> : <span className="w-1.5 h-1.5 rounded-full bg-line" />}
                  </div>
                  {showLine && <div className="w-0.5 flex-1 min-h-[26px]" style={{ background: done ? "#178a5c" : "#e5e7eb" }} />}
                </div>
                <div className="pb-4">
                  <div className={["text-[13.5px]", done || current ? "font-semibold text-text" : "text-text-muted"].join(" ")}>{s.label}{current ? " — in progress" : ""}</div>
                  {s.at && <div className="text-[11px] text-text-muted mt-0.5">{fmtDateTimeOrBlank(s.at)}{s.amount != null ? ` · ${fmtRupees(s.amount)}` : ""}</div>}
                  {!s.at && current && s.note && <div className="text-[11px] text-text-muted mt-0.5">{s.note}</div>}
                </div>
              </div>
            );
          })}
          {rejected && (
            <div className="flex gap-3">
              <div className="flex flex-col items-center"><div className="w-6 h-6 rounded-full bg-red-600 text-white grid place-items-center shrink-0"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg></div></div>
              <div className="pb-2">
                <div className="text-[13.5px] font-semibold text-red-700">Rejected</div>
                {row.rejected_at && <div className="text-[11px] text-text-muted mt-0.5">{fmtDateTimeOrBlank(row.rejected_at)}</div>}
                {row.rejection_reason && <div className="text-[12px] text-red-700 mt-1.5 bg-red-50 border border-red-100 rounded-lg px-3 py-2">Reason: {row.rejection_reason}</div>}
                <div className="text-[12px] text-text-mid mt-2">Please review the file and re-submit with the corrections.</div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {readOnly ? null : stg === "approved" ? (
            <button onClick={onTranche} className="flex-1 px-4 py-2.5 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY_ACCENT }}>Upload 2nd tranche</button>
          ) : canEpcEdit(row) ? (
            stg !== "rejected" ? (
              <button onClick={onEdit} className="flex-1 px-4 py-2.5 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY_ACCENT }}>Edit application</button>
            ) : (
              <button onClick={onEdit} className="flex-1 px-4 py-2.5 rounded-xl border border-[#1e3a8a] text-[#1e3a8a] text-[13px] font-semibold">Re-submit</button>
            )
          ) : (
            <div className="flex-1 px-4 py-2.5 rounded-xl border border-line text-text-muted text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 select-none">
              Awaiting review
            </div>
          )}
          {row.attention_status === "open" && <button onClick={onMessage} className="px-4 py-2.5 rounded-xl border border-line text-[13px] font-semibold text-text-mid">Open message</button>}
        </div>
      </div>
    </Modal>
  );
}
