"use client";

// Ops Board — a kanban of every ACTIVE case (loan / insurance / lead / EPC
// onboarding) across the business, grouped by pipeline stage. One place to see
// "who owns what and what's stuck". A MAIN_ADMIN sees all cases + owner tabs;
// an OPERATIONS_USER (RM) sees only their own (RLS-enforced, 0067). Clicking a
// card opens a side panel with the case details, actions that persist + log,
// and the case's activity. Footer surfaces SLA breaches + monthly disbursement.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar from "@/components/AdminSidebar";
import NotificationBell from "@/components/NotificationBell";
import LoanLenderPickerModal, { type PickerLender } from "@/components/LoanLenderPickerModal";
import Select from "@/components/ui/Select";
import { supabase } from "@/lib/supabase";
import { getBusiness, getToken, greetingName } from "@/lib/auth";
import { loadOpsCases, columnsFor, SOURCE_META, type OpsCase, type TeamUser, type CaseSource } from "@/lib/ops-board";
import { DEFAULT_LOAN_LENDERS, LOAN_LENDER_COLS, lendersWithDocs, type LoanLenderRow } from "@/lib/loan-lenders";
import { logLoanActivity } from "@/lib/loanAudit";

// ── Loan pipeline: forward-only stage locking (no going back, no skipping —
// except a lender decision straight after Send to Lender). Moves into these
// stages open the loan's own workflow screen (change #10). ──
const LOAN_FORWARD: Record<string, string[]> = {
  ready_login: ["send_lender", "abort"],
  send_lender: ["docs_pending", "approved_rejected", "abort"],
  docs_pending: ["approved_rejected", "abort"],
  approved_rejected: ["phase1", "abort"],
  phase1: ["abort"],
  abort: [],
};
// Loan target columns whose drop opens the real loan screen instead of a plain
// status write. (docs_pending is a simple "put on hold" status move.)
const LOAN_OPENS_SCREEN = new Set(["send_lender", "approved_rejected", "phase1", "abort"]);

// Non-loan columns a drag can't set directly.
const UNDRAGGABLE: Record<string, string> = {
  rejected: "Reject a case from its own page (with a reason).",
  converted: "Convert a lead to a loan from the lead’s page.",
};

// Can a case be dragged into `target`? Loans are forward-only (locked); other
// sources keep their simple status moves.
function stageCheck(c: OpsCase, target: string, label: string): { ok: boolean; msg: string } {
  if (target === c.column) return { ok: false, msg: "Already in this stage." };
  if (c.source === "loan") {
    const allowed = LOAN_FORWARD[c.column ?? ""] ?? [];
    if (!allowed.includes(target)) return { ok: false, msg: "Stages are locked — a loan can only move forward to its next stage (no going back or skipping ahead)." };
    if (target === "phase1" && c.outcome === "rejected") return { ok: false, msg: "A rejected loan can’t move to disbursement." };
    if (target === "send_lender") return { ok: true, msg: `Send ${c.name}’s documents to a lender — pick which one next.` };
    if (target === "approved_rejected") return { ok: true, msg: `Record the lender’s decision for ${c.name} — approved or rejected?` };
    if (target === "phase1") return { ok: true, msg: `Open ${c.name}’s disbursement screen (RFD + 1st-tranche docs)?` };
    if (target === "abort") return { ok: true, msg: `Open ${c.name} to abort it (with a reason)?` };
    return { ok: true, msg: `Move ${c.name} to “Docs Pending” (put on hold to collect documents)?` };
  }
  if (c.source === "insurance" && target === "rejected") return { ok: false, msg: UNDRAGGABLE.rejected };
  if (c.source === "epc") {
    if (target === "send_lender" || target === "rejected") return { ok: false, msg: "Lender / rejection steps are done from the EPC profile." };
    if (target === "unseen" || target === "doc_uploaded") return { ok: false, msg: "This stage is set automatically as the EPC fills their profile." };
  }
  if (c.source === "lead" && target === "converted") return { ok: false, msg: UNDRAGGABLE.converted };
  const forward = ["review_cc", "review", "approved"].includes(target);
  if (forward && c.blocker && /pend|await|missing|require|incomplete|\bdoc/i.test(c.blocker)) {
    return { ok: false, msg: `Can’t move to “${label}” — documents pending: “${c.blocker}”. Clear it first (mark “Doc received”).` };
  }
  return { ok: true, msg: `Move “${c.name}” to “${label}”? The status panel opens so you can mark it.` };
}

export default function OpsBoardPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

// Attention outline: green = up to date, yellow = watch (aging / on hold /
// blocked), red = overdue (idle ≥ SLA). Used for EPC / insurance / lead.
function attention(c: OpsCase, sla: number): "green" | "yellow" | "red" {
  if (c.idleDays >= sla) return "red";
  if (c.idleDays >= Math.max(1, Math.ceil(sla / 2)) || c.onHold || !!c.blocker) return "yellow";
  return "green";
}
// Loan per-stage outline thresholds, in HOURS: [yellow-from, red-from] measured
// from when the loan entered its current stage (stageHours).
const LOAN_OUTLINE: Record<string, [number, number]> = {
  ready_login: [72, 168],       // >3d → yellow, >7d → red
  send_lender: [24, 48],        // >24h → yellow, >48h → red
  docs_pending: [24, 48],       // >24h → yellow, >48h → red
  approved_rejected: [24, 48],  // approved cards: >24h → yellow, >48h → red
  phase1: [600, 1080],          // >25d → yellow, ≥45d → red
};
function loanOutline(c: OpsCase): "green" | "yellow" | "red" | "neutral" {
  if (c.column === "abort") return "neutral";
  if (c.column === "approved_rejected" && c.outcome === "rejected") return "neutral"; // rejected: pale-red fill + sinks to bottom
  const t = LOAN_OUTLINE[c.column ?? ""];
  if (!t) return "green";
  if (c.stageHours >= t[1]) return "red";
  if (c.stageHours >= t[0]) return "yellow";
  return "green";
}
const OUTLINE: Record<"green" | "yellow" | "red" | "neutral", string> = { green: "#16a34a", yellow: "#eab308", red: "#dc2626", neutral: "#cbd5e1" };

function fmt(v: number): string {
  if (!v) return "₹0";
  if (v >= 1e7) return "₹" + (v / 1e7).toFixed(2) + " Cr";
  if (v >= 1e5) return "₹" + (v / 1e5).toFixed(1) + " L";
  return "₹" + v.toLocaleString("en-IN");
}
function monthKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

type Activity = { action: string; new_value: string | null; created_at: string; actor: { contact_name: string | null } | null };

function Inner() {
  const router = useRouter();
  const me = getBusiness();
  const isMainAdmin = me?.role === "MAIN_ADMIN" || (me?.business_type === "admin" && !me?.role && (me?.allowed_modules ?? []).includes("analytics"));
  const isManager = me?.role === "MANAGER";
  const canOversee = isMainAdmin || isManager; // sees owner tabs + workload strip

  const [cases, setCases] = useState<OpsCase[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  // No mixed "All" view — everyone works one source at a time (default: loans).
  const [srcFilter, setSrcFilter] = useState<"all" | CaseSource>("loan");
  const [ownerFilter, setOwnerFilter] = useState<string>("all"); // 'all' | userId | 'unassigned'
  const [activity, setActivity] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [touches, setTouches] = useState(0);
  const [sla, setSla] = useState<number>(() => (typeof window !== "undefined" ? Number(localStorage.getItem("opsboard.sla")) : 0) || 3);
  const [target, setTarget] = useState<number>(() => (typeof window !== "undefined" ? Number(localStorage.getItem("opsboard.target")) : 0) || 65);
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<"none" | "myoverdue" | "unassigned" | "breaches">("none");
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ caseId: string; column: string } | null>(null);
  // Inline lender picker (change: loan lender/decision popups render ON the board).
  const [picker, setPicker] = useState<{ c: OpsCase; mode: "docsent" | "approve" | "reject"; rows: LoanLenderRow[] } | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [bannerSeen, setBannerSeen] = useState(false);

  const reload = useCallback(async () => {
    const { cases, users } = await loadOpsCases();
    setCases(cases);
    setUsers(users);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("opsboard.sla", String(sla)); }, [sla]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("opsboard.target", String(target)); }, [target]);

  // Load the selected case's activity trail.
  useEffect(() => {
    if (!sel) { setActivity([]); return; }
    void (async () => {
      const { data } = await supabase()
        .from("user_activity_log")
        .select("action, new_value, created_at, actor:actor_user_id(contact_name)")
        .eq("record_id", sel)
        .order("created_at", { ascending: false })
        .limit(40);
      setActivity((data ?? []) as unknown as Activity[]);
    })();
  }, [sel, touches]);

  // Each source shows its OWN columns; the mixed "All" view maps onto ALL_COLS.
  const activeCols = columnsFor(srcFilter);
  const colOf = useCallback((c: OpsCase) => (srcFilter === "all" ? c.allColumn : c.column), [srcFilter]);
  const canDrag = srcFilter !== "all"; // stage moves only make sense in a single-source pipeline

  const visible = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return cases.filter((c) => {
      if (srcFilter !== "all" && c.source !== srcFilter) return false;
      if ((srcFilter === "all" ? c.allColumn : c.column) == null) return false; // off this board
      if (canOversee && ownerFilter !== "all") {
        if (ownerFilter === "unassigned") { if (c.ownerUserId) return false; }
        else if (c.ownerUserId !== ownerFilter) return false;
      }
      if (quick === "myoverdue" && !(c.ownerUserId === me?.id && c.idleDays >= sla)) return false;
      if (quick === "unassigned" && c.ownerUserId) return false;
      if (quick === "breaches" && c.idleDays < sla) return false;
      if (ql && !`${c.name} ${c.lender ?? ""} ${c.blocker ?? ""} ${c.ownerName ?? ""}`.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [cases, srcFilter, ownerFilter, canOversee, quick, sla, q, me]);

  const byCol = (k: string) => visible.filter((c) => colOf(c) === k).sort((a, b) => {
    // Rejected cases sink to the bottom of the column; otherwise oldest-first.
    const ar = a.outcome === "rejected" ? 1 : 0, br = b.outcome === "rejected" ? 1 : 0;
    if (ar !== br) return ar - br;
    return b.idleDays - a.idleDays;
  });
  const breaches = visible.filter((c) => c.idleDays >= sla).length;
  const thisMonth = `${new Date().getFullYear()}-${new Date().getMonth()}`;
  const mtd = cases.reduce((sum, c) => sum + (monthKey(c.disbursedThisMonthAt) === thisMonth ? c.disbursed : 0), 0);
  const pct = Math.min(100, Math.round(mtd / (target * 1e5) * 100));
  const selCase = cases.find((c) => c.id === sel) || null;

  async function runAction(target: OpsCase, action: string, payload?: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/ops/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ source: target.source, id: target.id, action, payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { alert(j?.error || "Action failed."); return false; }
      setTouches((t) => t + 1);
      await reload();
      return true;
    } finally { setBusy(false); }
  }
  async function act(action: string, payload?: Record<string, unknown>) {
    if (selCase) await runAction(selCase, action, payload);
  }

  // Drag-drop: dropping a card on a column requests a stage move. Only enabled
  // in a single-source view, where a card's column is its source column.
  function onDropTo(col: string) {
    const c = cases.find((x) => x.id === dragId);
    setDragId(null);
    if (c && c.column !== col) setDrop({ caseId: c.id, column: col });
  }
  // Load a loan's lender rows, then open the matching picker ON the board.
  async function openLenderPicker(c: OpsCase, mode: "docsent" | "approve" | "reject") {
    const { data } = await supabase()
      .from("loan_application_lenders").select(LOAN_LENDER_COLS)
      .eq("application_id", c.id).order("docs_sent_at", { ascending: true });
    setPicker({ c, mode, rows: (data ?? []) as unknown as LoanLenderRow[] });
  }

  async function confirmDrop(decision?: "approved" | "rejected") {
    if (!drop) return;
    const c = cases.find((x) => x.id === drop.caseId);
    if (!c) { setDrop(null); return; }
    if (c.source === "loan") {
      const col = drop.column;
      // The lender picker + reject popup happen ON the board; only Approve then
      // opens the approval-details page, and 1st-Phase opens disbursement.
      if (col === "send_lender") { setDrop(null); await openLenderPicker(c, "docsent"); return; }
      if (col === "approved_rejected") { setDrop(null); await openLenderPicker(c, decision === "rejected" ? "reject" : "approve"); return; }
      if (col === "phase1") { sessionStorage.setItem("ccReturnTo", "/admin/board"); setDrop(null); router.push(`/admin/app/${c.id}/disbursement` as unknown as string); return; }
      if (col === "abort") { sessionStorage.setItem("ccReturnTo", "/admin/board"); setDrop(null); router.push(`/admin/app/${c.id}/view?do=abort` as unknown as string); return; }
    }
    // Simple status move (loan → Docs Pending / hold, or an EPC / insurance / lead stage).
    const ok = await runAction(c, "set_stage", { column: drop.column });
    if (ok) setSel(c.id); // open the panel so they can mark it
    setDrop(null);
  }

  // Picker confirm handlers — mirror the loan view page's own write logic.
  async function pickerDocsSent(lender: PickerLender) {
    if (!picker) return;
    const { c, rows } = picker;
    setPickerBusy(true);
    try {
      const now = new Date().toISOString();
      const existing = rows.find((r) => r.lender_key === lender.key);
      if (existing) { if (!existing.docs_sent_at) await supabase().from("loan_application_lenders").update({ docs_sent_at: now }).eq("id", existing.id); }
      else await supabase().from("loan_application_lenders").insert({ application_id: c.id, lender_key: lender.key, lender_label: lender.label, docs_sent_at: now });
      await supabase().from("epc_applications").update({ status: "docs_sent", docs_sent_at: now, last_updated_by_user_id: me?.id ?? null }).eq("id", c.id);
      await logLoanActivity(c.id, "status_change", { detail: `Docs sent to ${lender.label}` });
      setPicker(null); setTouches((t) => t + 1); await reload();
    } catch (e) { alert("Couldn’t record: " + (e as Error).message); }
    finally { setPickerBusy(false); }
  }
  async function pickerReject(lender: PickerLender, reason?: string) {
    if (!picker) return;
    const { c, rows } = picker;
    setPickerBusy(true);
    try {
      const now = new Date().toISOString();
      const existing = rows.find((r) => r.lender_key === lender.key);
      const lp = { rejected_at: now, rejection_reason: reason || null, approved_at: null, approval_details: null };
      if (existing) await supabase().from("loan_application_lenders").update(lp).eq("id", existing.id);
      else await supabase().from("loan_application_lenders").insert({ application_id: c.id, lender_key: lender.key, lender_label: lender.label, docs_sent_at: now, ...lp });
      await supabase().from("epc_applications").update({ status: "rejected", rejected_at: now, rejected_lender: lender.key, rejection_reason: reason || null, last_updated_by_user_id: me?.id ?? null }).eq("id", c.id);
      await logLoanActivity(c.id, "rejected", { detail: `Rejected by ${lender.label}${reason ? ` — ${reason}` : ""}` });
      setPicker(null); setTouches((t) => t + 1); await reload();
    } catch (e) { alert("Couldn’t record: " + (e as Error).message); }
    finally { setPickerBusy(false); }
  }
  function pickerApprove(lender: PickerLender) {
    if (!picker) return;
    const id = picker.c.id;
    sessionStorage.setItem("ccReturnTo", "/admin/board");
    setPicker(null);
    router.push(`/admin/app/${id}/approval?lender=${lender.key}&label=${encodeURIComponent(lender.label)}` as unknown as string);
  }

  // RMs an overseer manages: a MANAGER sees only their own RMs; MAIN_ADMIN all.
  const myRms = useMemo(() => {
    const rms = users.filter((u) => u.role === "OPERATIONS_USER");
    return isManager ? rms.filter((u) => u.parentUserId === me?.id) : rms;
  }, [users, isManager, me]);

  // People whose boards this overseer can switch between. Admin sees EVERY
  // manager + RM (so Admin can open Manish's and Malvika's boards); a Manager
  // sees their own RMs.
  const boardPeople = useMemo(() => {
    if (isMainAdmin) return users.filter((u) => u.role === "MANAGER" || u.role === "OPERATIONS_USER");
    if (isManager) return users.filter((u) => u.role === "OPERATIONS_USER" && u.parentUserId === me?.id);
    return [];
  }, [users, isMainAdmin, isManager, me]);

  const ownerTabs = useMemo(
    () => [{ id: "all", name: "All" }, ...boardPeople.map((u) => ({ id: u.id, name: u.name + (u.role === "MANAGER" ? " (Mgr)" : "") })), { id: "unassigned", name: "Unassigned" }],
    [boardPeople],
  );

  // Where can THIS user reassign a case? Admin→anyone; Manager→self or own RMs;
  // RM→up to their manager only.
  const reassignOptions = useMemo(() => {
    if (isMainAdmin) return users.map((u) => ({ value: u.id, label: u.name + (u.role === "MANAGER" ? " · Manager" : u.role === "MAIN_ADMIN" ? " · Admin" : "") }));
    if (isManager) return [{ value: me!.id, label: (me?.contact_name || "Me") + " · me" }, ...myRms.map((u) => ({ value: u.id, label: u.name }))];
    const mgr = users.find((u) => u.id === me?.parent_user_id);
    return mgr ? [{ value: mgr.id, label: mgr.name + " · send up ↑" }] : [];
  }, [users, isMainAdmin, isManager, myRms, me]);

  // Per-RM workload for the overseer strip.
  const thisMonthKey = `${new Date().getFullYear()}-${new Date().getMonth()}`;
  const workload = useMemo(() => boardPeople.map((u) => {
    const own = cases.filter((c) => c.column != null && c.ownerUserId === u.id);
    const done = cases.filter((c) => c.ownerUserId === u.id && monthKey(c.disbursedThisMonthAt) === thisMonthKey).length;
    return { id: u.id, name: u.name, active: own.length, breaches: own.filter((c) => c.idleDays >= sla).length, oldest: own.reduce((m, c) => Math.max(m, c.idleDays), 0), done };
  }), [boardPeople, cases, sla, thisMonthKey]);

  return (
    <div className="min-h-screen bg-bg-soft md:flex">
      <AdminSidebar active="board" />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="px-4 sm:px-6 py-5 border-b border-line bg-white">
          <p className="text-[15px] font-semibold text-text mb-2">
            Hi <span className="font-bold text-[#178a5c]">{greetingName(me)}</span>
          </p>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <span className="inline-block w-1.5 h-7 rounded-full" style={{ backgroundColor: "#0f766e" }} />
              <h1 className="font-display text-[22px] sm:text-[26px] font-bold text-text">
                Task Manager <span className="text-text-muted font-medium text-[15px]">· {visible.length} active</span>
              </h1>
              {!isMainAdmin && <span className="text-[12px] text-text-muted">(your cases)</span>}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <NotificationBell />
              <label className="text-[12px] text-text-muted flex items-center gap-1.5">SLA
                <input type="number" min={1} max={60} value={sla} onChange={(e) => setSla(Math.max(1, Number(e.target.value) || 3))}
                  className="w-14 border border-line rounded-md px-2 py-1 text-[13px]" /> d</label>
              <label className="text-[12px] text-text-muted flex items-center gap-1.5">Target
                <input type="number" min={1} max={999} value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 65))}
                  className="w-16 border border-line rounded-md px-2 py-1 text-[13px]" /> L</label>
            </div>
          </div>
          {/* Filters */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {/* Source filter */}
            <div className="inline-flex border border-line rounded-lg overflow-hidden">
              {(["loan", "insurance", "lead", "epc"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setSrcFilter(k)}
                  className={["px-3 py-1.5 text-[12px] font-semibold border-r border-line last:border-r-0", srcFilter === k ? "text-white" : "text-text-mid bg-white hover:bg-bg-tint"].join(" ")}
                  style={srcFilter === k ? { backgroundColor: SOURCE_META[k].color } : undefined}>
                  {SOURCE_META[k].label}
                </button>
              ))}
            </div>
            {/* Owner tabs — overseers (Admin sees all RMs, Manager sees own team) */}
            {canOversee && (
              <div className="inline-flex border border-line rounded-lg overflow-hidden ml-1">
                {ownerTabs.map((o) => (
                  <button key={o.id} type="button" onClick={() => setOwnerFilter(o.id)}
                    className={["px-3 py-1.5 text-[12px] font-semibold border-r border-line last:border-r-0", ownerFilter === o.id ? "bg-[#178a5c] text-white" : "text-text-mid bg-white hover:bg-bg-tint"].join(" ")}>
                    {o.name}
                  </button>
                ))}
              </div>
            )}
            {/* Search + quick filters */}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cases…"
              className="border border-line rounded-lg px-3 py-1.5 text-[12px] w-40 ml-1" />
            {([["myoverdue", "My overdue"], ["unassigned", "Unassigned"], ["breaches", "Breaches"]] as const).map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setQuick(quick === k ? "none" : k)}
                className={["px-3 py-1.5 text-[12px] font-semibold rounded-lg border", quick === k ? "bg-[#b45309] text-white border-[#b45309]" : "bg-white text-text-mid border-line hover:bg-bg-tint"].join(" ")}>
                {lbl}
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 flex min-h-0">
          {/* Kanban */}
          <div className="flex-1 overflow-x-auto p-4 sm:p-6">
            {!canOversee && !loading && !bannerSeen && (() => {
              const mine = cases.filter((c) => c.column != null && c.ownerUserId === me?.id);
              const b = mine.filter((c) => c.idleDays >= sla).length;
              return (
                <div className="flex items-center justify-between gap-3 mb-4 rounded-lg border border-[#cdeadd] bg-[#f0faf5] px-4 py-2.5">
                  <span className="text-[13px] text-[#0f3d2e]">
                    👋 You have <strong>{mine.length}</strong> active {mine.length === 1 ? "case" : "cases"}
                    {b > 0 && <> · <strong className="text-[#b45309]">{b} need attention</strong> (idle ≥ {sla}d)</>}
                  </span>
                  <button type="button" onClick={() => setBannerSeen(true)} className="text-[#5a8a76] hover:text-[#0f3d2e] text-[16px] leading-none">✕</button>
                </div>
              );
            })()}
            {canOversee && !loading && workload.length > 0 && (
              <div className="flex gap-2 mb-4 flex-wrap">
                {workload.map((w) => (
                  <div key={w.id} className="rounded-lg border border-line bg-white px-3 py-2 min-w-[132px]">
                    <div className="text-[12px] font-semibold text-text">{w.name}</div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      {w.active} active
                      {w.breaches > 0 && <> · <span className="text-[#b45309] font-semibold">{w.breaches} ⚠</span></>}
                      {w.oldest > 0 && <> · oldest {w.oldest}d</>}
                      {w.done > 0 && <> · <span className="text-[#178a5c] font-semibold">{w.done} done</span></>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {loading ? (
              <p className="text-text-muted">Loading…</p>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${activeCols.length}, minmax(184px, 1fr))` }}>
                {activeCols.map((col) => {
                  const items = byCol(col.key);
                  return (
                    <div key={col.key}
                      onDragOver={(e) => { if (dragId && canDrag) e.preventDefault(); }}
                      onDrop={(e) => { e.preventDefault(); if (canDrag) onDropTo(col.key); }}
                      className={dragId && canDrag ? "rounded-lg outline-dashed outline-1 outline-[#9ccbb7] outline-offset-2" : ""}>
                      <div className="flex items-center justify-between pb-2 mb-2 border-b-2 border-line">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-text-mid">{col.label}</span>
                        <span className="text-[12px] font-semibold text-text-muted">{items.length}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {items.map((c) => {
                          const sm = SOURCE_META[c.source];
                          // Loans use per-stage timing (change #2/3/5/7); other sources use idle-vs-SLA.
                          const lvl = c.source === "loan" ? loanOutline(c) : attention(c, sla);
                          const late = lvl === "red";
                          // Approved cards get a light-green wash, rejected a pale-red one.
                          const fill = c.outcome === "approved" ? "#eaf8f0" : c.outcome === "rejected" ? "#fbecec" : "#ffffff";
                          return (
                            <button key={c.source + c.id} type="button" onClick={() => setSel(c.id)}
                              draggable={canDrag} onDragStart={(e) => { if (!canDrag) { e.preventDefault(); return; } setDragId(c.id); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", c.id); } catch { /* ignore */ } }}
                              className={"text-left rounded-lg border-2 p-2.5 transition-shadow" + (canDrag ? " cursor-grab active:cursor-grabbing" : " cursor-pointer")}
                              style={{ borderColor: OUTLINE[lvl], backgroundColor: fill, boxShadow: sel === c.id ? "0 0 0 2px #178a5c" : undefined }}>
                              <div className="flex items-center justify-between gap-1.5">
                                <strong className="text-[13px] text-text truncate">{c.name}</strong>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: sm.tint, color: sm.color }}>{sm.label}</span>
                              </div>
                              <div className="text-[11px] text-text-muted truncate mt-0.5">
                                {[c.amount ? fmt(c.amount) : null, c.lender, c.onHold ? "⏸ Hold" : null].filter(Boolean).join(" · ") || c.statusLabel}
                              </div>
                              {late && (
                                <div className="text-[11px] font-bold mt-1" style={{ color: "#b45309" }}>
                                  ⚠ {c.idleDays}d idle{c.blocker ? " · " + c.blocker.slice(0, 28) : ""}
                                </div>
                              )}
                              {isMainAdmin && c.ownerName && <div className="text-[10px] text-text-muted mt-0.5">{c.ownerName}</div>}
                            </button>
                          );
                        })}
                        {items.length === 0 && <div className="text-[11px] text-text-muted py-1">—</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Side panel */}
          {selCase && (
            <aside className="w-[340px] shrink-0 border-l border-line bg-white p-5 flex flex-col gap-3 overflow-y-auto sticky top-0 self-start max-h-screen">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-[18px] font-bold text-text truncate">{selCase.name}</h2>
                  <div className="text-[12px] text-text-muted mt-0.5">{SOURCE_META[selCase.source].label} · {selCase.statusLabel}</div>
                </div>
                <button type="button" onClick={() => setSel(null)} className="text-[18px] text-text-muted hover:text-text leading-none p-1">✕</button>
              </div>

              <div className="text-[13px] flex flex-col gap-1.5 border-t border-line pt-3">
                <Row k="Amount" v={selCase.amount ? fmt(selCase.amount) : "—"} />
                <Row k="Lender" v={selCase.lender || "—"} />
                <Row k="Owner" v={selCase.ownerName || "Unassigned"} />
                <Row k="Idle" v={selCase.idleDays + "d"} />
                {selCase.blocker && <div><span className="text-text-muted">Blocker:</span> {selCase.blocker}</div>}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button className="btn-act" disabled={busy} onClick={() => act("doc_received")}>Doc received</button>
                <button className="btn-act" disabled={busy} onClick={() => act("move_stage")}>Move stage →</button>
                {selCase.source === "loan" && (
                  <button className="btn-act" disabled={busy} onClick={() => {
                    const raw = window.prompt("Disbursement amount (₹):");
                    if (!raw) return;
                    const amount = Number(raw.replace(/[^\d.]/g, ""));
                    if (!amount) return;
                    const tranche = window.confirm("OK = 1st tranche · Cancel = 2nd tranche") ? 1 : 2;
                    void act("record_disbursement", { amount, tranche });
                  }}>Record disb ₹</button>
                )}
                <button className="btn-act ghost col-span-2 text-center" onClick={() => { sessionStorage.setItem("ccReturnTo", "/admin/board"); router.push(selCase.href as unknown as string); }}>Open full case ↗</button>
                {reassignOptions.length > 0 && (
                  <div className="col-span-2">
                    <div className="text-[11px] text-text-muted mb-1">{isMainAdmin || isManager ? "Reassign to" : "Send to senior ↑"}</div>
                    <Select value={selCase.ownerUserId ?? ""} disabled={busy}
                      onChange={(e) => void act("reassign", { assigned_to_user_id: e.target.value || null })}
                      placeholder="Select…"
                      options={[...(isMainAdmin ? [{ value: "", label: "Unassigned" }] : []), ...reassignOptions]} />
                  </div>
                )}
              </div>

              <div className="border-t border-line pt-3 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wide text-text-mid mb-2">Activity log</div>
                <div className="flex flex-col gap-1.5 text-[12px] text-text-mid">
                  {activity.length === 0 ? (
                    <div className="text-text-muted">No activity yet — actions log here with a timestamp.</div>
                  ) : activity.map((a, i) => (
                    <div key={i}>
                      <span className="font-semibold text-text">{a.actor?.contact_name || "—"}</span>
                      {" · "}<span>{prettyAction(a.action)}</span>{a.new_value ? " · " + a.new_value : ""}
                      <span className="text-text-muted"> · {when(a.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-line bg-white px-4 sm:px-6 py-3 flex items-center gap-6 flex-wrap text-[13px]">
          <span><strong style={{ color: "#b45309" }}>{breaches}</strong> SLA breach{breaches === 1 ? "" : "es"} (≥{sla}d)</span>
          <span><strong>{touches}</strong> action{touches === 1 ? "" : "s"} this session</span>
          <span className="flex items-center gap-2.5 text-[12px] text-text-muted">
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#16a34a" }} />up to date</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#eab308" }} />watch</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#dc2626" }} />overdue</span>
          </span>
          <div className="flex items-center gap-2.5 ml-auto min-w-[300px]">
            <span className="whitespace-nowrap">This month <strong>{fmt(mtd)}</strong> of ₹{target} L</span>
            <div className="flex-1 h-3 rounded-full bg-neutral-200"><div className="h-3 rounded-full" style={{ width: pct + "%", backgroundColor: "#178a5c" }} /></div>
          </div>
        </footer>
      </div>

      {/* Drag-drop confirmation + stage requirement */}
      {drop && (() => {
        const c = cases.find((x) => x.id === drop.caseId);
        if (!c) return null;
        const dropLabel = columnsFor(c.source).find((x) => x.key === drop.column)?.label || drop.column;
        const chk = stageCheck(c, drop.column, dropLabel);
        const isDecision = c.source === "loan" && drop.column === "approved_rejected";
        const opensScreen = c.source === "loan" && !!drop.column && LOAN_OPENS_SCREEN.has(drop.column);
        const title = !chk.ok ? "Can’t move there" : isDecision ? "Approved or rejected?" : opensScreen ? "Continue to the loan?" : "Move this case?";
        return (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={() => !busy && setDrop(null)}>
            <div className="w-full max-w-sm rounded-[12px] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="text-[15px] font-semibold text-text">{title}</div>
              <p className={"text-[13px] mt-2 " + (chk.ok ? "text-text-mid" : "text-red-700")}>{chk.msg}</p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button className="btn-act ghost" onClick={() => setDrop(null)} disabled={busy}>{chk.ok ? "Cancel" : "OK"}</button>
                {chk.ok && isDecision && (
                  <>
                    <button className="btn-act" onClick={() => void confirmDrop("rejected")} disabled={busy}>✕ Rejected</button>
                    <button className="btn-act primary" onClick={() => void confirmDrop("approved")} disabled={busy}>✓ Approved</button>
                  </>
                )}
                {chk.ok && !isDecision && (
                  <button className="btn-act primary" onClick={() => void confirmDrop()} disabled={busy}>
                    {busy ? "Working…" : opensScreen ? "Continue →" : "Yes, move"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Inline loan lender / decision popup — same modal the loan page uses. */}
      {picker && (() => {
        const rows = picker.rows;
        const available: PickerLender[] = [
          ...DEFAULT_LOAN_LENDERS,
          ...rows.filter((r) => !DEFAULT_LOAN_LENDERS.some((d) => d.key === r.lender_key)).map((r) => ({ key: r.lender_key, label: r.lender_label })),
        ].filter((l) => !rows.some((r) => r.lender_key === l.key && r.docs_sent_at));
        const withDocsOpts: PickerLender[] = lendersWithDocs(rows).map((r) => ({ key: r.lender_key, label: r.lender_label }));
        const m = picker.mode;
        return (
          <LoanLenderPickerModal
            open
            title={m === "docsent" ? "Send documents to a lender" : m === "approve" ? "Approve application" : "Reject application"}
            subtitle={m === "docsent" ? `For ${picker.c.name}. Pick the lender you’re sending the documents to.` : m === "approve" ? `For ${picker.c.name}. Which lender approved? You’ll fill in the approval details next.` : `For ${picker.c.name}. Which lender rejected?`}
            options={m === "docsent" ? available : withDocsOpts}
            allowAdd={m === "docsent"}
            needReason={m === "reject"}
            confirmLabel={m === "docsent" ? "Mark docs sent" : m === "approve" ? "Continue to details" : "Mark rejected"}
            tone={m === "docsent" ? "blue" : m === "approve" ? "green" : "red"}
            onClose={() => { if (!pickerBusy) setPicker(null); }}
            onConfirm={(l, reason) => (m === "docsent" ? pickerDocsSent(l) : m === "approve" ? pickerApprove(l) : pickerReject(l, reason))}
          />
        );
      })()}

      <style jsx>{`
        .btn-act { border: 1.5px solid var(--color-line, #e5e9e7); background: #fff; color: #15241d; border-radius: 6px; font-size: 12px; font-weight: 600; padding: 8px 10px; cursor: pointer; }
        .btn-act:hover { background: #f5f8f6; }
        .btn-act.primary { background: #178a5c; border-color: #178a5c; color: #fff; }
        .btn-act.ghost { color: #495650; }
        .btn-act:disabled { opacity: .6; cursor: default; }
      `}</style>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-text-muted">{k}</span><strong className="text-text">{v}</strong></div>;
}
function prettyAction(a: string): string {
  return ({ call: "logged a call", doc_received: "marked doc received", status_change: "moved stage", disbursement: "recorded disbursement", reassigned: "reassigned", assigned: "assigned", created: "created", updated: "updated" } as Record<string, string>)[a] || a;
}
function when(iso: string): string {
  const d = new Date(iso), diff = Date.now() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return d.toLocaleDateString("en-IN", { dateStyle: "medium" });
}
