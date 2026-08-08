"use client";

// Activity log modal for a LOAN APPLICATION — the loan-side twin of
// ActivityLogModal. Same modal shell, same row styling, same "single button →
// modal" behaviour as the EPC View.
//
// Sources, in priority order:
//   1. loan_activity_log (migration 0042) — the real append-only trail: every
//      step save, submission, approval, rejection, status change. This is the
//      loan's equivalent of admin_edit_log (which is keyed to epc_business and
//      so can't hold loan rows).
//   2. Legacy fill-in for applications that predate the log table:
//      - per-step completion timestamps on the row (only for steps with no
//        log row, so nothing double-counts)
//      - status_history (jsonb) — used ONLY when there are no log rows at all,
//        otherwise the log already covers those transitions.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type StatusEntry = { from?: string; to?: string; by?: string; at?: string; note?: string };

type LogRow = {
  id: string;
  actor: string;
  actor_name: string | null;
  action: string;
  step: number | null;
  detail: string | null;
  created_at: string;
};

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
const I_PENCIL     = (<svg {...SVG_PROPS}><path d="M17 3l4 4-13 13H4v-4z" /></svg>);

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

// What each step of the flow captures — used for both the log rows and the
// legacy timestamp fill-in.
const STEP_TITLE: Record<number, string> = {
  1: "applicant details & consent",
  2: "Aadhaar KYC",
  3: "loan requirements",
  4: "personal details & bank",
  5: "loan offer selected",
  6: "review & submit",
};

const STEP_STAMPS: { col: string; step: number }[] = [
  { col: "consent_at",         step: 1 },
  { col: "kyc_extracted_at",   step: 2 },
  { col: "step3_completed_at", step: 3 },
  { col: "step4_completed_at", step: 4 },
  { col: "step5_completed_at", step: 5 },
];

type Ev = { at: string; text: string; by?: string | null; note?: string | null; tone: string; svg: React.ReactNode };

function fmtDate(v: string): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function evFromLog(r: LogRow): Ev {
  // Admin actions always read as "Admin" (never the individual admin's name);
  // EPC actions keep the EPC's own name. This is consistent for every row —
  // client- and server-logged alike — regardless of any stored actor_name.
  const by = r.actor === "admin" ? "Admin" : (r.actor_name || "EPC");
  switch (r.action) {
    case "step_completed":
      return {
        at: r.created_at, by,
        text: `Step ${r.step ?? "?"} saved${r.step && STEP_TITLE[r.step] ? ` — ${STEP_TITLE[r.step]}` : ""}`,
        tone: GREEN, svg: I_STEP,
      };
    case "submitted":
      return { at: r.created_at, by, text: "Application submitted", tone: BLUE, svg: I_SEND };
    case "approved":
      return { at: r.created_at, by, text: r.detail || "Approved by lender", tone: GREEN, svg: I_CHECK_CIRC };
    case "rejected":
      return { at: r.created_at, by, text: r.detail || "Rejected by lender", tone: RED, svg: I_X_CIRC };
    case "field_edit":
      return { at: r.created_at, by, text: r.detail || "Details edited", tone: BLUE, svg: I_PENCIL };
    default:
      return { at: r.created_at, by, text: r.detail || `Status changed`, tone: AMBER, svg: I_TARGET };
  }
}

function buildEvents(loan: Record<string, any>, logs: LogRow[]): Ev[] {
  const out: Ev[] = logs.map(evFromLog);

  // ── Legacy fill-in for rows that predate loan_activity_log ──────────
  const loggedSteps = new Set(
    logs.filter((l) => l.action === "step_completed" && l.step != null).map((l) => l.step as number),
  );
  for (const s of STEP_STAMPS) {
    const at = loan[s.col];
    if (typeof at === "string" && at && !loggedSteps.has(s.step)) {
      out.push({ at, text: `Step ${s.step} completed — ${STEP_TITLE[s.step]}`, tone: GREEN, svg: I_STEP });
    }
  }
  if (typeof loan.submitted_at === "string" && loan.submitted_at && !logs.some((l) => l.action === "submitted")) {
    out.push({ at: loan.submitted_at, text: "Application submitted", tone: BLUE, svg: I_SEND });
  }
  // status_history only when there's no log at all — otherwise the log
  // already records every transition and we'd double up.
  if (logs.length === 0) {
    const hist: StatusEntry[] = Array.isArray(loan.status_history) ? loan.status_history : [];
    for (const h of hist) {
      if (!h?.at) continue;
      const tone = h.to === "approved" ? GREEN : h.to === "rejected" ? RED : h.to === "under_review" ? AMBER : BLUE;
      const svg  = h.to === "approved" ? I_CHECK_CIRC : h.to === "rejected" ? I_X_CIRC : I_TARGET;
      out.push({
        at: h.at,
        text: `Status changed — ${label(h.from)} → ${label(h.to)}`,
        by: h.by ?? null,
        note: h.note || null,
        tone, svg,
      });
    }
  }

  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export default function LoanActivityLogModal({ open, onClose, loan, borrowerName }: Props) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !loan?.id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { data, error } = await supabase()
        .from("loan_activity_log")
        .select("id, actor, actor_name, action, step, detail, created_at")
        .eq("application_id", loan.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) console.warn("[loan-activity] load failed:", error.message);
      if (cancelled) return;
      setLogs((data ?? []) as LogRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, loan?.id]);

  if (!open) return null;
  const events = loan ? buildEvents(loan, logs) : [];

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
              Chronological — every step save, submission, approval, rejection and status change.
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
          {loading ? (
            <p className="text-[13px] text-[#5a8a76]">Loading activity…</p>
          ) : events.length === 0 ? (
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
