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
import AdminSidebar from "@/components/AdminSidebar";
import NotificationBell from "@/components/NotificationBell";
import LoanLenderPickerModal, { type PickerLender } from "@/components/LoanLenderPickerModal";
import Select from "@/components/ui/Select";
import { supabase } from "@/lib/supabase";
import { getBusiness, getToken, greetingName } from "@/lib/auth";
import { loadOpsCases, columnsFor, SOURCE_META, type OpsCase, type TeamUser, type CaseSource } from "@/lib/ops-board";
import { PERIOD_OPTIONS, inPeriod, type Period } from "@/lib/period";
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
  phase1: [], // no abort once in 1st Phase (disbursement under way)
  abort: [],
};
// Loan target columns whose drop opens the real loan screen instead of a plain
// status write. (docs_pending is a simple "put on hold" status move.)
const LOAN_OPENS_SCREEN = new Set(["send_lender", "approved_rejected", "phase1", "abort"]);

// Per-source comment table (insurance has none).
const COMMENT_TBL: Record<CaseSource, { table: string; key: string } | null> = {
  loan: { table: "loan_comments", key: "application_id" },
  epc: { table: "epc_comments", key: "business_id" },
  lead: { table: "lead_comments", key: "lead_id" },
  insurance: null,
};

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
  phase2: [600, 1080],          // 2nd disbursement — same aging as 1st
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
// Full Indian-grouped rupees for the side panel (₹1,80,000 — never "1.8 L").
function fmtFull(v: number): string {
  return "₹" + Math.round(v).toLocaleString("en-IN");
}
// The next action a case needs, derived from its stage. null = nothing to do
// (rejected / aborted / fully disbursed / off-board) — excluded from My Day.
function nextAction(c: OpsCase): { text: string; cta: string } | null {
  if (c.outcome === "rejected" || c.column === "abort" || c.column == null) return null;
  if (c.source === "loan") {
    switch (c.column) {
      case "ready_login":       return { text: "Send the documents to a lender", cta: "Open" };
      case "send_lender":       return { text: "Follow up the lender · record the decision", cta: "Open" };
      case "docs_pending":      return { text: "Collect the pending documents", cta: "Open" };
      case "approved_rejected": return { text: "Record the disbursement", cta: "Open" };
      case "phase1":            return { text: "Record the 2nd disbursement", cta: "Open" };
      case "phase2":            return null; // fully disbursed — done
      default:                  return { text: c.statusLabel, cta: "Open" };
    }
  }
  if (c.source === "lead") return { text: "Follow up · convert this lead", cta: "Open" };
  return { text: c.statusLabel, cta: "Open" };
}

// "YYYY-MM" → last calendar day "YYYY-MM-DD" (inclusive end of the month range).
function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return "";
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

// ── Side-panel detail form (loan cases) ──────────────────────────────────────
const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? "₹" + Math.round(n).toLocaleString("en-IN") : "—"; };
const GRID_LABEL: Record<string, string> = { on_grid: "On-Grid", off_grid: "Off-Grid", hybrid: "Hybrid" };
const gridLabel = (s: unknown) => (s ? GRID_LABEL[String(s)] ?? String(s) : "—");
const placeLabel = (s: unknown) => (s === "residential" ? "House (residential)" : s === "commercial" ? "Commercial" : "—");
// Columns fetched on demand when a loan card is opened.
const DETAIL_COLS = "borrower_name, aadhaar_name, borrower_mobile, borrower_email, coapp_name, coapp_mobile, coapp_email, organization_name, total_project_cost, loan_amount_required, selected_tenure_years, project_size, project_size_unit, plant_use_type, system_type, central_subsidy, state_subsidy, bill_on_applicant_name";

// A stacked label-over-value field — cleaner than a squeezed two-column row for
// long values (emails, business names).
function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-text-muted">{k}</div>
      <div className="text-[13px] font-semibold text-text break-words">{v || "—"}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#5a8a76] mb-1.5">{title}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

// "My Day" — a single ranked to-do list of the RM's own cases: what to do next,
// how long it's been waiting, and a button to open it. Replaces the Kanban as
// the default screen for RMs / managers.
function MyDayQueue({ items, onOpen, q, onSearch }: { items: OpsCase[]; onOpen: (href: string) => void; q: string; onSearch: (v: string) => void }) {
  const ql = q.trim().toLowerCase();
  const shown = ql ? items.filter((c) => `${c.name} ${c.lender ?? ""} ${c.epcName ?? ""}`.toLowerCase().includes(ql)) : items;
  const lvlOf = (c: OpsCase) => (c.source === "loan" ? loanOutline(c) : attention(c, 1));
  const urgent = shown.filter((c) => lvlOf(c) === "red").length;
  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="text-[16px] font-bold text-text">
          My Day <span className="text-text-muted font-medium text-[13px]">· {shown.length} to action{urgent > 0 ? ` · ${urgent} urgent` : ""}</span>
        </div>
        <div className="relative ml-auto">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search my cases…"
            className="w-56 border-2 border-line rounded-lg pl-9 pr-3 py-1.5 text-[13px] outline-none focus:border-[#0f766e]" />
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="text-[13px] text-text-muted border border-dashed border-line rounded-lg p-10 text-center">
          Nothing needs your action right now. 🎉
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((c) => {
            const act = nextAction(c)!;
            const days = Math.max(0, Math.floor(c.stageHours / 24));
            const lvl = lvlOf(c);
            return (
              <li key={c.source + c.id} className="flex items-center gap-3 rounded-lg border border-line bg-white px-3.5 py-3 transition-shadow hover:shadow-md">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: OUTLINE[lvl] }} title={lvl === "red" ? "Overdue" : lvl === "yellow" ? "Watch" : "On track"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <strong className="text-[14px] text-text truncate">{c.name}</strong>
                    {c.lender && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#eef2f7] text-[#334155] shrink-0">{c.lender}</span>}
                  </div>
                  <div className="text-[12.5px] text-text-mid truncate">{act.text}{c.epcName ? ` · ${c.epcName}` : ""}</div>
                </div>
                <span className="text-[12px] font-semibold shrink-0 whitespace-nowrap" style={{ color: lvl === "red" ? "#b42318" : "#5a8a76" }}>
                  {lvl === "red" ? "⚠ " : ""}{days}d
                </span>
                <button type="button" onClick={() => onOpen(c.href)}
                  className="shrink-0 text-[12px] font-semibold px-3.5 py-1.5 rounded-lg bg-[#0f766e] text-white hover:bg-[#0c5f58]">
                  {act.cta}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
function monthKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}`;
}


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
  const [ownerFilter, setOwnerFilter] = useState<string>(isMainAdmin ? "all" : "me"); // 'me' | 'all' | userId | 'unassigned'
  const [busy, setBusy] = useState(false);
  const [touches, setTouches] = useState(0);
  const sla = 1; // fixed at ≤1 day (backend only — no UI control, per spec)
  const [target, setTarget] = useState<number>(() => (typeof window !== "undefined" ? Number(localStorage.getItem("opsboard.target")) : 0) || 65);
  const [q, setQ] = useState("");
  // Period filter (by the case's boardDate — active cases carry into the current
  // month automatically). Default "Current Month"; persisted; "custom" uses
  // month-to-month pickers (boardFrom/boardTo as "YYYY-MM").
  const [boardPeriod, setBoardPeriod] = useState<Period>("month");
  const [boardFrom, setBoardFrom] = useState("");
  const [boardTo, setBoardTo] = useState("");
  // RMs / managers default to the "My Day" action queue; admins stay on the board.
  const [view, setView] = useState<"myday" | "board">(isMainAdmin ? "board" : "myday");
  const [quick, setQuick] = useState<"none" | "myoverdue" | "unassigned" | "breaches">("none");
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ caseId: string; column: string } | null>(null);
  // Inline lender picker (change: loan lender/decision popups render ON the board).
  const [picker, setPicker] = useState<{ c: OpsCase; mode: "docsent" | "approve" | "reject"; rows: LoanLenderRow[] } | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  // Side-panel comments + collapsible comment history.
  const [detail, setDetail] = useState<Record<string, any> | null>(null); // selected loan's full detail (on-demand)
  const [comments, setComments] = useState<{ id: string; author_name: string | null; comment_text: string; created_at: string }[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [showCmtHist, setShowCmtHist] = useState(false);

  // force=true after any action so the board reflects the change immediately;
  // plain mount/navigation reuses the short (20s) cache to cut egress.
  const reload = useCallback(async (force = false) => {
    const { cases, users } = await loadOpsCases({ force });
    setCases(cases);
    setUsers(users);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("opsboard.target", String(target)); }, [target]);
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

  // Load the selected case's comments (per-source table).
  useEffect(() => {
    setShowCmtHist(false); setCommentText("");
    const c = cases.find((x) => x.id === sel);
    const meta = c ? COMMENT_TBL[c.source] : null;
    if (!sel || !meta) { setComments([]); return; }
    void (async () => {
      const { data } = await supabase().from(meta.table)
        .select("id, author_name, comment_text, created_at").eq(meta.key, sel)
        .order("created_at", { ascending: false }).limit(50);
      setComments((data ?? []) as typeof comments);
    })();
  }, [sel, cases]);

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
  const byCol = (k: string) => visible.filter((c) => colOf(c) === k).sort((a, b) => {
    const ra = outlineRank(a), rb = outlineRank(b);
    if (ra !== rb) return ra - rb;
    return b.stageHours - a.stageHours; // longest in this stage first
  });

  // "My Day" queue — the RM's OWN cases that need action, across all sources,
  // ranked most-urgent first (red → yellow → green, longest-in-stage on top).
  const myDay = useMemo(() => {
    return cases
      .filter((c) => c.ownerUserId === me?.id && !!nextAction(c))
      .sort((a, b) => outlineRank(a) - outlineRank(b) || b.stageHours - a.stageHours);
  }, [cases, me, outlineRank]);
  const breaches = visible.filter((c) => c.idleDays >= sla).length;
  const thisMonth = `${new Date().getFullYear()}-${new Date().getMonth()}`;
  const mtd = cases.reduce((sum, c) => sum + (monthKey(c.disbursedThisMonthAt) === thisMonth ? c.disbursed : 0), 0);
  const pct = Math.min(100, Math.round(mtd / (target * 1e5) * 100));
  const selCase = cases.find((c) => c.id === sel) || null;

  // Fetch the selected LOAN's full detail on demand (one small query per open —
  // keeps it off the board list query).
  const selId = selCase?.id ?? null;
  const selIsLoan = selCase?.source === "loan";
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
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
      if (existing) await supabase().from("loan_application_lenders").update(lp).eq("id", existing.id);
      else await supabase().from("loan_application_lenders").insert({ application_id: c.id, lender_key: lender.key, lender_label: lender.label, docs_sent_at: now, ...lp });
      await supabase().from("epc_applications").update({ status: "rejected", rejected_at: rejectedAt, rejected_lender: lender.key, rejection_reason: reason || null, last_updated_by_user_id: me?.id ?? null }).eq("id", c.id);
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
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {!isMainAdmin && (
                <div className="inline-flex border border-line rounded-lg overflow-hidden">
                  {(["myday", "board"] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setView(v)}
                      className={["px-3.5 py-1.5 text-[12px] font-semibold border-r border-line last:border-r-0", view === v ? "bg-[#0f766e] text-white" : "text-text-mid bg-white hover:bg-bg-tint"].join(" ")}>
                      {v === "myday" ? "My Day" : "Board"}
                    </button>
                  ))}
                </div>
              )}
              <NotificationBell />
              {isMainAdmin && (
                <label className="text-[12px] text-text-muted flex items-center gap-1.5">Target
                  <input type="number" min={1} max={999} value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 65))}
                    className="w-16 border border-line rounded-md px-2 py-1 text-[13px]" /> L</label>
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
            {/* Quick filters */}
            {([["myoverdue", "My overdue", "all"], ["unassigned", "Unassigned", "admin"], ["breaches", "Breaches", "oversee"]] as const)
              .filter(([, , vis]) => vis === "all" || (vis === "admin" && isMainAdmin) || (vis === "oversee" && canOversee))
              .map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setQuick(quick === k ? "none" : k)}
                className={["px-3 py-1.5 text-[12px] font-semibold rounded-lg border", quick === k ? "bg-[#b45309] text-white border-[#b45309]" : "bg-white text-text-mid border-line hover:bg-bg-tint"].join(" ")}>
                {lbl}
              </button>
            ))}
            {/* Owner tabs — pushed to the RIGHT (Admin sees all RMs, Manager sees own team) */}
            {canOversee && (
              <div className="inline-flex border border-line rounded-lg overflow-hidden ml-auto">
                {ownerTabs.map((o) => (
                  <button key={o.id} type="button" onClick={() => setOwnerFilter(o.id)}
                    className={["px-3 py-1.5 text-[12px] font-semibold border-r border-line last:border-r-0", ownerFilter === o.id ? "bg-[#178a5c] text-white" : "text-text-mid bg-white hover:bg-bg-tint"].join(" ")}>
                    {o.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
        </header>

        <main className="flex-1 flex min-h-0">
          {/* Kanban */}
          <div className="flex-1 overflow-x-auto p-4 sm:p-6">
            {view === "myday" ? (
              loading ? <p className="text-text-muted">Loading…</p> : (
                <MyDayQueue items={myDay} q={q} onSearch={setQ}
                  onOpen={(href) => { sessionStorage.setItem("ccReturnTo", "/admin/board"); router.push(href as unknown as string); }} />
              )
            ) : (
            <>
            {!canOversee && !loading && (() => {
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
            })()}
            {canOversee && !loading && workload.length > 0 && (
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
            )}
            {loading ? (
              <p className="text-text-muted">Loading…</p>
            ) : (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${activeCols.length}, minmax(150px, 1fr))` }}>
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
                          // Approved cards get a green wash, rejected a red one (slightly deeper
                          // than before, per request).
                          const fill = c.outcome === "approved" ? "#d1efdf" : c.outcome === "rejected" ? "#f7d9d9" : "#ffffff";
                          const picked = sel === c.id;
                          // Days the case has sat in its CURRENT stage (e.g. "7d" since it was
                          // approved / disbursed). Total days-worked lives in the side panel.
                          const stageDays = Math.max(0, Math.floor(c.stageHours / 24));
                          // Top-right chip: the LENDER (loan) / partner (insurance) in a single-
                          // source view; the source tag only in the mixed "All" view.
                          const chip = srcFilter === "all" ? sm.label : c.lender;
                          return (
                            <button key={c.source + c.id} type="button" onClick={() => setSel(c.id)}
                              draggable={canDrag} onDragStart={(e) => { if (!canDrag) { e.preventDefault(); return; } setDragId(c.id); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", c.id); } catch { /* ignore */ } }}
                              className={"text-left rounded-lg border-2 p-2.5 transition-all duration-150 will-change-transform" + (canDrag ? " cursor-grab active:cursor-grabbing" : " cursor-pointer")}
                              // Selection is shown by LIFTING the card (shadow + raise), not by a
                              // coloured ring — that used to clash with the red/green status border.
                              style={{ borderColor: OUTLINE[lvl], backgroundColor: fill, transform: picked ? "translateY(-3px)" : undefined, boxShadow: picked ? "0 12px 26px -8px rgba(15,23,42,0.45)" : "0 1px 2px rgba(15,23,42,0.06)", position: picked ? "relative" : undefined, zIndex: picked ? 1 : undefined }}>
                              <div className="flex items-center justify-between gap-2">
                                <strong className="text-[13.5px] font-semibold text-text truncate">{c.name}</strong>
                                {chip && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                                    style={srcFilter === "all" ? { backgroundColor: sm.tint, color: sm.color } : { backgroundColor: "#eef2f7", color: "#334155" }}>
                                    {chip}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-baseline gap-1.5 mt-1 min-w-0">
                                {c.amount ? <span className="text-[12.5px] font-bold text-[#0f3d2e] shrink-0">{fmtFull(c.amount)}</span> : null}
                                {c.epcName ? <span className="text-[11px] text-text-muted truncate">{c.amount ? "· " : ""}{c.epcName}</span>
                                  : (!c.amount && <span className="text-[11px] text-text-muted truncate">{c.statusLabel}</span>)}
                              </div>
                              <div className="flex items-center justify-between gap-2 mt-1.5">
                                <span className="text-[11px] font-semibold" style={{ color: late ? "#b45309" : "#5a8a76" }}>
                                  {late && "⚠ "}🕒 {stageDays}d in stage
                                </span>
                                {isMainAdmin && c.ownerName && <span className="text-[10px] font-medium text-text-muted shrink-0">{c.ownerName}</span>}
                              </div>
                              {c.onHold && <div className="text-[10px] font-semibold text-[#b45309] mt-0.5">⏸ On hold</div>}
                              {c.blocker && <div className="text-[10px] text-text-muted truncate mt-0.5">{c.blocker.slice(0, 30)}</div>}
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
            </>
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

              {selCase.source === "loan" ? (
                <div className="flex flex-col gap-1.5">
                  {/* Operational context (not in the applicant form, kept for the RM). */}
                  <div className="text-[13px] flex flex-col gap-1.5">
                    <Row k="Lender" v={selCase.lender || "—"} />
                    <Row k="Owner" v={selCase.ownerName || "Unassigned"} />
                  </div>
                  {detail === null ? (
                    <div className="text-[12px] text-text-muted pt-2">Loading details…</div>
                  ) : (
                    <>
                      <Section title="Applicant">
                        <Field k="Applicant Name" v={detail.borrower_name || detail.aadhaar_name || selCase.name} />
                        <Field k="App Mob No." v={detail.borrower_mobile ? `+91 ${detail.borrower_mobile}` : "—"} />
                        <Field k="App email ID" v={detail.borrower_email || "—"} />
                      </Section>
                      {(detail.coapp_name || detail.bill_on_applicant_name === false) && (
                        <Section title="Co-applicant">
                          <Field k="Co-app Name" v={detail.coapp_name || "—"} />
                          <Field k="Co-app Mob No" v={detail.coapp_mobile ? `+91 ${detail.coapp_mobile}` : "—"} />
                          <Field k="Co-app email ID" v={detail.coapp_email || "—"} />
                        </Section>
                      )}
                      <Section title="Business">
                        <Field k="Employer / Business Name" v={detail.organization_name || "—"} />
                      </Section>
                      <Section title="Loan">
                        <Field k="Project Cost" v={money(detail.total_project_cost)} />
                        <Field k="Loan Amount" v={money(detail.loan_amount_required)} />
                        <Field k="Loan Tenure" v={detail.selected_tenure_years ? `${detail.selected_tenure_years} year` : "—"} />
                      </Section>
                      <Section title="System">
                        <Field k="Merchant Name" v={selCase.epcName || "—"} />
                        <Field k="Capacity" v={detail.project_size ? `${detail.project_size} ${String(detail.project_size_unit || "kw").toUpperCase()}` : "—"} />
                        <Field k="Place of Installation" v={placeLabel(detail.plant_use_type)} />
                        <Field k="Subsidy" v={(Number(detail.central_subsidy) > 0 || Number(detail.state_subsidy) > 0) ? "Yes" : "No"} />
                        <Field k="On-Grid / Off-grid" v={gridLabel(detail.system_type)} />
                      </Section>
                    </>
                  )}
                  {selCase.blocker && <div className="text-[12px] pt-1"><span className="text-text-muted">Blocker:</span> {selCase.blocker}</div>}
                </div>
              ) : (
                <div className="text-[13px] flex flex-col gap-1.5">
                  <Row k="Amount" v={selCase.amount ? fmtFull(selCase.amount) : "—"} />
                  <Row k="Lender" v={selCase.lender || "—"} />
                  <Row k="Owner" v={selCase.ownerName || "Unassigned"} />
                  <Row k="Lead owner" v={selCase.leadOwnerName || "—"} />
                  {selCase.blocker && <div><span className="text-text-muted">Blocker:</span> {selCase.blocker}</div>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {/* Move stage — same flow as dragging: choose the next stage, then
                    the confirmation + lender/decision/disbursement popup appears. */}
                {(() => {
                  const targets = selCase.source === "loan"
                    ? (LOAN_FORWARD[selCase.column ?? ""] ?? [])
                    : columnsFor(selCase.source).map((c) => c.key).filter((k) => k !== selCase.column);
                  if (!targets.length) return <div className="col-span-2 text-[11px] text-text-muted">No further stage from here.</div>;
                  return (
                    <div className="col-span-2">
                      <div className="text-[11px] text-text-muted mb-1">Move to stage →</div>
                      <Select value="" disabled={busy} placeholder="Choose next stage…"
                        onChange={(e) => { if (e.target.value) setDrop({ caseId: selCase.id, column: e.target.value }); }}
                        options={targets.map((k) => ({ value: k, label: columnsFor(selCase.source).find((c) => c.key === k)?.label || k }))} />
                    </div>
                  );
                })()}
                {/* Reassign + View profile, side by side. */}
                {reassignOptions.length > 0 ? (
                  <div>
                    <div className="text-[11px] text-text-muted mb-1">{isMainAdmin || isManager ? "Reassign to" : "Send to senior ↑"}</div>
                    <Select value={selCase.ownerUserId ?? ""} disabled={busy}
                      onChange={(e) => void act("reassign", { assigned_to_user_id: e.target.value || null })}
                      placeholder="Select…"
                      options={[...(isMainAdmin ? [{ value: "", label: "Unassigned" }] : []), ...reassignOptions]} />
                  </div>
                ) : <div />}
                <div className="flex flex-col justify-end">
                  <button type="button" className="btn-act ghost text-center inline-flex items-center justify-center gap-1.5"
                    onClick={() => { sessionStorage.setItem("ccReturnTo", "/admin/board"); router.push(selCase.href as unknown as string); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>
                    View profile
                  </button>
                </div>
              </div>

              {/* Comments — add one, see the latest, expand history. */}
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
                            <span className="text-text-muted"> · {when(cm.created_at)}</span>
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
            </aside>
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
            needDate={m === "reject"}
            confirmLabel={m === "docsent" ? "Mark docs sent" : m === "approve" ? "Continue to details" : "Mark rejected"}
            tone={m === "docsent" ? "blue" : m === "approve" ? "green" : "red"}
            onClose={() => { if (!pickerBusy) setPicker(null); }}
            onConfirm={(l, reason, date) => (m === "docsent" ? pickerDocsSent(l) : m === "approve" ? pickerApprove(l) : pickerReject(l, reason, date))}
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
function when(iso: string): string {
  const d = new Date(iso), diff = Date.now() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return d.toLocaleDateString("en-IN", { dateStyle: "medium" });
}
