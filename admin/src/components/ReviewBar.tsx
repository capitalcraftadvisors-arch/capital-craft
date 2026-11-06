"use client";

// The admin's check on one stage — approval details, 1st or 2nd disbursement
// (lib/review). Everyone sees where it stands:
//   🔒 Waiting for admin check · ✓ Approved by Admin · ↩ Sent back by Admin — reason
// and the MAIN ADMIN gets the decisions right there: Approve, Send back (with a
// reason), Edit, and Undo for a decision already taken.
// Used on each stage of the loan profile, the disbursement page and Pendings.

import { useState } from "react";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { approveReview, sendBackReview, undoReview, reviewState, type ReviewItem } from "@/lib/review";
import { HAction, I } from "@/components/view/ViewKit";

type Loan = Record<string, any>;

const UNDO = (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>);

export default function ReviewBar({ loan, item, onDecided, onEdit, compact }: {
  loan: Loan;
  item: ReviewItem;
  /** The columns the decision wrote — merge them into the row on screen. */
  onDecided: (patch: Record<string, string | null>) => void;
  /** Main admin: open the saved details for editing (omit when already editing). */
  onEdit?: () => void;
  /** Pendings table: buttons only, no status line. */
  compact?: boolean;
}) {
  const admin = isMainAdmin(getBusiness());
  const state = reviewState(loan, item);
  const note = (loan[`${item}_review_note`] as string | null) ?? null;
  const when = loan[`${item}_reviewed_at`] ? fmtDate(loan[`${item}_reviewed_at`]) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backOpen, setBackOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!state) return null;

  async function run(fn: () => Promise<Record<string, string | null>>) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      onDecided(await fn());
      setBackOpen(false); setReason("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const approve = () => void run(() => approveReview(loan.id, item));
  const sendBack = () => { if (reason.trim()) void run(() => sendBackReview(loan.id, item, reason)); };
  const undo = () => {
    if (!window.confirm("Undo the admin's decision? It goes back to waiting for the check.")) return;
    void run(() => undoReview(loan.id, item));
  };

  const tone =
    state === "approved"  ? { box: "border-[#cdeadd] bg-[#f0faf5] text-[#178a5c]", icon: I.checkCircle, text: "Approved by Admin" } :
    state === "sent_back" ? { box: "border-red-200 bg-red-50 text-red-700", icon: UNDO, text: "Sent back by Admin" } :
                            { box: "border-[#f3d9a4] bg-[#fef8ee] text-[#854f0b]", icon: I.lock, text: admin ? "Waiting for your check" : "Waiting for admin check" };

  const actions = admin && (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {state === "pending" ? (
        <>
          <HAction variant="reject" disabled={busy} onClick={() => setBackOpen((o) => !o)}>Send back</HAction>
          {onEdit && <HAction variant="outline" icon={I.edit} disabled={busy} onClick={onEdit}>Edit</HAction>}
          <HAction variant="primary" icon={I.check} disabled={busy} onClick={approve}>{busy ? "Saving…" : "Approve"}</HAction>
        </>
      ) : (
        <>
          {onEdit && <HAction variant="outline" icon={I.edit} disabled={busy} onClick={onEdit}>Edit</HAction>}
          <HAction variant="ghost" icon={UNDO} disabled={busy} onClick={undo}>{busy ? "Saving…" : "Undo"}</HAction>
        </>
      )}
    </div>
  );

  const backForm = backOpen && (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") sendBack(); }}
        placeholder="Reason"
        className="flex-1 min-w-[220px] border border-red-200 rounded-[8px] px-3 py-2 text-[13px] outline-none focus:border-red-400 bg-white text-[#0f3d2e]"
      />
      <HAction variant="reject" disabled={busy || !reason.trim()} onClick={sendBack}>{busy ? "Saving…" : "Send back"}</HAction>
      <HAction variant="ghost" disabled={busy} onClick={() => { setBackOpen(false); setReason(""); }}>Cancel</HAction>
    </div>
  );

  if (compact) {
    return (
      <div>
        {state === "pending" ? actions : (
          <div className="flex items-center gap-2 justify-end">
            <span className={["inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-[8px] border", tone.box].join(" ")}>
              <span className="inline-flex">{tone.icon}</span>{tone.text}
            </span>
            {actions}
          </div>
        )}
        {backForm}
        {error && <p className="text-[12px] text-red-600 mt-1.5 text-right">{error}</p>}
      </div>
    );
  }

  return (
    <div className={["mt-5 rounded-[10px] border px-4 py-3", tone.box].join(" ")}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <span className="inline-flex shrink-0">{tone.icon}</span>
            {tone.text}
            {state !== "pending" && when && <span className="font-normal opacity-80">· {when}</span>}
          </div>
          {state === "sent_back" && note && <p className="text-[13px] mt-1 text-[#0f3d2e]">{note}</p>}
          {state === "pending" && admin && note && (
            <p className="text-[12px] mt-1 text-[#5a8a76]">Sent back earlier: {note}</p>
          )}
        </div>
        {actions}
      </div>
      {backForm}
      {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}
    </div>
  );
}
