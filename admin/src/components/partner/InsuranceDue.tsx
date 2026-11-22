"use client";

// Insurance due — the Partner Portal v2 dashboard's card of issued policies ending
// within 30 days either side of today (from the dashboard's own read; no request
// of its own). A row opens the policy, the title opens Insurance → Due for renewal,
// Renew starts a new insurance application (the portal's usual flow). Everyone with
// Insurance sees it; Renew only for those who can work (not Viewers).

import { fmtDate } from "@/lib/dates";
import type { InsuranceDueRow } from "@/lib/dashboard-v2";

const daysText = (d: number) => {
  const n = Math.abs(d);
  return d < 0 ? `expired ${n} ${n === 1 ? "day" : "days"} ago` : `${n} ${n === 1 ? "day" : "days"} left`;
};

export default function InsuranceDue({ rows, loading, onOpen, onAll, onRenew, renewing }: {
  rows: InsuranceDueRow[]; loading: boolean;
  onOpen: (id: string) => void; onAll: () => void;
  onRenew: (() => void) | null; renewing: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-line p-5">
      <button type="button" onClick={onAll} className="flex items-center gap-1.5 text-[13px] font-semibold text-[#0f3d2e] mb-3 hover:text-[#1e3a8a]">
        Insurance due
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
      {loading ? <div className="text-[13px] text-text-muted">Loading…</div>
        : rows.length === 0 ? <div className="text-[13px] text-text-muted">No policies due.</div>
        : (
          <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto">
            {rows.map((r) => (
              <div key={r.id} role="button" tabIndex={0} onClick={() => onOpen(r.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(r.id); }}
                className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5 hover:bg-[#f7f9fe] cursor-pointer">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-text truncate">{r.name}</div>
                  <div className={`text-[11.5px] font-medium ${r.days_left < 0 ? "text-red-700" : "text-[#854f0b]"}`}>
                    {fmtDate(r.policy_to_date)} · {daysText(r.days_left)}
                  </div>
                </div>
                {onRenew && (
                  <button type="button" disabled={renewing} onClick={(e) => { e.stopPropagation(); onRenew(); }}
                    className="shrink-0 px-3 py-1.5 rounded-lg border border-[#1e3a8a] text-[#1e3a8a] text-[12px] font-semibold hover:bg-[#1e3a8a]/[0.06] disabled:opacity-60">
                    {renewing ? "Starting…" : "Renew"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
