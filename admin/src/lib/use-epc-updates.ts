"use client";

// Per-admin "Message to EPC" reply counts (0086). Powers the per-profile message
// button + red count in the loan/insurance tabs' Action column, so every admin
// sees updates relative to THEIR OWN reads: when Manish opens a profile's
// messages the count clears on his console only; Malvika still sees it.
//
// The red count on a profile = how many EPC replies arrived after this admin last
// opened that profile's thread. Reads are keyed per admin in epc_msg_reads.
//
// Egress: computed once per console mount and cached 45s (getCached), shared by
// both tabs (one fetch, not two). Opening a message window calls
// invalidate(epcUpdatesKey()) so the count recomputes fresh on return. Message
// rows are fetched only for the (small) set of profiles that have EPC activity.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBusiness } from "@/lib/auth";
import { getCached, setCached } from "@/lib/list-cache";

type Serialized = { loan: [string, number][]; ins: [string, number][] };

export const EPC_UPDATES_CACHE = "epcUpdates";
// Cache is per-admin (reads differ per admin) — key it by the signed-in admin id
// so two admins on the same browser never see each other's counts.
export function epcUpdatesKey(): string {
  return EPC_UPDATES_CACHE + ":" + (getBusiness()?.id ?? "anon");
}

export function useEpcUpdates(): {
  loanCounts: Map<string, number>; insCounts: Map<string, number>; loading: boolean;
} {
  const [loanCounts, setLoanCounts] = useState<Map<string, number>>(new Map());
  const [insCounts, setInsCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const biz = getBusiness();
      if (!biz || biz.business_type !== "admin") { setLoading(false); return; }

      const key = epcUpdatesKey();
      const cached = getCached<Serialized>(key, 45000);
      if (cached) {
        setLoanCounts(new Map(cached.loan)); setInsCounts(new Map(cached.ins));
        setLoading(false); return;
      }

      const db = supabase();
      // Profiles that have EPC activity — bounds the message query (low egress).
      // epc_last_activity_at is bumped on an EPC reply, a resolve, AND an edit
      // re-submit (auto-resolve), so it catches an EPC UPDATE even when no message
      // row was posted (a doc/detail edit).
      const [reads, loanP, insP] = await Promise.all([
        db.from("epc_msg_reads").select("kind, parent_id, seen_at"),
        db.from("epc_applications").select("id, epc_last_activity_at").not("epc_last_activity_at", "is", null),
        db.from("insurance_applications").select("id, epc_last_activity_at").not("epc_last_activity_at", "is", null),
      ]);

      const readLoan = new Map<string, string>(); const readIns = new Map<string, string>();
      for (const r of (reads.data ?? []) as Record<string, string>[]) {
        (r.kind === "loan" ? readLoan : readIns).set(r.parent_id, r.seen_at);
      }
      const loanAct = new Map<string, string>(); const insAct = new Map<string, string>();
      for (const r of (loanP.data ?? []) as Record<string, string>[]) loanAct.set(r.id, r.epc_last_activity_at);
      for (const r of (insP.data ?? []) as Record<string, string>[]) insAct.set(r.id, r.epc_last_activity_at);
      const loanIds = [...loanAct.keys()];
      const insIds = [...insAct.keys()];

      // Count unseen EPC replies (created after this admin's seen time) per profile.
      const [loanMsgs, insMsgs] = await Promise.all([
        loanIds.length ? db.from("loan_messages").select("application_id, created_at").eq("sender", "epc").in("application_id", loanIds) : Promise.resolve({ data: [] as Record<string, string>[] }),
        insIds.length ? db.from("insurance_messages").select("insurance_application_id, created_at").eq("sender", "epc").in("insurance_application_id", insIds) : Promise.resolve({ data: [] as Record<string, string>[] }),
      ]);
      const lc = new Map<string, number>(); const ic = new Map<string, number>();
      for (const m of (loanMsgs.data ?? []) as Record<string, string>[]) {
        const seen = readLoan.get(m.application_id);
        if (!seen || seen < m.created_at) lc.set(m.application_id, (lc.get(m.application_id) ?? 0) + 1);
      }
      for (const m of (insMsgs.data ?? []) as Record<string, string>[]) {
        const seen = readIns.get(m.insurance_application_id);
        if (!seen || seen < m.created_at) ic.set(m.insurance_application_id, (ic.get(m.insurance_application_id) ?? 0) + 1);
      }
      // An unseen EPC UPDATE with no unseen message rows (e.g. the EPC edited &
      // re-submitted their profile) still shows a badge of 1 so the admin knows to
      // look. Cleared when the admin opens that profile's message window (seen).
      const bump = (act: Map<string, string>, read: Map<string, string>, counts: Map<string, number>) => {
        for (const [id, at] of act) {
          const seen = read.get(id);
          if ((!seen || seen < at) && (counts.get(id) ?? 0) === 0) counts.set(id, 1);
        }
      };
      bump(loanAct, readLoan, lc);
      bump(insAct, readIns, ic);

      setCached(key, { loan: [...lc], ins: [...ic] } as Serialized);
      setLoanCounts(lc); setInsCounts(ic);
      setLoading(false);
    })();
  }, []);

  return { loanCounts, insCounts, loading };
}
