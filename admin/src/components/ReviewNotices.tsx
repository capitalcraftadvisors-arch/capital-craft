"use client";

// My Day: the admin's approvals and send-backs on the team's loans that aren't
// read yet. Built from the cases My Day already loaded (no extra request); the
// read state is shared with the bell (lib/notif-seen).

import { useEffect, useState } from "react";
import { fmtDate } from "@/lib/dates";
import { REVIEW_LABEL, reviewNotices, type LoanReview } from "@/lib/review";
import { markNotifSeen, notifSeen, onNotifSeen } from "@/lib/notif-seen";

export default function ReviewNotices({ loans, onOpen }: {
  loans: { id: string; name: string; reviews?: LoanReview[] }[];
  onOpen: (href: string) => void;
}) {
  const [seen, setSeen] = useState(notifSeen);
  useEffect(() => onNotifSeen(setSeen), []);

  const list = reviewNotices(loans).filter((n) => new Date(n.at).getTime() > seen);
  if (!list.length) return null;

  return (
    <section className="mb-4 rounded-xl border bg-white overflow-hidden cc-table-card">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-line">
        <h2 className="text-[14px] font-bold text-text">Admin decisions</h2>
        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center">{list.length}</span>
        <button type="button" onClick={() => setSeen(markNotifSeen())} className="ml-auto text-[12px] font-semibold text-[#178a5c] hover:underline">
          Mark all read
        </button>
      </div>
      <ul className="divide-y divide-line">
        {list.map((n) => {
          const ok = n.status === "approved";
          return (
            <li key={n.loanId + n.item}>
              <button type="button" onClick={() => onOpen(n.href)} className="w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-bg-tint">
                <span className={["shrink-0 text-[11.5px] font-semibold px-2 py-0.5 rounded-[8px] border whitespace-nowrap",
                  ok ? "border-[#cdeadd] bg-[#f0faf5] text-[#178a5c]" : "border-red-200 bg-red-50 text-red-700"].join(" ")}>
                  {ok ? "✓ Approved" : "↩ Sent back"}
                </span>
                <span className="text-[13px] font-semibold text-text truncate">{n.name}</span>
                <span className="text-[12px] text-text-muted whitespace-nowrap">{REVIEW_LABEL[n.item]}</span>
                {!ok && n.note && <span className="text-[12px] text-red-700 truncate">{n.note}</span>}
                <span className="ml-auto shrink-0 text-[11px] text-text-muted whitespace-nowrap">{fmtDate(n.at)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
