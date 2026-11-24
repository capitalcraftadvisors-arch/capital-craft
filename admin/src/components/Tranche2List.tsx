"use client";

// My Day: loans whose EPC uploaded 2nd-tranche documents on its portal and whose
// 2nd disbursement isn't entered yet. Built from the cases My Day already loaded
// (no extra request); new since the bell was last read = green dot (lib/notif-seen).
// Each row: Email (the 2nd-tranche documents to the lender who approved the loan)
// and Mark read; the header: Mark all read. Read is per person (lib/tranche2).

import { useEffect, useState } from "react";
import EmailComposerModal from "@/components/EmailComposerModal";
import { I } from "@/components/view/ViewKit";
import { fmtDate } from "@/lib/dates";
import { notify } from "@/lib/notify";
import { notifSeen, onNotifSeen } from "@/lib/notif-seen";
import { TRANCHE2_TOTAL, markTranche2Read, tranche2Href, useUnreadTranche2, type Tranche2 } from "@/lib/tranche2";

const ICON_BTN = "shrink-0 grid place-items-center w-8 h-8 rounded-[8px] border border-cc-line bg-white text-cc-green hover:bg-cc-wash hover:border-cc-green transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-cc-line";

export default function Tranche2List({ items, onOpen }: { items: Tranche2[]; onOpen: (href: string) => void }) {
  const [seen, setSeen] = useState(notifSeen);
  useEffect(() => onNotifSeen(setSeen), []);
  const [emailFor, setEmailFor] = useState<Tranche2 | null>(null);
  const unread = useUnreadTranche2(items);

  if (!unread.length && !emailFor) return null;
  const list = [...unread].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="mb-4 rounded-xl border bg-white overflow-hidden cc-table-card">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-line">
        <h2 className="text-[14px] font-bold text-text">2nd tranche received</h2>
        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center">{list.length}</span>
        <button type="button" onClick={() => markTranche2Read(list.map((t) => t.id))}
          className="ml-auto text-[12px] font-semibold text-cc-green hover:underline">
          Mark all read
        </button>
      </div>
      <ul className="divide-y divide-line">
        {list.map((t) => {
          const full = t.docs >= TRANCHE2_TOTAL;
          return (
            <li key={t.id} className="flex items-center gap-2 pr-3 hover:bg-bg-tint">
              <button type="button" onClick={() => onOpen(tranche2Href(t.id))} className="flex-1 min-w-0 text-left pl-4 py-2 flex items-center gap-3">
                <span className={["w-2 h-2 rounded-full shrink-0", new Date(t.at).getTime() > seen ? "bg-cc-green" : "bg-transparent"].join(" ")} />
                <span className="text-[13px] font-semibold text-text truncate">{t.name}</span>
                {t.epc && <span className="text-[12px] text-text-muted truncate">{t.epc}</span>}
                <span className={["ml-auto shrink-0 text-[11.5px] font-semibold px-2 py-0.5 rounded-[8px] border whitespace-nowrap",
                  full ? "border-cc-line bg-cc-wash text-cc-green" : "border-amber-200 bg-amber-50 text-amber-700"].join(" ")}>
                  {t.docs}/{TRANCHE2_TOTAL}
                </span>
                <span className="shrink-0 text-[11px] text-text-muted whitespace-nowrap">{fmtDate(t.at)}</span>
              </button>
              <button type="button" onClick={() => setEmailFor(t)} disabled={!full}
                title={full ? "Email to lender" : "Upload all completion documents first"} aria-label="Email to lender" className={ICON_BTN}>
                {I.mail}
              </button>
              <button type="button" onClick={() => markTranche2Read([t.id])} title="Mark read" aria-label="Mark read" className={ICON_BTN}>
                {I.check}
              </button>
            </li>
          );
        })}
      </ul>

      {emailFor && (
        <EmailComposerModal
          open
          onClose={() => setEmailFor(null)}
          endpoint={`/api/admin/loan-app/${emailFor.id}/send-to-lender`}
          extraParams={{ scope: "completion" }}
          defaultLender={emailFor.lender}
          title="Email completion documents"
          onSent={() => { setEmailFor(null); notify.success("Completion documents emailed to the lender."); }}
        />
      )}
    </section>
  );
}
