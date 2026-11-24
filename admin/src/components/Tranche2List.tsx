"use client";

// My Day: loans whose EPC uploaded 2nd-tranche documents on its portal and whose
// 2nd disbursement isn't entered yet. Built from the cases My Day already loaded
// (no extra request); new since the bell was last read = green dot (lib/notif-seen).

import { useEffect, useState } from "react";
import { fmtDate } from "@/lib/dates";
import { notifSeen, onNotifSeen } from "@/lib/notif-seen";
import { TRANCHE2_TOTAL, tranche2Href, type Tranche2 } from "@/lib/tranche2";

export default function Tranche2List({ items, onOpen }: { items: Tranche2[]; onOpen: (href: string) => void }) {
  const [seen, setSeen] = useState(notifSeen);
  useEffect(() => onNotifSeen(setSeen), []);

  if (!items.length) return null;
  const list = [...items].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="mb-4 rounded-xl border bg-white overflow-hidden cc-table-card">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-line">
        <h2 className="text-[14px] font-bold text-text">2nd tranche received</h2>
        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center">{list.length}</span>
      </div>
      <ul className="divide-y divide-line">
        {list.map((t) => {
          const full = t.docs >= TRANCHE2_TOTAL;
          return (
            <li key={t.id}>
              <button type="button" onClick={() => onOpen(tranche2Href(t.id))} className="w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-bg-tint">
                <span className={["w-2 h-2 rounded-full shrink-0", new Date(t.at).getTime() > seen ? "bg-cc-green" : "bg-transparent"].join(" ")} />
                <span className="text-[13px] font-semibold text-text truncate">{t.name}</span>
                {t.epc && <span className="text-[12px] text-text-muted truncate">{t.epc}</span>}
                <span className={["ml-auto shrink-0 text-[11.5px] font-semibold px-2 py-0.5 rounded-[8px] border whitespace-nowrap",
                  full ? "border-cc-line bg-cc-wash text-cc-green" : "border-amber-200 bg-amber-50 text-amber-700"].join(" ")}>
                  {t.docs}/{TRANCHE2_TOTAL}
                </span>
                <span className="shrink-0 text-[11px] text-text-muted whitespace-nowrap">{fmtDate(t.at)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
