"use client";

// Task Manager — "this month" work cards above the board: the RM's own scorecard and the overseer's per-person strip.

import type { OpsCase, CaseSource } from "@/lib/ops-board";
import { monthKey } from "./rules";

export function MyMonthCard({ cases, srcFilter, me, thisMonthKey }: {
  cases: OpsCase[]; srcFilter: "all" | CaseSource; me: { id: string } | null; thisMonthKey: string;
}) {
  // The RM's own scorecard, this month: Total / WIP / Oldest / Done.
  const wipCases = cases.filter((c) => c.source === srcFilter && c.column != null && c.ownerUserId === me?.id);
  const done = cases.filter((c) => c.source === srcFilter && c.ownerUserId === me?.id && monthKey(c.disbursedThisMonthAt) === thisMonthKey).length;
  const wip = wipCases.length;
  const oldest = wipCases.reduce((m, c) => Math.max(m, c.tatDays), 0);
  return (
    <div className="inline-flex flex-col mb-4 rounded-lg border border-[#cdeadd] bg-[#f0faf5] px-4 py-2.5">
      <span className="text-[12px] font-semibold text-[#5a8a76]">This month</span>
      <span className="text-[12px] text-[#0f3d2e] mt-0.5">
        <strong>WIP {wip}</strong>
        {oldest > 0 && <> · oldest {oldest}d</>}
        {done > 0 && <> · <strong className="text-[#178a5c]">{done} done</strong></>}
      </span>
    </div>
  );
}

// Per person, this month: WIP · oldest · done (see the page's `workload`).
export function WorkloadStrip({ workload }: { workload: { id: string; name: string; wip: number; done: number; oldest: number }[] }) {
  return (
    <div className="flex gap-2 mb-4 flex-wrap">
      {workload.map((w) => (
        <div key={w.id} className="rounded-lg border border-line bg-white px-3 py-2 min-w-[132px]">
          <div className="text-[12px] font-semibold text-text">{w.name}</div>
          <div className="text-[11px] text-text-muted mt-0.5">
            <span className="font-semibold text-text">WIP {w.wip}</span>
            {w.oldest > 0 && <> · oldest {w.oldest}d</>}
            {w.done > 0 && <> · <span className="text-[#178a5c] font-semibold">{w.done} done</span></>}
          </div>
        </div>
      ))}
    </div>
  );
}
