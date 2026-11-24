"use client";

// Ops Board — a kanban of every ACTIVE case (loan / insurance / lead / EPC
// onboarding) across the business, grouped by pipeline stage. One place to see
// "who owns what and what's stuck". A MAIN_ADMIN sees all cases + owner tabs;
// an OPERATIONS_USER (RM) sees only their own (RLS-enforced, 0067). Clicking a
// card opens a side panel with the case details, actions that persist + log,
// and the case's comments. Footer surfaces SLA breaches + monthly disbursement.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar, { ACCENTS, SectionMark, themeStyle } from "@/components/AdminSidebar";
import NotificationBell from "@/components/NotificationBell";
import ReviewNotices from "@/components/ReviewNotices";
import Tranche2List from "@/components/Tranche2List";
import type { Tranche2 } from "@/lib/tranche2";
import type { PickerLender } from "@/components/LoanLenderPickerModal";
import Select from "@/components/ui/Select";
import Modal, { OVERLAY } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";
import { authHeaders, getBusiness, greetingName, isMainAdmin as isMainAdminUser } from "@/lib/auth";
import { loadOpsCases, columnsFor, SOURCE_META, type OpsCase, type TeamUser, type CaseSource } from "@/lib/ops-board";
import { PERIOD_OPTIONS, inPeriod, type Period } from "@/lib/period";
import { LOAN_LENDER_COLS, type LoanLenderRow } from "@/lib/loan-lenders";
import { useLenders } from "@/lib/lenders";
import { logLoanActivity } from "@/lib/loanAudit";
import { rupeesShort } from "@/lib/money";
import { fmtAgo } from "@/lib/dates";
// The board's parts (./_parts): case rules, the screen state, My Day, the card, the month cards, the side-panel details, the lender pop-up.
import { LOAN_OPENS_SCREEN, COMMENT_TBL, stageCheck, attention, loanOutline, nextAction, monthEnd, monthKey } from "./_parts/rules";
import { tmState, saveTm } from "./_parts/tm-state";
import { detectPendingDocs } from "./_parts/whatsapp";
import MyDayQueue from "./_parts/MyDayQueue";
import BoardCard from "./_parts/BoardCard";
import CaseDetails, { DETAIL_COLS } from "./_parts/CaseDetails";
import LenderPickerPopup from "./_parts/LenderPickerPopup";
import { MyMonthCard, WorkloadStrip } from "./_parts/MonthCards";

export default function OpsBoardPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const me = getBusiness();
  const isMainAdmin = isMainAdminUser(me);
  const isManager = me?.role === "MANAGER";
  const canOversee = isMainAdmin || isManager; // sees owner tabs + workload strip

  const [cases, setCases] = useState<OpsCase[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  // No mixed "All" view — everyone works one source at a time (default: loans).
  const [srcFilter, setSrcFilter] = useState<"all" | CaseSource>("loan");
  const [ownerFilter, setOwnerFilter] = useState<string>(isMainAdmin ? "all" : "me"); // 'me' | 'all' | userId | 'unassigned'
  const [myDayOwner, setMyDayOwner] = useState<string>(() => tmState().owner ?? "all"); // My Day (manager): 'all' team | 'me' | RM userId
  const [busy, setBusy] = useState(false);
  const [touches, setTouches] = useState(0);
  const sla = 1; // fixed at ≤1 day (backend only — no UI control, per spec)
  const [target, setTarget] = useState<number>(() => { try { return (typeof window !== "undefined" ? Number(localStorage.getItem("opsboard.target")) : 0) || 65; } catch { return 65; } });
  // The EPC tab's own target — a NUMBER of EPCs onboarded (approved) in the period.
  const [epcTarget, setEpcTarget] = useState<number>(() => { try { return (typeof window !== "undefined" ? Number(localStorage.getItem("opsboard.epcTarget")) : 0) || 10; } catch { return 10; } });
  const [q, setQ] = useState(() => tmState().q ?? "");
  // Period filter (by the case's boardDate — active cases carry into the current
  // month automatically). Default "Current Month"; persisted; "custom" uses
  // month-to-month pickers (boardFrom/boardTo as "YYYY-MM").
  const [boardPeriod, setBoardPeriod] = useState<Period>("month");
  const [boardFrom, setBoardFrom] = useState("");
  const [boardTo, setBoardTo] = useState("");
  // RMs / managers default to the "My Day" action queue; admins stay on the board.
  // Back from a case → the same view (and My Day's tabs / filters, see TmState).
  const [view, setView] = useState<"myday" | "board">(() => tmState().view ?? (isMainAdmin ? "board" : "myday"));
  useEffect(() => { saveTm({ view, owner: myDayOwner, q }); }, [view, myDayOwner, q]);
  const [quick, setQuick] = useState<"none" | "myoverdue" | "unassigned" | "breaches">("none");
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ caseId: string; column: string } | null>(null);
  // Inline lender picker (change: loan lender/decision popups render ON the board).
  const lenders = useLenders(); // the registry — every lender the portal works with
  const [picker, setPicker] = useState<{ c: OpsCase; mode: "docsent" | "approve" | "reject"; rows: LoanLenderRow[] } | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  // Side-panel comments + collapsible comment history.
  const [detail, setDetail] = useState<Record<string, any> | null>(null); // selected loan's full detail (on-demand)
  const [comments, setComments] = useState<{ id: string; author_name: string | null; comment_text: string; created_at: string }[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [showCmtHist, setShowCmtHist] = useState(false);
  // Side-panel view: "details" (full, with comments) vs "emi" (EMI-confirmation
  // view — same details but comments hidden, so it's clean to share/screenshot).
  const [panelTab, setPanelTab] = useState<"details" | "emi">("details");

  // force=true after any action so the board reflects the change immediately;
  // plain mount/navigation reuses the short (20s) cache to cut egress.
  const reload = useCallback(async (force = false) => {
    const { cases, users } = await loadOpsCases({ force });
    setCases(cases);
    setUsers(users);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // ── My Day writes (all one-shot, no polling — egress-conscious) ──
  const nowIso = () => new Date().toISOString();
  // Stamp "last contacted" when an RM calls / WhatsApps (preserves follow-up).
  const stampContact = useCallback(async (c: OpsCase) => {
    try {
      await supabase().from("ops_case_touch").upsert(
        { source: c.source, case_id: c.id, follow_up_at: c.followUpAt ?? null, last_contacted_at: nowIso(), updated_by: me?.id ?? null, updated_at: nowIso() },
        { onConflict: "source,case_id" });
      void reload(true);
    } catch { /* non-blocking */ }
  }, [me, reload]);
  // Set / clear a follow-up date (preserves last-contacted).
  const setFollowUp = useCallback(async (c: OpsCase, date: string | null) => {
    try {
      await supabase().from("ops_case_touch").upsert(
        { source: c.source, case_id: c.id, follow_up_at: date, last_contacted_at: c.lastContactedAt ?? null, updated_by: me?.id ?? null, updated_at: nowIso() },
        { onConflict: "source,case_id" });
      void reload(true);
    } catch { /* non-blocking */ }
  }, [me, reload]);
  // Add a note = a comment on the case (visible to everyone, same store).
  const addNote = useCallback(async (c: OpsCase, text: string) => {
    const meta = COMMENT_TBL[c.source];
    if (!meta || !text.trim()) return;
    try {
      await supabase().from(meta.table).insert({ [meta.key]: c.id, author_id: me?.id ?? null, author_name: me?.contact_name ?? "Admin", comment_text: text.trim() });
      void reload(true);
    } catch { /* non-blocking */ }
  }, [me, reload]);

  useEffect(() => { try { localStorage.setItem("opsboard.target", String(target)); } catch { /* ignore */ } }, [target]);
  useEffect(() => { try { localStorage.setItem("opsboard.epcTarget", String(epcTarget)); } catch { /* ignore */ } }, [epcTarget]);
  // Restore + persist the period choice (sticks until changed).
  useEffect(() => {
    try {
      const raw = localStorage.getItem("boardPeriod");
      if (raw) {
        const s = JSON.parse(raw) as { p?: Period; f?: string; t?: string };
        if (s.p) setBoardPeriod(s.p); if (s.f) setBoardFrom(s.f); if (s.t) setBoardTo(s.t);
      }
    } catch { /* ignore (legacy plain-string value) */ }
  }, []);
  const saveBoardPeriod = (p: Period, f: string, t: string) => { try { localStorage.setItem("boardPeriod", JSON.stringify({ p, f, t })); } catch { /* ignore */ } };
  const changeBoardPeriod = (p: Period) => { setBoardPeriod(p); saveBoardPeriod(p, boardFrom, boardTo); };
  const changeBoardFrom = (f: string) => { setBoardFrom(f); saveBoardPeriod(boardPeriod, f, boardTo); };
  const changeBoardTo = (t: string) => { setBoardTo(t); saveBoardPeriod(boardPeriod, boardFrom, t); };

  // Load the selected case's comments (per-source table) — once per opened card,
  // not on every board reload; a reply for a card no longer open is ignored.
  const selSource = cases.find((x) => x.id === sel)?.source ?? null;
  useEffect(() => {
    setShowCmtHist(false); setCommentText("");
    const meta = selSource ? COMMENT_TBL[selSource] : null;
    if (!sel || !meta) { setComments([]); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase().from(meta.table)
        .select("id, author_name, comment_text, created_at").eq(meta.key, sel)
        .order("created_at", { ascending: false }).limit(50);
      if (!cancelled) setComments((data ?? []) as typeof comments);
    })();
    return () => { cancelled = true; };
  }, [sel, selSource]);

  async function addComment() {
    const c = cases.find((x) => x.id === sel);
    const meta = c ? COMMENT_TBL[c.source] : null;
    if (!sel || !meta || !commentText.trim()) return;
    setCommentBusy(true);
    try {
      await supabase().from(meta.table).insert({ [meta.key]: sel, author_id: me?.id ?? null, author_name: me?.contact_name ?? "Admin", comment_text: commentText.trim() });
      setCommentText("");
      const { data } = await supabase().from(meta.table)
        .select("id, author_name, comment_text, created_at").eq(meta.key, sel)
        .order("created_at", { ascending: false }).limit(50);
      setComments((data ?? []) as typeof comments);
    } catch (e) { alert("Couldn’t post comment: " + (e as Error).message); }
    finally { setCommentBusy(false); }
  }

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
        else if (ownerFilter === "me") { if (c.ownerUserId !== me?.id) return false; }
        else if (c.ownerUserId !== ownerFilter) return false;
      }
      if (quick === "myoverdue" && !(c.ownerUserId === me?.id && c.idleDays >= sla)) return false;
      if (quick === "unassigned" && c.ownerUserId) return false;
      if (quick === "breaches" && c.idleDays < sla) return false;
      if (boardPeriod === "custom") {
        const from = boardFrom ? `${boardFrom}-01` : "";
        const to = boardTo ? monthEnd(boardTo) : "";
        if ((from || to) && !inPeriod(c.boardDate, "custom", from, to)) return false;
      } else if (boardPeriod !== "all" && !inPeriod(c.boardDate, boardPeriod)) return false;
      if (ql && !`${c.name} ${c.lender ?? ""} ${c.blocker ?? ""} ${c.ownerName ?? ""}`.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [cases, srcFilter, ownerFilter, canOversee, quick, sla, q, me, boardPeriod, boardFrom, boardTo]);

  // Urgency rank for ordering: RED outline first, then yellow, then green, then
  // neutral (abort), with rejected always at the very bottom. Within the same
  // colour, the case that has sat LONGEST in this stage rises to the top — so
  // the most urgent work is always at the top of every column.
  const outlineRank = useCallback((c: OpsCase) => {
    if (c.outcome === "rejected") return 4;
    const lvl = c.source === "loan" ? loanOutline(c) : attention(c, sla);
    return lvl === "red" ? 0 : lvl === "yellow" ? 1 : lvl === "green" ? 2 : 3;
  }, [sla]);
  const createdMs = (c: OpsCase) => (c.createdAt ? new Date(c.createdAt).getTime() : 0);
  const byCol = (k: string) => {
    const items = visible.filter((c) => colOf(c) === k);
    // Leads are ordered newest-first (most recent lead on top) — reversed from
    // the urgency/longest-in-stage ordering the other pipelines use.
    if (srcFilter === "lead") return items.sort((a, b) => createdMs(b) - createdMs(a));
    return items.sort((a, b) => {
      const ra = outlineRank(a), rb = outlineRank(b);
      if (ra !== rb) return ra - rb;
      return b.stageHours - a.stageHours; // longest in this stage first
    });
  };

  // "My Day" queue — the RM's OWN cases that need action, across all sources,
  // ranked most-urgent first (red → yellow → green, longest-in-stage on top).
  const breaches = visible.filter((c) => c.idleDays >= sla).length;
  // Business disbursed within the SELECTED board period — the 1st disbursement
  // only, in the month it was ACTUALLY paid, so changing the period dropdown (Previous
  // month, All time, custom) always recomputes the real payout for that window.
  const inSelPeriod = (d: string | null) =>
    boardPeriod === "all" ? true
    : boardPeriod === "custom" ? inPeriod(d, "custom", boardFrom ? `${boardFrom}-01` : "", boardTo ? monthEnd(boardTo) : "")
    : inPeriod(d, boardPeriod);
  const mtd = cases.reduce((sum, c) => sum + c.tranches.reduce((s, t) => s + (t.phase === 1 && inSelPeriod(t.date) ? t.amount : 0), 0), 0);
  // EPC tab: EPCs onboarded (approved) in the period — the board's own Approved
  // column, dated the way the board files them (no extra request).
  const epcTab = srcFilter === "epc";
  const onboarded = cases.filter((c) => c.source === "epc" && c.column === "approved" && inSelPeriod(c.boardDate)).length;
  const pct = epcTab
    ? Math.min(100, Math.round(onboarded / Math.max(1, epcTarget) * 100))
    : Math.min(100, Math.round(mtd / (target * 1e5) * 100));
  const periodLabel = boardPeriod === "custom"
    ? (boardFrom || boardTo ? `${boardFrom || "…"} → ${boardTo || "…"}` : "Custom")
    : (PERIOD_OPTIONS.find((o) => o.value === boardPeriod)?.label ?? "This month");
  const selCase = cases.find((c) => c.id === sel) || null;

  // Fetch the selected LOAN's full detail on demand (one small query per open —
  // keeps it off the board list query).
  const selId = selCase?.id ?? null;
  const selIsLoan = selCase?.source === "loan";
  // A freshly-opened case always starts on the full Details view.
  useEffect(() => { setPanelTab("details"); }, [selId]);
  useEffect(() => {
    if (!selId || !selIsLoan) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    void (async () => {
      const { data } = await supabase().from("epc_applications").select(DETAIL_COLS).eq("id", selId).maybeSingle();
      if (!cancelled) setDetail((data as Record<string, any>) ?? {});
    })();
    return () => { cancelled = true; };
  }, [selId, selIsLoan]);

  async function runAction(target: OpsCase, action: string, payload?: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/ops/action", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ source: target.source, id: target.id, action, payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { alert(j?.error || "Action failed."); return false; }
      setTouches((t) => t + 1);
      await reload(true);
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

  async function confirmDrop() {
    if (!drop) return;
    const c = cases.find((x) => x.id === drop.caseId);
    if (!c) { setDrop(null); return; }
    if (c.source === "loan") {
      const col = drop.column;
      // The lender picker + reject popup happen ON the board; only Approve then
      // opens the approval-details page, and 1st-Phase opens disbursement.
      if (col === "send_lender") { setDrop(null); await openLenderPicker(c, "docsent"); return; }
      if (col === "approved" || col === "rejected") { setDrop(null); await openLenderPicker(c, col === "rejected" ? "reject" : "approve"); return; }
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
      if (existing) {
        if (!existing.docs_sent_at) {
          const { error } = await supabase().from("loan_application_lenders").update({ docs_sent_at: now }).eq("id", existing.id);
          if (error) throw new Error(error.message);
        }
      } else {
        const { error } = await supabase().from("loan_application_lenders").insert({ application_id: c.id, lender_key: lender.key, lender_label: lender.label, docs_sent_at: now });
        if (error) throw new Error(error.message);
      }
      const { error } = await supabase().from("epc_applications").update({ status: "docs_sent", docs_sent_at: now, last_updated_by_user_id: me?.id ?? null }).eq("id", c.id);
      if (error) throw new Error(error.message);
      await logLoanActivity(c.id, "status_change", { detail: `Docs sent to ${lender.label}` });
      setPicker(null); setTouches((t) => t + 1); await reload(true);
    } catch (e) { alert("Couldn’t record: " + (e as Error).message); }
    finally { setPickerBusy(false); }
  }
  async function pickerReject(lender: PickerLender, reason?: string, date?: string) {
    if (!picker) return;
    const { c, rows } = picker;
    setPickerBusy(true);
    try {
      const now = new Date().toISOString();
      // Admin-entered rejection date (local midnight) when provided; else now.
      const rejectedAt = date ? new Date(`${date}T00:00:00`).toISOString() : now;
      const existing = rows.find((r) => r.lender_key === lender.key);
      const lp = { rejected_at: rejectedAt, rejection_reason: reason || null, approved_at: null, approval_details: null };
      const { error: lErr } = existing
        ? await supabase().from("loan_application_lenders").update(lp).eq("id", existing.id)
        : await supabase().from("loan_application_lenders").insert({ application_id: c.id, lender_key: lender.key, lender_label: lender.label, docs_sent_at: now, ...lp });
      if (lErr) throw new Error(lErr.message);
      const { error } = await supabase().from("epc_applications").update({ status: "rejected", rejected_at: rejectedAt, rejected_lender: lender.key, rejection_reason: reason || null, last_updated_by_user_id: me?.id ?? null }).eq("id", c.id);
      if (error) throw new Error(error.message);
      await logLoanActivity(c.id, "rejected", { detail: `Rejected by ${lender.label}${reason ? ` — ${reason}` : ""}` });
      setPicker(null); setTouches((t) => t + 1); await reload(true);
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

  // My Day scope: an RM sees only their own cases; a manager sees their whole
  // team (self + own RMs); the Main Admin oversees everyone (all managers +
  // RMs). All narrowable via the owner control.
  const myTeamIds = useMemo(() => {
    const ids: (string | null | undefined)[] = isMainAdmin
      ? boardPeople.map((u) => u.id)
      : isManager ? [me?.id, ...myRms.map((r) => r.id)] : [me?.id];
    return new Set(ids.filter(Boolean) as string[]);
  }, [isMainAdmin, isManager, boardPeople, myRms, me]);
  // Open a case from My Day; its page's back link returns here.
  const openCase = (href: string) => { sessionStorage.setItem("ccReturnTo", "/admin/board"); router.push(href as unknown as string); };
  // Today in IST ("YYYY-MM-DD") — for follow-up due/overdue comparisons.
  const todayStr = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()), []);
  const myDay = useMemo(() => {
    // Order: a due/overdue follow-up first (an explicit commitment), then urgency
    // (red→yellow→green), then least-recently-contacted, then longest-in-stage.
    const dueRank = (c: OpsCase) => (c.followUpAt && c.followUpAt <= todayStr ? 0 : 1);
    const contactRank = (c: OpsCase) => (c.lastContactedAt ? new Date(c.lastContactedAt).getTime() : 0);
    return cases
      .filter((c) => {
        if (!nextAction(c)) return false;
        if (c.ownerUserId && myTeamIds.has(c.ownerUserId)) return true;
        // Admin / manager also see UNASSIGNED actionable cases (e.g. a newly
        // added EPC that hasn't been assigned yet) so nothing slips through
        // unowned — they can work it or assign it from here.
        if (canOversee && !c.ownerUserId) return true;
        return false;
      })
      .sort((a, b) => dueRank(a) - dueRank(b) || outlineRank(a) - outlineRank(b) || contactRank(a) - contactRank(b) || b.stageHours - a.stageHours);
  }, [cases, myTeamIds, canOversee, outlineRank, todayStr]);
  const myDayScoped = useMemo(() => {
    if (!canOversee || myDayOwner === "all") return myDay;
    if (myDayOwner === "unassigned") return myDay.filter((c) => !c.ownerUserId);
    const want = myDayOwner === "me" ? me?.id : myDayOwner;
    return myDay.filter((c) => c.ownerUserId === want);
  }, [myDay, canOversee, myDayOwner, me]);

  const ownerTabs = useMemo(
    () => [
      // The Main Admin has no cases of their own, so no "Me" tab — they default
      // to "All" and oversee everyone. Managers/RMs get a "Me" tab (their own work).
      ...(isMainAdmin ? [] : [{ id: "me", name: "Me" }]),
      { id: "all", name: "All" },
      { id: "unassigned", name: "Unassigned" },
      ...boardPeople.map((u) => ({ id: u.id, name: u.name + (u.role === "MANAGER" ? " (Mgr)" : "") })),
    ],
    [boardPeople, isMainAdmin],
  );

  // Where can THIS user reassign a case? Admin→anyone; Manager→self or own RMs;
  // RM→up to their manager only.
  const reassignOptions = useMemo(() => {
    if (isMainAdmin) return users.map((u) => ({ value: u.id, label: u.name + (u.role === "MANAGER" ? " · Manager" : u.role === "MAIN_ADMIN" ? " · Admin" : "") }));
    if (isManager) return [{ value: me!.id, label: (me?.contact_name || "Me") + " · me" }, ...myRms.map((u) => ({ value: u.id, label: u.name }))];
    const mgr = users.find((u) => u.id === me?.parent_user_id);
    return mgr ? [{ value: mgr.id, label: mgr.name + " · send up ↑" }] : [];
  }, [users, isMainAdmin, isManager, myRms, me]);

  // Per-person workload for the overseer strip.
  const thisMonthKey = `${new Date().getFullYear()}-${new Date().getMonth()}`;
  // The strip FOLLOWS the selected owner tab so the cards and the columns always
  // agree: "all" → every person in scope; "me" → the viewer; a person tab → just
  // that person; "unassigned" → none.
  const workloadPeople = useMemo(() => {
    if (ownerFilter === "unassigned") return [] as { id: string; name: string }[];
    if (ownerFilter === "me") return me?.id ? [{ id: me.id, name: "Me" }] : [];
    if (ownerFilter === "all") return boardPeople.map((u) => ({ id: u.id, name: u.name }));
    const p = boardPeople.find((u) => u.id === ownerFilter);
    return p ? [{ id: p.id, name: p.name }] : [];
  }, [ownerFilter, boardPeople, me]);
  // Per person, this month: WIP = in-pipeline cases, Done = disbursed this month,
  // Oldest = longest TAT among WIP. (No summed "Total" — it conflated open work
  // with completed-this-month and read as an inflated, misleading number.)
  const workload = useMemo(() => workloadPeople.map((u) => {
    const wipCases = cases.filter((c) => c.source === srcFilter && c.column != null && c.ownerUserId === u.id);
    const done = cases.filter((c) => c.source === srcFilter && c.ownerUserId === u.id && monthKey(c.disbursedThisMonthAt) === thisMonthKey).length;
    const wip = wipCases.length;
    return { id: u.id, name: u.name, wip, done, oldest: wipCases.reduce((m, c) => Math.max(m, c.tatDays), 0) };
  }), [workloadPeople, cases, thisMonthKey, srcFilter]);

  return (
    <div className="min-h-screen lg:flex" style={{ ...themeStyle("board"), backgroundColor: "#fff" }}>
      <AdminSidebar active="board" />
      {/* Fixed-height app shell: the page itself doesn't scroll — the board and
          the side panel each scroll in their own container (no scroll bleed). */}
      <div className="flex-1 min-w-0 flex flex-col md:h-[calc(100vh-3.5rem)] lg:h-screen md:overflow-hidden">
        {/* Header */}
        <header className="px-4 sm:px-6 py-5 border-b border-line shrink-0">
          <p className="text-[15px] font-semibold text-text mb-2">
            Hi <span className="font-bold text-[#178a5c]">{greetingName(me)}</span>
          </p>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <SectionMark k="board" />
              <h1 className="font-display text-[22px] sm:text-[26px] font-bold" style={{ color: ACCENTS.board.color }}>
                Task Manager <span className="text-text-muted font-medium text-[15px]">· {visible.length} active</span>
              </h1>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* View switch sits at the top-right, just before the bell + Target. */}
              <div className="inline-flex border border-line rounded-lg overflow-hidden">
                {(["myday", "board"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => { setView(v); if (v === "myday") setSel(null); }}
                    className={["px-3.5 py-1.5 text-[12px] font-semibold border-r border-line last:border-r-0", view === v ? "bg-[#0f766e] text-white" : "text-text-mid bg-white hover:bg-bg-tint"].join(" ")}>
                    {v === "myday" ? "My Day" : "Board"}
                  </button>
                ))}
              </div>
              <NotificationBell />
              {isMainAdmin && (
                <label className="text-[12px] text-text-muted flex items-center gap-1.5">Target
                  {epcTab ? (
                    <input type="number" step="any" min={1} max={999} value={epcTarget} onChange={(e) => setEpcTarget(Math.max(1, Number(e.target.value) || 10))}
                      className="w-16 border border-line rounded-md px-2 py-1 text-[13px]" />
                  ) : (
                    <input type="number" step="any" min={1} max={999} value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 65))}
                      className="w-16 border border-line rounded-md px-2 py-1 text-[13px]" />
                  )}
                  {epcTab ? "EPCs" : "L"}</label>
              )}
            </div>
          </div>
          {/* Filters — board view only (My Day is its own ranked list). */}
          {view === "board" && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {/* Source filter */}
            <div className="inline-flex border border-line rounded-lg overflow-hidden">
              {(["epc", "lead", "loan", "insurance"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setSrcFilter(k)}
                  className={["px-3 py-1.5 text-[12px] font-semibold border-r border-line last:border-r-0", srcFilter === k ? "text-white" : "text-text-mid bg-white hover:bg-bg-tint"].join(" ")}
                  style={srcFilter === k ? { backgroundColor: SOURCE_META[k].color } : undefined}>
                  {SOURCE_META[k].label}
                </button>
              ))}
            </div>
            {/* Prominent search */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cases…"
                className="w-64 sm:w-80 border-2 border-line rounded-lg pl-9 pr-3 py-2 text-[13px] outline-none focus:border-[#0f766e] transition-colors" />
            </div>
            {/* Period filter (by creation date). "This Week" removed; custom is a
                month-to-month range. */}
            <select value={boardPeriod} onChange={(e) => changeBoardPeriod(e.target.value as Period)}
              className="rounded-lg border border-line bg-white px-3 py-2 text-[12px] font-medium text-text outline-none focus:border-[#0f766e] cursor-pointer">
              {PERIOD_OPTIONS.filter((o) => o.value !== "week").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value === "month" ? "Current Month" : o.value === "custom" ? "Month to month" : o.label}
                </option>
              ))}
            </select>
            {boardPeriod === "custom" && (
              <div className="inline-flex items-center gap-1.5">
                <input type="month" value={boardFrom} max={boardTo || undefined} onChange={(e) => changeBoardFrom(e.target.value)}
                  className="rounded-lg border border-line bg-white px-2.5 py-2 text-[12px] outline-none focus:border-[#0f766e]" aria-label="From month" />
                <span className="text-[12px] text-text-muted">to</span>
                <input type="month" value={boardTo} min={boardFrom || undefined} onChange={(e) => changeBoardTo(e.target.value)}
                  className="rounded-lg border border-line bg-white px-2.5 py-2 text-[12px] outline-none focus:border-[#0f766e]" aria-label="To month" />
              </div>
            )}
            {/* Owner tabs + quick filters are pushed to the right-most of the
                filter row (whose board, then the My-overdue/Unassigned/Breaches
                quick filters). */}
            <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
              {canOversee && (
                <div className="inline-flex border border-line rounded-lg overflow-hidden">
                  {ownerTabs.map((o) => (
                    <button key={o.id} type="button" onClick={() => setOwnerFilter(o.id)}
                      className={["px-3 py-1.5 text-[12px] font-semibold border-r border-line last:border-r-0", ownerFilter === o.id ? "bg-[#178a5c] text-white" : "text-text-mid bg-white hover:bg-bg-tint"].join(" ")}>
                      {o.name}
                    </button>
                  ))}
                </div>
              )}
              {([["myoverdue", "My overdue", "all"], ["unassigned", "Unassigned", "admin"], ["breaches", "Breaches", "oversee"]] as const)
                .filter(([, , vis]) => vis === "all" || (vis === "admin" && isMainAdmin) || (vis === "oversee" && canOversee))
                .map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setQuick(quick === k ? "none" : k)}
                  className={["px-3 py-1.5 text-[12px] font-semibold rounded-lg border", quick === k ? "bg-[#b45309] text-white border-[#b45309]" : "bg-white text-text-mid border-line hover:bg-bg-tint"].join(" ")}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          )}
        </header>

        <main className="flex-1 flex min-h-0 relative">
          {/* Kanban — its own scroll container. */}
          <div className="flex-1 overflow-auto p-4 sm:p-6">
            {view === "myday" ? (
              loading ? <p className="text-text-muted">Loading…</p> : (
                <>
                {/* The admin's approvals / send-backs — for the team, not the admin who made them. */}
                {!isMainAdmin && <ReviewNotices loans={cases.filter((c) => c.source === "loan")} onOpen={openCase} />}
                <Tranche2List items={cases.map((c) => c.tranche2).filter((t): t is Tranche2 => !!t)} onOpen={openCase} />
                <MyDayQueue items={myDayScoped} q={q} onSearch={setQ} showOwner={canOversee}
                  defaultSrc={canOversee ? "epc" : "loan"} rmName={me?.contact_name || greetingName(me) || "Capital Craft"}
                  todayStr={todayStr} onStampContact={(c) => void stampContact(c)} onSetFollowUp={(c, d) => void setFollowUp(c, d)}
                  onAddNote={(c, t) => void addNote(c, t)} onDetectDocs={detectPendingDocs}
                  ownerControl={canOversee ? (
                    <select value={myDayOwner} onChange={(e) => setMyDayOwner(e.target.value)}
                      className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-medium text-text outline-none focus:border-[#0f766e] cursor-pointer">
                      <option value="all">Everyone</option>
                      <option value="unassigned">Unassigned</option>
                      {isManager && <option value="me">Me</option>}
                      {boardPeople.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
                    </select>
                  ) : undefined}
                  onOpen={openCase} />
                </>
              )
            ) : (
            <>
            {!canOversee && !loading && <MyMonthCard cases={cases} srcFilter={srcFilter} me={me} thisMonthKey={thisMonthKey} />}
            {canOversee && !loading && workload.length > 0 && <WorkloadStrip workload={workload} />}
            {loading ? (
              <p className="text-text-muted">Loading…</p>
            ) : (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${activeCols.length}, minmax(150px, 1fr))` }}>
                {activeCols.map((col) => {
                  const items = byCol(col.key);
                  const colValue = items.reduce((s, c) => s + (c.amount || 0), 0);
                  return (
                    <div key={col.key}
                      onDragOver={(e) => { if (dragId && canDrag) e.preventDefault(); }}
                      onDrop={(e) => { e.preventDefault(); if (canDrag) onDropTo(col.key); }}
                      className={dragId && canDrag ? "rounded-lg outline-dashed outline-1 outline-[#9ccbb7] outline-offset-2" : ""}>
                      <div className="pb-2 mb-2 border-b-2 border-line">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-text-mid">{col.label}</div>
                        {/* Count in front of the ₹ value — e.g. "5 · ₹39.2 L".
                            EPC has no loan value, so it shows the count only. */}
                        <div className="text-[11px] font-semibold text-[#0f3d2e] mt-0.5">
                          <span className="text-text-muted">{items.length}</span>
                          {srcFilter !== "epc" && <> · {rupeesShort(colValue)}</>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        {items.map((c) => (
                          <BoardCard key={c.source + c.id} c={c} srcFilter={srcFilter} sla={sla} picked={sel === c.id} canDrag={canDrag}
                            isMainAdmin={isMainAdmin} onSelect={() => setSel(c.id)} onStartDrag={() => setDragId(c.id)} />
                        ))}
                        {items.length === 0 && <div className="text-[11px] text-text-muted py-1">—</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            </>
            )}
          </div>

          {/* Side panel */}
          {view === "board" && selCase && (
            <>
              {/* Backdrop — freezes the board; click anywhere on it closes the panel. */}
              <div className="absolute inset-0 z-30 bg-black/5" onClick={() => setSel(null)} />
              <aside className="absolute top-0 bottom-0 right-0 w-[360px] z-40 border-l border-line bg-white p-5 flex flex-col gap-3 overflow-y-auto shadow-[-8px_0_24px_-12px_rgba(15,23,42,0.25)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-[18px] font-bold text-text truncate">{selCase.name}</h2>
                </div>
                <button type="button" onClick={() => setSel(null)} className="text-[18px] text-text-muted hover:text-text leading-none p-1">✕</button>
              </div>

              {/* View switch — Update (stats + reassign + view profile + comments,
                  for working the case) vs EMI confirmation (the full applicant /
                  loan / system detail, no comments — clean to share/screenshot).
                  Individually-bordered buttons + shrink-0 so the row never
                  collapses when the scrolling panel's content grows. */}
              <div className="flex gap-1.5 shrink-0">
                {([["details", "Update"], ["emi", "EMI confirmation"]] as const).map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => setPanelTab(k)}
                    className={["text-[12px] font-semibold rounded-lg border px-3 py-1.5 transition-colors", panelTab === k ? "border-[#0f766e] bg-[#0f766e] text-white" : "border-line bg-white text-text-mid hover:bg-bg-tint"].join(" ")}>
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Two working stats — total time, and time in the CURRENT stage. */}
              <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
                <div className="rounded-lg bg-[#f6f8f7] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">Working</div>
                  <div className="text-[16px] font-bold text-text leading-tight">{selCase.tatDays}<span className="text-[12px] font-medium text-text-muted"> days total</span></div>
                </div>
                <div className="rounded-lg bg-[#f6f8f7] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">In this stage</div>
                  <div className="text-[16px] font-bold text-text leading-tight">{Math.max(0, Math.floor(selCase.stageHours / 24))}<span className="text-[12px] font-medium text-text-muted"> days</span></div>
                </div>
              </div>

              {/* Quick actions — reassign + open the full profile, right up top.
                  Both controls share the same label row + height so they match. */}
              <div className="grid grid-cols-2 gap-2 items-end">
                {reassignOptions.length > 0 ? (
                  <div>
                    <div className="text-[11px] text-text-muted mb-1">{isMainAdmin || isManager ? "Reassign to" : "Send to senior ↑"}</div>
                    <Select value={selCase.ownerUserId ?? ""} disabled={busy}
                      onChange={(e) => void act("reassign", { assigned_to_user_id: e.target.value || null })}
                      placeholder="Select…"
                      options={[...(isMainAdmin ? [{ value: "", label: "Unassigned" }] : []), ...reassignOptions]} />
                  </div>
                ) : <div />}
                <div>
                  <div className="text-[11px] text-text-muted mb-1">&nbsp;</div>
                  <button type="button"
                    className="w-full rounded-input border border-line bg-white text-text py-3 text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#f5f8f6]"
                    onClick={() => { sessionStorage.setItem("ccReturnTo", "/admin/board"); router.push(selCase.href as unknown as string); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>
                    View profile
                  </button>
                </div>
              </div>

              {/* Full case detail — shown only in the EMI-confirmation view. */}
              {panelTab === "emi" && <CaseDetails selCase={selCase} detail={detail} />}

              {/* Comments — add one, see the latest, expand history. Shown only in
                  the Update view; hidden in the EMI-confirmation view. */}
              {panelTab === "details" && (
              <div className="border-t border-line pt-3 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wide text-text-mid mb-2">Comments</div>
                {COMMENT_TBL[selCase.source] ? (
                  <>
                    <div className="flex gap-1.5 mb-2">
                      <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add a comment…"
                        onKeyDown={(e) => { if (e.key === "Enter" && commentText.trim()) void addComment(); }}
                        className="flex-1 min-w-0 border border-line rounded-md px-2 py-1.5 text-[12px]" />
                      <button type="button" className="btn-act primary" disabled={commentBusy || !commentText.trim()} onClick={() => void addComment()}>Post</button>
                    </div>
                    {comments.length === 0 ? (
                      <div className="text-text-muted text-[12px]">No comments yet.</div>
                    ) : (
                      <div className="flex flex-col gap-2 text-[12px] text-text-mid">
                        {(showCmtHist ? comments : comments.slice(0, 1)).map((cm) => (
                          <div key={cm.id}>
                            <span className="font-semibold text-text">{cm.author_name || "Admin"}</span>
                            <span className="text-text-muted"> · {fmtAgo(cm.created_at)}</span>
                            <div className="whitespace-pre-wrap break-words">{cm.comment_text}</div>
                          </div>
                        ))}
                        {comments.length > 1 && (
                          <button type="button" className="text-[11px] font-semibold text-[#178a5c] hover:underline self-start" onClick={() => setShowCmtHist((v) => !v)}>
                            {showCmtHist ? "Hide history ▲" : `Show history (${comments.length}) ▼`}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-text-muted text-[12px]">Comments aren’t available for insurance cases.</div>
                )}
              </div>
              )}
              </aside>
            </>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-line bg-white px-4 sm:px-6 py-3 flex items-center gap-6 flex-wrap text-[13px]">
          <span><strong style={{ color: "#b45309" }}>{breaches}</strong> need attention</span>
          <span><strong>{touches}</strong> action{touches === 1 ? "" : "s"} this session</span>
          <span className="flex items-center gap-2.5 text-[12px] text-text-muted">
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#16a34a" }} />up to date</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#eab308" }} />watch</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#dc2626" }} />overdue</span>
          </span>
          <div className="flex items-center gap-2.5 ml-auto min-w-[300px]">
            {epcTab
              ? <span className="whitespace-nowrap">{periodLabel} <strong>{onboarded}</strong> of {epcTarget} EPCs onboarded</span>
              : <span className="whitespace-nowrap">{periodLabel} <strong>{rupeesShort(mtd)}</strong> of ₹{target} L</span>}
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
        const opensScreen = c.source === "loan" && !!drop.column && LOAN_OPENS_SCREEN.has(drop.column);
        const title = !chk.ok ? "Can’t move there" : opensScreen ? "Continue to the loan?" : "Move this case?";
        return (
          <Modal onClose={() => setDrop(null)} busy={busy} overlayClassName={OVERLAY.grid} className="w-full max-w-sm rounded-[12px] bg-white p-5 shadow-xl">
            <div className="text-[15px] font-semibold text-text">{title}</div>
            <p className={"text-[13px] mt-2 " + (chk.ok ? "text-text-mid" : "text-red-700")}>{chk.msg}</p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button className="btn-act ghost" onClick={() => setDrop(null)} disabled={busy}>{chk.ok ? "Cancel" : "OK"}</button>
              {chk.ok && (
                <button className="btn-act primary" onClick={() => void confirmDrop()} disabled={busy}>
                  {busy ? "Working…" : opensScreen ? "Continue →" : "Yes, move"}
                </button>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* Inline loan lender / decision popup — same modal the loan page uses. */}
      {picker && (
        <LenderPickerPopup picker={picker} lenders={lenders} onClose={() => { if (!pickerBusy) setPicker(null); }}
          onDocsSent={pickerDocsSent} onApprove={pickerApprove} onReject={pickerReject} />
      )}

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
