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
import { getBusiness } from "@/lib/auth";

type Source = "loan" | "epc" | "lead";
type Notif = { id: string; source: Source; caseName: string; author: string; text: string; at: string; href: string };

const SRC_LABEL: Record<Source, string> = { loan: "Loan", epc: "EPC", lead: "Lead" };
const SRC_TINT: Record<Source, { bg: string; fg: string }> = {
  loan: { bg: "#e7f5ee", fg: "#178a5c" },
  epc: { bg: "#e8f1fb", fg: "#185fa5" },
  lead: { bg: "#e8e7fb", fg: "#4338ca" },
};
const SEEN_KEY = "cc_notif_seen";

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

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function NotificationBell() {
  const me = getBusiness();
  const router = useRouter();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<number>(() => (typeof window !== "undefined" ? Number(localStorage.getItem(SEEN_KEY)) : 0) || 0);
  const lastMax = useRef(0);
  const first = useRef(true);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!me?.id) return;
    const db = supabase();
    const [loans, epcs, leads] = await Promise.all([
      db.from("epc_applications").select("id, borrower_name, aadhaar_name").eq("assigned_to_user_id", me.id),
      db.from("epc_business").select("id, trade_name, legal_name, contact_name").eq("assigned_to_user_id", me.id).neq("business_type", "admin"),
      db.from("loan_leads").select("id, name").eq("assigned_to_user_id", me.id),
    ]);
    const loanName = new Map<string, string>(((loans.data ?? []) as Record<string, string>[]).map((r) => [r.id, r.borrower_name || r.aadhaar_name || "—"]));
    const epcName = new Map<string, string>(((epcs.data ?? []) as Record<string, string>[]).map((r) => [r.id, r.trade_name || r.legal_name || r.contact_name || "—"]));
    const leadName = new Map<string, string>(((leads.data ?? []) as Record<string, string>[]).map((r) => [r.id, r.name || "—"]));
    const loanIds = [...loanName.keys()], epcIds = [...epcName.keys()], leadIds = [...leadName.keys()];

    const empty = Promise.resolve({ data: [] as Record<string, string>[] });
    const [lc, ec, dc] = await Promise.all([
      loanIds.length ? db.from("loan_comments").select("id, application_id, author_id, author_name, comment_text, created_at").in("application_id", loanIds).neq("author_id", me.id).order("created_at", { ascending: false }).limit(20) : empty,
      epcIds.length ? db.from("epc_comments").select("id, business_id, author_id, author_name, comment_text, created_at").in("business_id", epcIds).neq("author_id", me.id).order("created_at", { ascending: false }).limit(20) : empty,
      leadIds.length ? db.from("lead_comments").select("id, lead_id, author_id, author_name, comment_text, created_at").in("lead_id", leadIds).neq("author_id", me.id).order("created_at", { ascending: false }).limit(20) : empty,
    ]);
    const merged: Notif[] = [
      ...((lc.data ?? []) as Record<string, string>[]).map((r) => ({ id: "l" + r.id, source: "loan" as const, caseName: loanName.get(r.application_id) || "—", author: r.author_name || "Someone", text: r.comment_text, at: r.created_at, href: `/admin/app/${r.application_id}/view` })),
      ...((ec.data ?? []) as Record<string, string>[]).map((r) => ({ id: "e" + r.id, source: "epc" as const, caseName: epcName.get(r.business_id) || "—", author: r.author_name || "Someone", text: r.comment_text, at: r.created_at, href: `/admin/epc/${r.business_id}/view` })),
      ...((dc.data ?? []) as Record<string, string>[]).map((r) => ({ id: "d" + r.id, source: "lead" as const, caseName: leadName.get(r.lead_id) || "—", author: r.author_name || "Someone", text: r.comment_text, at: r.created_at, href: `/admin/lead/${r.lead_id}/view` })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 30);

    setItems(merged);
    const maxTs = merged.length ? new Date(merged[0].at).getTime() : 0;
    if (!first.current && maxTs > lastMax.current && maxTs > seen) ring();
    first.current = false;
    lastMax.current = maxTs;
  }, [me, seen]);

  useEffect(() => { void load(); const t = setInterval(() => void load(), 25000); return () => clearInterval(t); }, [load]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const unread = useMemo(() => items.filter((n) => new Date(n.at).getTime() > seen).length, [items, seen]);

  function markAllRead() { const now = Date.now(); localStorage.setItem(SEEN_KEY, String(now)); setSeen(now); }
  function openItem(n: Notif) { markAllRead(); setOpen(false); router.push(n.href); }

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => { setOpen((o) => !o); if (!open && unread) { /* keep unread until read */ } }}
        aria-label="Notifications" title="Notifications from your team"
        className="relative grid place-items-center w-9 h-9 rounded-lg border border-line bg-white hover:bg-bg-tint transition-colors">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15241d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-[#dc2626] text-white text-[10px] font-bold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] max-h-[420px] overflow-y-auto rounded-xl border border-line bg-white shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line sticky top-0 bg-white">
            <span className="text-[13px] font-bold text-text">Notifications</span>
            {unread > 0
              ? <button type="button" onClick={markAllRead} className="text-[11px] font-semibold text-[#178a5c] hover:underline">Mark all read</button>
              : <span className="text-[11px] text-text-muted">You're all caught up</span>}
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-6 text-[12px] text-text-muted text-center">No comments on your cases yet.<br />When your team comments, it shows here.</div>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n) => {
                const isNew = new Date(n.at).getTime() > seen;
                const tint = SRC_TINT[n.source];
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => openItem(n)}
                      className={"w-full text-left px-4 py-2.5 hover:bg-bg-tint transition-colors " + (isNew ? "bg-[#f0faf5]" : "")}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {isNew && <span className="w-2 h-2 rounded-full bg-[#178a5c] shrink-0" />}
                        <span className="text-[12px] font-bold text-text truncate">{n.author}</span>
                        <span className="text-[11px] text-text-muted">commented on</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded ml-auto shrink-0" style={{ backgroundColor: tint.bg, color: tint.fg }}>{SRC_LABEL[n.source]}</span>
                      </div>
                      <div className="text-[12px] font-semibold text-text truncate">{n.caseName}</div>
                      <div className="text-[12px] text-text-mid line-clamp-2 mt-0.5">{n.text}</div>
                      <div className="text-[10px] text-text-muted mt-1">{ago(n.at)}</div>
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
