"use client";

// Activity log modal for a LOAN APPLICATION — the loan-side twin of
// ActivityLogModal. Same modal shell, same row styling, same "single button →
// modal" behaviour as the EPC View.
//
// Source: loan applications have no admin_edit_log rows (that table is keyed
// to epc_business). Instead we build the timeline from what the loan row
// already records:
//   - epc_applications.status_history (jsonb) — every status transition,
//     {from, to, by, at, note}, written on each status change.
//   - the per-step completion timestamps stamped by the step routes.
// Merged and sorted newest-first. No migration needed.

import React from "react";

type StatusEntry = { from?: string; to?: string; by?: string; at?: string; note?: string };

type Props = {
  open: boolean;
  onClose: () => void;
  loan: Record<string, any> | null;
  borrowerName?: string | null;
};

const SVG_PROPS = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const I_CHECK_CIRC = (<svg {...SVG_PROPS}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>);
const I_X_CIRC     = (<svg {...SVG_PROPS}><circle cx="12" cy="12" r="10" /><path d="m9 9 6 6M15 9l-6 6" /></svg>);
const I_TARGET     = (<svg {...SVG_PROPS}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>);
const I_SEND       = (<svg {...SVG_PROPS}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>);
const I_STEP       = (<svg {...SVG_PROPS}><path d="M20 6 9 17l-5-5" /></svg>);

const GREEN = "text-[#178a5c]";
const BLUE  = "text-[#185fa5]";
const AMBER = "text-[#854f0b]";
const RED   = "text-red-600";

const STATUS_LABEL: Record<string, string> = {
  draft:        "Draft",
  under_review: "Under Review",
  approved:     "Approved by lender",
  rejected:     "Rejected by lender",
  submitted:    "Submitted",
};
const label = (s?: string | null) => (s ? STATUS_LABEL[s] ?? s.replace(/_/g, " ") : "—");

type Ev = { at: string; text: string; by?: string | null; note?: string | null; tone: string; svg: React.ReactNode };

function fmtDate(v: string): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Per-step completion stamps → one event each.
const STEP_EVENTS: { col: string; text: string }[] = [
  { col: "consent_at",         text: "Step 1 completed — applicant details & consent" },
  { col: "kyc_extracted_at",   text: "Step 2 completed — Aadhaar KYC" },
  { col: "step3_completed_at", text: "Step 3 completed — loan requirements" },
  { col: "step4_completed_at", text: "Step 4 completed — personal details & bank" },
  { col: "step5_completed_at", text: "Step 5 completed — loan offer selected" },
];

function buildEvents(loan: Record<string, any>): Ev[] {
  const out: Ev[] = [];

  for (const s of STEP_EVENTS) {
    const at = loan[s.col];
    if (typeof at === "string" && at) {
      out.push({ at, text: s.text, tone: GREEN, svg: I_STEP });
    }
  }

  if (typeof loan.submitted_at === "string" && loan.submitted_at) {
    out.push({ at: loan.submitted_at, text: "Application submitted", tone: BLUE, svg: I_SEND });
  }

  const hist: StatusEntry[] = Array.isArray(loan.status_history) ? loan.status_history : [];
  for (const h of hist) {
    if (!h?.at) continue;
    const tone =
      h.to === "approved" ? GREEN :
      h.to === "rejected" ? RED :
      h.to === "under_review" ? AMBER : BLUE;
    const svg =
      h.to === "approved" ? I_CHECK_CIRC :
      h.to === "rejected" ? I_X_CIRC : I_TARGET;
    out.push({
      at: h.at,
      text: `Status changed — ${label(h.from)} → ${label(h.to)}`,
      by: h.by ?? null,
      note: h.note || null,
      tone,
      svg,
    });
  }

  // Newest first.
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export default function LoanActivityLogModal({ open, onClose, loan, borrowerName }: Props) {
  if (!open) return null;
  const events = loan ? buildEvents(loan) : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white rounded-lg shadow-lg flex flex-col max-h-[90vh]"
      >
        <div className="p-5 border-b border-line flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-[18px] text-text truncate">
              Activity log{borrowerName ? ` — ${borrowerName}` : ""}
            </h3>
            <p className="text-[12px] text-text-mid mt-0.5">
              Chronological — step completions, submission, and every status change.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[20px] text-text-muted hover:text-text leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {events.length === 0 ? (
            <p className="text-[13px] text-[#5a8a76]">No activity recorded yet.</p>
          ) : (
            <ol className="space-y-2">
              {events.map((e, i) => (
                <li
                  key={`${e.at}-${i}`}
                  className="border-l-4 border-[#cdeadd] pl-4 py-2 bg-[#f7fcfa] rounded-r-[8px]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className={["shrink-0 mt-0.5", e.tone].join(" ")}>{e.svg}</span>
                      <p className="text-[14px] text-[#0f3d2e]">{e.text}</p>
                    </div>
                    <span className="text-[11px] text-[#5a8a76] shrink-0">{fmtDate(e.at)}</span>
                  </div>
                  {e.by && (
                    <p className="text-[12px] text-[#5a8a76] mt-0.5 pl-[26px]">by {e.by}</p>
                  )}
                  {e.note && (
                    <p className="text-[12px] text-[#5a8a76] mt-0.5 pl-[26px] italic">“{e.note}”</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
