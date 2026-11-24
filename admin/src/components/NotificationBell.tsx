"use client";

// A bell + dropdown that surfaces comments OTHER admins (e.g. the manager) have
// left on the cases assigned to the signed-in user — across the loan, EPC, and
// lead dashboards (insurance has no comments table). New arrivals ping a short
// two-tone ring. "Read" is tracked by a last-seen timestamp in localStorage.
//
// Self-contained: drop <NotificationBell /> into any admin header. Only the
// caller's own assigned cases are queried, and comments authored by the caller
// are excluded, so you only hear about what someone else said on your work.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fmtAgo } from "@/lib/dates";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { REVIEW_COLS, REVIEW_LABEL, loanReviews, reviewNotices } from "@/lib/review";
import { markNotifSeen, notifSeen, onNotifSeen } from "@/lib/notif-seen";
import { TRANCHE2_COLS, TRANCHE2_TOTAL, onTranche2, publishTranche2, readTranche2, tranche2Href, tranche2Of, useUnreadTranche2, type Tranche2 } from "@/lib/tranche2";
import { useCloseOnOutsideClick } from "@/lib/use-close-on-outside-click";

type Source = "loan" | "epc" | "lead" | "insurance";
// kind "review": the admin approved / sent back a stage the team saved (lib/review).
// kind "request": an EPC asked for its custom quotation template (uploaded a sample, 0122).
// kind "tranche": an EPC uploaded 2nd-tranche (completion) documents on its portal.
type Notif = { id: string; kind: "comment" | "assign" | "review" | "request" | "tranche"; source: Source; caseName: string; author: string; text: string; at: string; href: string; ok?: boolean };

const SRC_LABEL: Record<Source, string> = { loan: "Loan", epc: "EPC", lead: "Lead", insurance: "Insurance" };
const SRC_TINT: Record<Source, { bg: string; fg: string }> = {
  loan: { bg: "#e7f5ee", fg: "#178a5c" },
  epc: { bg: "#e8f1fb", fg: "#185fa5" },
  lead: { bg: "#e8e7fb", fg: "#4338ca" },
  insurance: { bg: "#fdf0e3", fg: "#b45309" },
};

// One shared AudioContext, resumed on the first user gesture (autoplay policy).
let audioCtx: AudioContext | null = null;
function ring() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const ctx = audioCtx;
    const t0 = ctx.currentTime;
    ([[880, 0], [1174.66, 0.11]] as const).forEach(([freq, off]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      osc.connect(gain); gain.connect(ctx.destination);
      const s = t0 + off;
      gain.gain.setValueAtTime(0.0001, s);
      gain.gain.exponentialRampToValueAtTime(0.12, s + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
      osc.start(s); osc.stop(s + 0.22);
    });
  } catch { /* audio is best-effort */ }
}

export default function NotificationBell() {
  const me = getBusiness();
  // getBusiness() JSON-parses localStorage → a NEW object every render. Depending
  // on it would give `load` a new identity each render, so the [load] effect would
  // re-run every render and re-fetch — a self-sustaining loop (setItems → render →
  // new load → effect → load again) that hammered PostgREST. Depend on the stable
  // primitive id instead so `load` is created once.
  const meId = me?.id ?? null;
  const router = useRouter();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [seen, setSeen] = useState<number>(() => (typeof window !== "undefined" ? notifSeen() : 0));
  useEffect(() => onNotifSeen(setSeen), []); // marked read in My Day
  const lastMax = useRef(0);
  const first = useRef(true);
  const boxRef = useRef<HTMLDivElement>(null);
  // The "cases assigned to me" name maps change rarely (only on reassignment),
  // so cache them for 5 min and reuse them each time the bell is opened.
  const caseMaps = useRef<{ at: number; loanName: Map<string, string>; epcName: Map<string, string>; leadName: Map<string, string>; insName: Map<string, string> } | null>(null);

  const load = useCallback(async () => {
    if (!meId) return;
    const db = supabase();
    // Refresh the assigned-case name maps at most every 5 min; reuse otherwise.
    let maps = caseMaps.current;
    if (!maps || Date.now() - maps.at > 300000) {
      const [loans, epcs, leads, ins] = await Promise.all([
        db.from("epc_applications").select("id, borrower_name, aadhaar_name").eq("assigned_to_user_id", meId),
        db.from("epc_business").select("id, trade_name, legal_name, contact_name").eq("assigned_to_user_id", meId).neq("business_type", "admin"),
        db.from("loan_leads").select("id, name").eq("assigned_to_user_id", meId),
        db.from("insurance_applications").select("id, aadhaar_name").eq("assigned_to_user_id", meId),
      ]);
      maps = {
        at: Date.now(),
        loanName: new Map<string, string>(((loans.data ?? []) as Record<string, string>[]).map((r) => [r.id, r.borrower_name || r.aadhaar_name || "—"])),
        epcName: new Map<string, string>(((epcs.data ?? []) as Record<string, string>[]).map((r) => [r.id, r.trade_name || r.legal_name || r.contact_name || "—"])),
        leadName: new Map<string, string>(((leads.data ?? []) as Record<string, string>[]).map((r) => [r.id, r.name || "—"])),
        insName: new Map<string, string>(((ins.data ?? []) as Record<string, string>[]).map((r) => [r.id, r.aadhaar_name || "—"])),
      };
      caseMaps.current = maps;
    }
    const { loanName, epcName, leadName, insName } = maps;
    const loanIds = [...loanName.keys()], epcIds = [...epcName.keys()], leadIds = [...leadName.keys()];

    const empty = Promise.resolve({ data: [] as Record<string, string>[] });
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const isCC = getBusiness()?.business_type === "admin";
    const [lc, ec, dc, act, rv, rq, tr] = await Promise.all([
      loanIds.length ? db.from("loan_comments").select("id, application_id, author_id, author_name, comment_text, created_at").in("application_id", loanIds).neq("author_id", meId).order("created_at", { ascending: false }).limit(20) : empty,
      epcIds.length ? db.from("epc_comments").select("id, business_id, author_id, author_name, comment_text, created_at").in("business_id", epcIds).neq("author_id", meId).order("created_at", { ascending: false }).limit(20) : empty,
      leadIds.length ? db.from("lead_comments").select("id, lead_id, author_id, author_name, comment_text, created_at").in("lead_id", leadIds).neq("author_id", meId).order("created_at", { ascending: false }).limit(20) : empty,
      // Cases someone ELSE assigned/reassigned TO me (e.g. Malvika → Manish).
      db.from("user_activity_log")
        .select("id, module, record_id, action, created_at, actor:actor_user_id(contact_name)")
        .eq("subject_user_id", meId).in("action", ["assigned", "reassigned"]).neq("actor_user_id", meId)
        .order("created_at", { ascending: false }).limit(20),
      // The admin's approvals / send-backs of the last 14 days — for the team
      // (the admin made them). Every loan the user can see (RLS).
      isMainAdmin(getBusiness()) ? empty : db.from("epc_applications")
        .select(`id, aadhaar_name, borrower_name, ${REVIEW_COLS}`)
        .or(`approval_reviewed_at.gte.${since},disb1_reviewed_at.gte.${since},disb2_reviewed_at.gte.${since}`)
        .limit(50),
      // EPCs asking for a custom quotation template (a sample uploaded in the last
      // 14 days, no ready template yet) — for every CC account.
      !isCC ? empty : db.from("epc_documents")
        .select("id, business_id, created_at, epc_business:business_id(trade_name, legal_name, contact_name, epc_quotation_templates(ready_at))")
        .eq("category", "custom_quote_sample").gte("created_at", since)
        .order("created_at", { ascending: false }).limit(30),
      // Loans whose EPC uploaded (0125) or sent (0138) 2nd-tranche documents, 2nd disbursement not paid.
      !isCC ? empty : db.from("epc_applications")
        .select(`id, aadhaar_name, borrower_name, second_disbursement_amount, ${TRANCHE2_COLS}, epc_business:epc_business_id(trade_name, legal_name, contact_name)`)
        .or("tranche2_epc_at.not.is.null,tranche2_submitted_at.not.is.null").is("second_disbursement_amount", null)
        .order("tranche2_epc_at", { ascending: false, nullsFirst: false }).limit(50),
    ]);
    // Saved for every page's bell (lib/tranche2); shown from that list, not from here.
    if (isCC && !("error" in tr && tr.error)) {
      publishTranche2(((tr.data ?? []) as Record<string, any>[]).map((r) => {
        const b = r.epc_business as Record<string, any> | null;
        return tranche2Of(r, r.aadhaar_name || r.borrower_name || "—", b?.trade_name || b?.legal_name || b?.contact_name || null);
      }).filter((t): t is Tranche2 => !!t));
    }
    const requests = new Map<string, Notif>(); // one per EPC, its latest upload
    for (const d of (rq.data ?? []) as Record<string, any>[]) {
      const b = d.epc_business as Record<string, any> | null;
      if (requests.has(d.business_id) || (b?.epc_quotation_templates ?? []).some((t: Record<string, any>) => t.ready_at)) continue;
      const name = b?.trade_name || b?.legal_name || b?.contact_name || "An EPC";
      requests.set(d.business_id, { id: "q" + d.business_id, kind: "request", source: "epc", caseName: name, author: name,
        text: "Custom quotation template", at: d.created_at, href: `/admin/epc/${d.business_id}/view` });
    }
    const reviews = reviewNotices(((rv.data ?? []) as Record<string, any>[])
      .map((r) => ({ id: r.id as string, name: r.aadhaar_name || r.borrower_name || "—", reviews: loanReviews(r) })));

    // module → { display source, name lookup, view href }
    const MOD: Record<string, { source: Source; names: Map<string, string>; href: (id: string) => string }> = {
      apps: { source: "loan", names: loanName, href: (id) => `/admin/app/${id}/view` },
      epcs: { source: "epc", names: epcName, href: (id) => `/admin/epc/${id}/view` },
      loanleads: { source: "lead", names: leadName, href: (id) => `/admin/lead/${id}/view` },
      insurance: { source: "insurance", names: insName, href: (id) => `/admin/insurance/${id}/view` },
    };

    const merged: Notif[] = [
      ...((lc.data ?? []) as Record<string, string>[]).map((r) => ({ id: "l" + r.id, kind: "comment" as const, source: "loan" as const, caseName: loanName.get(r.application_id) || "—", author: r.author_name || "Someone", text: r.comment_text, at: r.created_at, href: `/admin/app/${r.application_id}/view` })),
      ...((ec.data ?? []) as Record<string, string>[]).map((r) => ({ id: "e" + r.id, kind: "comment" as const, source: "epc" as const, caseName: epcName.get(r.business_id) || "—", author: r.author_name || "Someone", text: r.comment_text, at: r.created_at, href: `/admin/epc/${r.business_id}/view` })),
      ...((dc.data ?? []) as Record<string, string>[]).map((r) => ({ id: "d" + r.id, kind: "comment" as const, source: "lead" as const, caseName: leadName.get(r.lead_id) || "—", author: r.author_name || "Someone", text: r.comment_text, at: r.created_at, href: `/admin/lead/${r.lead_id}/view` })),
      ...((act.data ?? []) as Record<string, any>[]).filter((r) => MOD[r.module]).map((r) => {
        const m = MOD[r.module];
        const author = (r.actor as { contact_name?: string } | null)?.contact_name || "Someone";
        return { id: "a" + r.id, kind: "assign" as const, source: m.source, caseName: m.names.get(r.record_id) || "a case", author, text: r.action === "reassigned" ? "assigned you this case" : "assigned you a new case", at: r.created_at, href: m.href(r.record_id) };
      }),
      ...reviews.map((n) => ({
        id: "r" + n.loanId + n.item, kind: "review" as const, source: "loan" as const, caseName: n.name, author: "Admin",
        text: REVIEW_LABEL[n.item] + (n.status === "sent_back" && n.note ? ` — ${n.note}` : ""), at: n.at, href: n.href, ok: n.status === "approved",
      })),
      ...requests.values(),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 30);

    setItems(merged);
    const maxTs = merged.length ? new Date(merged[0].at).getTime() : 0;
    if (!first.current && maxTs > lastMax.current && maxTs > seen) ring();
    first.current = false;
    lastMax.current = maxTs;
  }, [meId, seen]);

  // ON-DEMAND ONLY — no polling, no timer, no fetch on mount. The bell checks
  // for notifications ONLY when the user opens it (see the button handler below),
  // so it costs zero Supabase egress while idle. Trade-off: the unread badge
  // appears after the first time the bell is opened in a session, not before.
  // Opening it again within 2 minutes shows the same list without re-querying.
  const loadedAt = useRef(0);
  function check() {
    if (Date.now() - loadedAt.current < 120000) return;
    loadedAt.current = Date.now();
    setLoading(true);
    void load().finally(() => { setLoading(false); setLoadedOnce(true); });
  }

  // Close on outside click.
  useCloseOnOutsideClick(boxRef, open, setOpen);

  // 2nd-tranche uploads come from the list the pages already loaded (lib/tranche2),
  // so the red count shows on every page without asking the database.
  // Minus the cases this person marked read (My Day's list).
  const [t2All, setT2] = useState<Tranche2[]>([]);
  useEffect(() => { setT2(readTranche2()); return onTranche2(setT2); }, []);
  const t2 = useUnreadTranche2(t2All);
  const all = useMemo(() => [
    ...items,
    ...t2.map((t): Notif => ({
      id: "t" + t.id, kind: "tranche", source: "loan", caseName: t.name, author: t.epc || "EPC",
      text: `2nd tranche documents · ${t.docs}/${TRANCHE2_TOTAL}`, at: t.at, href: tranche2Href(t.id), ok: t.docs >= TRANCHE2_TOTAL,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()), [items, t2]);

  const unread = useMemo(() => all.filter((n) => new Date(n.at).getTime() > seen).length, [all, seen]);

  function markAllRead() { setSeen(markNotifSeen()); }
  function openItem(n: Notif) { markAllRead(); setOpen(false); router.push(n.href); }

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => { const next = !open; setOpen(next); if (next) check(); }}
        aria-label="Notifications" title="Check notifications from your team"
        className="relative grid place-items-center w-9 h-9 rounded-lg border border-line bg-white hover:bg-bg-tint transition-colors">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15241d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-red-600 text-white text-[10px] font-bold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[min(340px,calc(100vw-2rem))] max-h-[420px] overflow-y-auto rounded-xl border border-line bg-white shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line sticky top-0 bg-white">
            <span className="text-[13px] font-bold text-text">Notifications</span>
            {unread > 0
              ? <button type="button" onClick={markAllRead} className="text-[11px] font-semibold text-cc-green hover:underline">Mark all read</button>
              : <span className="text-[11px] text-text-muted">You&apos;re all caught up</span>}
          </div>
          {loading && all.length === 0 ? (
            <div className="px-4 py-6 text-[12px] text-text-muted text-center">Checking…</div>
          ) : all.length === 0 ? (
            <div className="px-4 py-6 text-[12px] text-text-muted text-center">{loadedOnce ? "Nothing yet." : "Nothing to show."}<br />When your team assigns you a case or comments on your work, it shows here.</div>
          ) : (
            <ul className="divide-y divide-line">
              {all.map((n) => {
                const isNew = new Date(n.at).getTime() > seen;
                const tint = SRC_TINT[n.source];
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => openItem(n)}
                      className={"w-full text-left px-4 py-2.5 hover:bg-bg-tint transition-colors " + (isNew ? "bg-cc-wash" : "")}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {isNew && <span className="w-2 h-2 rounded-full bg-cc-green shrink-0" />}
                        <span className="text-[12px] font-bold text-text truncate">{n.author}</span>
                        <span className="text-[11px] text-text-muted">{n.kind === "assign" ? "assigned you" : n.kind === "review" ? (n.ok ? "approved" : "sent back") : n.kind === "request" ? "wants a custom quotation" : n.kind === "tranche" ? "uploaded" : "commented on"}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded ml-auto shrink-0" style={{ backgroundColor: tint.bg, color: tint.fg }}>{SRC_LABEL[n.source]}</span>
                      </div>
                      <div className="text-[12px] font-semibold text-text truncate">{n.caseName}</div>
                      {n.kind === "comment"
                        ? <div className="text-[12px] text-text-mid line-clamp-2 mt-0.5">{n.text}</div>
                        : n.kind === "review"
                        ? <div className={["text-[12px] font-medium line-clamp-2 mt-0.5", n.ok ? "text-cc-green" : "text-red-700"].join(" ")}>{n.ok ? "✓ " : "↩ "}{n.text}</div>
                        : n.kind === "request"
                        ? <div className="text-[12px] font-medium text-cc-blue mt-0.5">{n.text}</div>
                        : n.kind === "tranche"
                        ? <div className={["text-[12px] font-medium mt-0.5", n.ok ? "text-cc-green" : "text-amber-700"].join(" ")}>{n.ok ? "✓ " : ""}{n.text}</div>
                        : <div className="text-[11px] text-cc-green font-medium mt-0.5">New assignment — tap to open</div>}
                      <div className="text-[10px] text-text-muted mt-1">{fmtAgo(n.at)}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
