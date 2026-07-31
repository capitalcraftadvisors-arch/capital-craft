"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import AddNewEpcModal from "@/components/AddNewEpcModal";
import AddNewLoanAppModal from "@/components/AddNewLoanAppModal";
import AddNewInsuranceModal from "@/components/AddNewInsuranceModal";
import LenderPickerModal, { LenderKey } from "@/components/LenderPickerModal";
import AdminSidebar, { ACCENTS } from "@/components/AdminSidebar";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
import { lenderOutcome, OUTCOME_LABEL, OUTCOME_PILL, OUTCOME_STATUSES, type LenderOutcome } from "@/lib/loan-status";
import {
  deadlineState, DEADLINE_PILL, fmtRupees, fmtDateShort,
  displayAmount as amountFor,
} from "@/lib/disbursement";
import { policyValidityParts, VALIDITY_TEXT } from "@/lib/insurance-validity";

type Tab = "epcs" | "apps" | "insurance" | "leads";

export default function AdminHomePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const [tab, setTab] = useState<Tab>("epcs");

  // Coming back from a loan/insurance View should land on the right tab (the
  // list then restores scroll + highlights the row you came from). Consumed
  // once, so a fresh visit still defaults to EPCs. (Return from an EPC View
  // doesn't set this key, so it correctly stays on the EPCs tab.)
  useEffect(() => {
    const t = sessionStorage.getItem("adminList.tab");
    if (t === "apps" || t === "insurance" || t === "leads") setTab(t);
    sessionStorage.removeItem("adminList.tab");
  }, []);

  const section = ACCENTS[tab];

  return (
    <div className="min-h-screen bg-bg-soft md:flex">
      <AdminSidebar active={tab} onSelectTab={setTab} />
      <div className="flex-1 min-w-0">
        <section className="w-full px-4 sm:px-6 py-8">
          {/* Section header with the console's accent bar. */}
          <div className="mb-6 flex items-center gap-2.5">
            <span className="inline-block w-1.5 h-7 rounded-full" style={{ backgroundColor: section.color }} />
            <h1 className="font-display text-[24px] sm:text-[28px] font-bold">{section.label}</h1>
          </div>

          {tab === "epcs" ? <EpcsTab /> : tab === "apps" ? <AppsTab /> : tab === "insurance" ? <InsuranceTab /> : <LeadsTab />}
        </section>
      </div>
    </div>
  );
}

// ── EPCs tab ────────────────────────────────────────────────────────────────

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  proprietorship: "Proprietorship",
  pvt_ltd:        "Private Limited",
  partnership:    "Partnership",
  llp:            "LLP",
};

type Lender = "creditfair" | "aerem" | "solfin";
// "03 Jul 2026, 5:53 pm" — when the loan application was created.
function fmtAddedOn(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}
// Same instant, split so the loan table can show the date bold with the time
// muted underneath: "22 Jul 2026" / "10:43 am".
function fmtAddedDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtAddedTime(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
}
// DISPLAY-ONLY short label for the insurer in the table. The stored
// insurance_partner value is untouched and nothing keyed on it changes;
// anything that isn't SBI renders exactly as stored.
function insurerLabelShort(v: string | null | undefined): string {
  if (!v) return "—";
  return /^sbi\b/i.test(v.trim()) ? "SBI-GI" : v;
}

// Phone-search cap: when the query is ALL digits (searching a mobile number),
// limit it to 10 digits; mixed text (names, emails, EPC-… ids) is unrestricted.
function capPhone(v: string): string {
  return /^\d+$/.test(v) ? v.slice(0, 10) : v;
}

// ── shared: clickable summary cards + collapsible filters ─────────────────
type SummaryCard = { key: string; label: string; value: number };

// Compact, clickable stat cards. Clicking sets the active category (key);
// clicking the active one — or the "" (Total) card — clears it. Each card's
// count is computed with the SAME predicate the table filters on, so a card's
// number always equals the rows shown when it's active.
function SummaryCards({ accent, cards, active, onPick }: {
  accent: string; cards: SummaryCard[]; active: string; onPick: (key: string) => void;
}) {
  return (
    <div className="grid gap-3 mb-5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => {
        const on = active === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onPick(c.key)}
            aria-pressed={on}
            className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-left shadow-sm transition-colors"
            style={on ? { borderColor: accent, boxShadow: `inset 0 0 0 1px ${accent}` } : undefined}
          >
            <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ backgroundColor: accent + "1a", color: accent }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5" /></svg>
            </span>
            <span className="min-w-0">
              <span className="block text-[20px] font-display font-bold leading-none text-text">{c.value}</span>
              <span className="block text-[11px] text-text-muted mt-1 truncate" title={c.label}>{c.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// "Filters" toggle with an active-count badge (panel filters + any active card).
function FiltersButton({ count, open, accent, onClick }: {
  count: number; open: boolean; accent: string; onClick: () => void;
}) {
  const active = count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="inline-flex items-center gap-2 rounded-input border border-line bg-white px-3.5 py-2.5 text-[14px] font-medium text-text-mid hover:text-text transition-colors whitespace-nowrap"
      style={active || open ? { borderColor: accent, color: accent } : undefined}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M7 12h10M11 18h2" /></svg>
      Filters
      {active && (
        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-white text-[11px] font-bold" style={{ backgroundColor: accent }}>{count}</span>
      )}
    </button>
  );
}

// Collapsible panel holding a tab's existing filter controls + Clear all.
function FiltersPanel({ open, hasActive, onClear, children }: {
  open: boolean; hasActive: boolean; onClear: () => void; children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="mb-5 rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-semibold text-text-mid uppercase tracking-wide">Filters</p>
        {hasActive && (
          <button type="button" onClick={onClear} className="text-[12px] text-blue hover:underline">Clear all</button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </div>
  );
}

const LENDERS: { key: Lender; label: string }[] = [
  { key: "creditfair", label: "CreditFair" },
  { key: "aerem",      label: "Aerem" },
  { key: "solfin",     label: "Solfin" },
];

type LenderState = { docs_given: boolean; approved: boolean; rejected: boolean };
type LenderMap = Partial<Record<Lender, LenderState>>;

type SortKey = "created_at" | "status";
type SortDir = "asc" | "desc";

function maskMobile(m: string | null): string {
  if (!m) return "—";
  return m.length === 10 ? "•••••" + m.slice(5) : m;
}

// ── Icons (inline SVG) ─────────────────────────────────────────────
const IconBuilding = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 21V9M15 21V9M4 9h16M9 6h.01M15 6h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01" />
  </svg>
);
const IconGlobe = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
  </svg>
);
const IconUserPlus = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0M18 8v6M15 11h6" />
  </svg>
);
const IconEye = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const IconDownload = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" />
  </svg>
);
const IconArrowUp = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5m-6 6 6-6 6 6" />
  </svg>
);
const IconArrowDown = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14m-6-6 6 6 6-6" />
  </svg>
);

function EpcsTab() {
  const router = useRouter();
  type Row = {
    id: string;
    epc_display_id: string | null;
    legal_name: string | null;
    trade_name: string | null;
    contact_name: string | null;
    contact_mobile: string | null;
    contact_email: string | null;
    business_type: string | null;
    status: string;
    source: string | null;
    created_at: string;
    submitted_at: string | null;
    epc_self_edited: boolean | null;
    reviewed_at: string | null;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [lenderFilter, setLenderFilter] = useState("");
  const [lenderStateFilter, setLenderStateFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [lenderState, setLenderState] = useState<Record<string, LenderMap>>({});
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [zipPickerRow, setZipPickerRow] = useState<Row | null>(null);
  // Row highlighted after returning from View. sessionStorage-backed so
  // it survives navigation but not full reload.
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // On mount (and after rows load) restore scroll position and mark the
  // last-viewed row for a brief highlight, then clear the sessionStorage
  // so a fresh session doesn't inherit stale state.
  useEffect(() => {
    if (rows.length === 0) return;
    const savedScroll = sessionStorage.getItem("adminList.scroll");
    const savedRow    = sessionStorage.getItem("adminList.lastRowId");
    if (savedScroll) {
      const y = parseInt(savedScroll, 10);
      if (!isNaN(y)) window.scrollTo(0, y);
    }
    if (savedRow) {
      setHighlightId(savedRow);
      const t = window.setTimeout(() => setHighlightId(null), 2100);
      // Clear immediately — we've consumed it.
      sessionStorage.removeItem("adminList.lastRowId");
      sessionStorage.removeItem("adminList.scroll");
      return () => window.clearTimeout(t);
    }
    sessionStorage.removeItem("adminList.lastRowId");
    sessionStorage.removeItem("adminList.scroll");
  }, [rows.length]);

  // Save scroll + row id, then navigate to View.
  function navigateToView(row: Row) {
    sessionStorage.setItem("adminList.scroll", String(window.scrollY));
    sessionStorage.setItem("adminList.lastRowId", row.id);
    router.push(`/admin/epc/${row.id}/view` as any);
  }

  async function load() {
    let query = supabase().from("epc_business")
      .select("id, epc_display_id, legal_name, trade_name, contact_name, contact_mobile, contact_email, business_type, status, source, created_at, submitted_at, epc_self_edited, reviewed_at")
      .neq("business_type", "admin");
    if (statusFilter) query = query.eq("status", statusFilter);
    const { data } = await query;
    const rs = (data ?? []) as Row[];
    setRows(rs);

    if (rs.length > 0) {
      const ids = rs.map((r) => r.id);
      const { data: lenderRows } = await supabase()
        .from("epc_lender_status")
        .select("business_id, lender, docs_given, approved, rejected")
        .in("business_id", ids);
      const map: Record<string, LenderMap> = {};
      for (const lr of (lenderRows ?? []) as { business_id: string; lender: Lender; docs_given: boolean; approved: boolean; rejected: boolean }[]) {
        if (!map[lr.business_id]) map[lr.business_id] = {};
        map[lr.business_id][lr.lender] = { docs_given: lr.docs_given, approved: lr.approved, rejected: !!lr.rejected };
      }
      setLenderState(map);
    } else {
      setLenderState({});
    }
  }

  useEffect(() => { void load(); }, [statusFilter]);

  // Category predicate — shared by the summary-card counts AND the table
  // filter so a card's count equals the rows it shows. "" = all.
  function catMatch(r: Row, key: string): boolean {
    switch (key) {
      case "unseen":          return r.reviewed_at == null;
      case "under_review":    return r.status === "under_review";
      case "docs_sent":       return Object.values(lenderState[r.id] ?? {}).some((v) => v?.docs_given);
      case "lender_approved": return Object.values(lenderState[r.id] ?? {}).some((v) => v?.approved);
      default:                return true;
    }
  }

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (categoryFilter && !catMatch(r, categoryFilter)) return false;
      // Text search across name / id / POC / mobile / email.
      if (ql) {
        const hit =
          (r.legal_name || "").toLowerCase().includes(ql) ||
          (r.trade_name || "").toLowerCase().includes(ql) ||
          (r.epc_display_id || "").toLowerCase().includes(ql) ||
          (r.contact_name || "").toLowerCase().includes(ql) ||
          (r.contact_mobile || "").includes(q.trim()) ||
          (r.contact_email || "").toLowerCase().includes(ql);
        if (!hit) return false;
      }
      // Source — Website (default/anything) vs Manual.
      if (sourceFilter) {
        const isManual = (r.source || "website").toLowerCase() === "manual";
        if (sourceFilter === "manual" && !isManual) return false;
        if (sourceFilter === "website" && isManual) return false;
      }
      // Lender + state — a lender that has the chosen state ticked. If only a
      // lender is chosen, match any of its states; if only a state, match any
      // lender in that state.
      if (lenderFilter || lenderStateFilter) {
        const m = lenderState[r.id] ?? {};
        if (lenderFilter) {
          const ls = m[lenderFilter as Lender];
          if (!ls) return false;
          if (lenderStateFilter) {
            if (!ls[lenderStateFilter as keyof LenderState]) return false;
          } else if (!(ls.docs_given || ls.approved || ls.rejected)) {
            return false;
          }
        } else if (lenderStateFilter) {
          const any = Object.values(m).some(
            (v) => v && v[lenderStateFilter as keyof LenderState],
          );
          if (!any) return false;
        }
      }
      // Created-date range (inclusive From / To).
      if (dateFrom || dateTo) {
        const t = new Date(r.created_at).getTime();
        if (dateFrom && t < new Date(dateFrom + "T00:00:00").getTime()) return false;
        if (dateTo && t > new Date(dateTo + "T23:59:59.999").getTime()) return false;
      }
      return true;
    });
    const sorted = [...base].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortKey === "created_at") {
        av = new Date(a.created_at).getTime() || 0;
        bv = new Date(b.created_at).getTime() || 0;
      } else if (sortKey === "status") {
        av = a.status || "";
        bv = b.status || "";
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, categoryFilter, sourceFilter, lenderFilter, lenderStateFilter, dateFrom, dateTo, lenderState, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  async function toggleLender(epcId: string, lender: Lender, field: "docs_given" | "approved" | "rejected", value: boolean) {
    if (field === "approved") {
      const msg = value === true
        ? "Are you sure for this approval?"
        : "Are you sure you want to un-approve this?";
      if (!window.confirm(msg)) return;
    }
    if (field === "rejected") {
      const msg = value === true
        ? "Mark this lender as Rejected?"
        : "Clear the Rejected mark for this lender?";
      if (!window.confirm(msg)) return;
    }

    // Approved and Rejected are mutually exclusive — ticking one clears
    // the other. Docs is independent. Build the boolean patch + the DB
    // patch (incl. rejected_at) together so both fields move atomically.
    const boolPatch: Partial<LenderState> = { [field]: value } as Partial<LenderState>;
    const dbPatch: Record<string, unknown> = { [field]: value };
    if (field === "approved" && value) {
      boolPatch.rejected = false;
      dbPatch.rejected = false;
      dbPatch.rejected_at = null;
    } else if (field === "rejected") {
      dbPatch.rejected_at = value ? new Date().toISOString() : null;
      if (value) { boolPatch.approved = false; dbPatch.approved = false; }
    }

    const prevState = lenderState;
    setLenderState((s) => {
      const next = { ...s };
      const cur = (next[epcId] ?? {}) as LenderMap;
      const lenderCur = (cur[lender] ?? { docs_given: false, approved: false, rejected: false }) as LenderState;
      next[epcId] = { ...cur, [lender]: { ...lenderCur, ...boolPatch } };
      return next;
    });
    try {
      const { data: existing } = await supabase()
        .from("epc_lender_status")
        .select("id")
        .eq("business_id", epcId)
        .eq("lender", lender)
        .maybeSingle();
      if (existing) {
        await supabase()
          .from("epc_lender_status")
          .update(dbPatch)
          .eq("id", (existing as { id: string }).id);
      } else {
        const row: Record<string, unknown> = {
          business_id: epcId, lender, docs_given: false, approved: false, rejected: false,
          ...dbPatch,
        };
        await supabase().from("epc_lender_status").insert(row);
      }
    } catch (e) {
      setLenderState(prevState);
      alert("Couldn't save lender state: " + (e as Error).message);
    }
  }

  async function downloadZip(row: Row, lender: LenderKey) {
    if (downloading[row.id]) return;
    setDownloading((d) => ({ ...d, [row.id]: true }));
    try {
      const res = await fetch(`/api/epc/${row.id}/download-zip?lender=${lender}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      const fallback = `EPC_${row.id.slice(0, 8)}.zip`;
      const a = document.createElement("a");
      a.href = url;
      a.download = m?.[1] || fallback;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Download failed: " + ((e as Error)?.message ?? String(e)));
    } finally {
      setDownloading((d) => { const next = { ...d }; delete next[row.id]; return next; });
    }
  }

  const cards: SummaryCard[] = [
    { key: "",                label: "Total Applications",  value: rows.length },
    { key: "under_review",    label: "Under Review",        value: rows.filter((r) => catMatch(r, "under_review")).length },
    { key: "unseen",          label: "Application Unseen",  value: rows.filter((r) => catMatch(r, "unseen")).length },
    { key: "docs_sent",       label: "Docs Sent to Lender", value: rows.filter((r) => catMatch(r, "docs_sent")).length },
    { key: "lender_approved", label: "Lender Approved",     value: rows.filter((r) => catMatch(r, "lender_approved")).length },
  ];
  const panelActive = [statusFilter, sourceFilter, lenderFilter, lenderStateFilter, dateFrom, dateTo].filter(Boolean).length;
  const activeCount = panelActive + (categoryFilter ? 1 : 0);
  const pickCategory = (key: string) => setCategoryFilter(key === categoryFilter ? "" : key);
  function clearAll() {
    setStatusFilter(""); setSourceFilter(""); setLenderFilter(""); setLenderStateFilter("");
    setDateFrom(""); setDateTo(""); setCategoryFilter("");
  }

  return (
    <>
      <SummaryCards accent={ACCENTS.epcs.color} cards={cards} active={categoryFilter} onPick={pickCategory} />

      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1">
          <Input
            placeholder="Search by name, ID, POC, mobile, or email…"
            value={q}
            onChange={(e) => setQ(capPhone(e.target.value))}
          />
        </div>
        <FiltersButton count={activeCount} open={filtersOpen} accent={ACCENTS.epcs.color} onClick={() => setFiltersOpen((o) => !o)} />
        <Button type="button" variant="primary" onClick={() => setAddOpen(true)} className="whitespace-nowrap">
          + Add New EPC
        </Button>
      </div>

      <FiltersPanel open={filtersOpen} hasActive={activeCount > 0} onClear={clearAll}>
        <Select
          placeholder="Internal status"
          options={[
            { value: "draft", label: "Draft" },
            { value: "under_review", label: "Under review" },
            { value: "approved", label: "Approved" },
            { value: "on_hold", label: "On hold" },
            { value: "rejected", label: "Rejected" },
          ]}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
        <Select
          placeholder="Source"
          options={[
            { value: "website", label: "Website" },
            { value: "manual", label: "Manual" },
          ]}
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        />
        <Select
          placeholder="Lender"
          options={LENDERS.map((l) => ({ value: l.key, label: l.label }))}
          value={lenderFilter}
          onChange={(e) => setLenderFilter(e.target.value)}
        />
        <Select
          placeholder="Lender status"
          options={[
            { value: "docs_given", label: "Has docs" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ]}
          value={lenderStateFilter}
          onChange={(e) => setLenderStateFilter(e.target.value)}
        />
        <Input type="date" label="Created from" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input type="date" label="Created to" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </FiltersPanel>

      <Card className="overflow-hidden">
        <table className="w-full text-[14px] table-fixed">
          {/* Percentage widths — the table fills the page evenly and never
              needs a horizontal scrollbar (matches the loan table). Internal
              status keeps room for the status + UPDATED pills side by side. */}
          <colgroup>
            <col style={{ width: "26%" }} />
            <col style={{ width: "9%"  }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "22%" }} />
          </colgroup>
          {/* Everything centred except EPC details, which stays left. */}
          <thead className="bg-[#f0faf5] border-b border-[#cdeadd] text-[#5a8a76]">
            <tr>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-left">EPC details</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Source</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">
                <button type="button" onClick={() => toggleSort("created_at")} className="inline-flex items-center gap-1 uppercase tracking-wide">
                  Profile created
                  <SortMark active={sortKey === "created_at"} dir={sortDir} />
                </button>
              </th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">
                <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1 uppercase tracking-wide">
                  Internal status
                  <SortMark active={sortKey === "status"} dir={sortDir} />
                </button>
              </th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Action</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Lenders</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-[#5a8a76]">No EPCs match.</td></tr>
            ) : filtered.map((r) => {
              const isHighlighted = highlightId === r.id;
              return (
              <tr
                key={r.id}
                data-highlighted={isHighlighted ? "yes" : undefined}
                style={{
                  transition: "background-color 2s ease-out",
                  backgroundColor: isHighlighted ? "#dceffb" : undefined,
                }}
                className="border-b border-[#eaf3ee] hover:bg-[#f7fcfa] align-top"
              >
                <td className="px-3 py-3">
                  <div className="flex items-start gap-3">
                    <div
                      className="w-9 h-9 rounded-md bg-[#d6efe3] text-[#178a5c] grid place-items-center shrink-0 cursor-pointer"
                      onClick={() => navigateToView(r)}
                    >
                      {IconBuilding}
                    </div>
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => navigateToView(r)}
                    >
                      <p className="text-[13px] font-semibold text-[#0f3d2e] truncate">
                        {r.trade_name || r.legal_name ||
                          <span className="text-[#5a8a76] font-normal">—</span>}
                      </p>
                      {r.epc_display_id && (
                        <p className="text-[11px] font-mono text-[#185fa5]">{r.epc_display_id}</p>
                      )}
                      <p className="text-[12px] text-[#5a8a76]">
                        +91 {maskMobile(r.contact_mobile)}
                      </p>
                      {r.contact_email && (
                        <p className="text-[11px] text-[#5a8a76] truncate">{r.contact_email}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-center">
                  <SourcePill source={r.source} />
                </td>
                <td className="px-3 py-3 text-center">
                  <p className="text-[13px] font-semibold text-[#0f3d2e]">
                    {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                  <p className="text-[11px] text-[#5a8a76] mt-0.5">
                    {new Date(r.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </td>
                <td className="px-3 py-3 text-center">
                  <StatusBadge status={r.status} updated={r.epc_self_edited === true} />
                </td>
                <td className="px-3 py-3 text-center">
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => navigateToView(r)}
                      className="text-[12px] font-semibold px-2.5 py-1.5 rounded-input border border-[#185fa5]/30 bg-white text-[#185fa5] hover:bg-[#dceffb] inline-flex items-center justify-center gap-1.5"
                    >
                      {IconEye} View
                    </button>
                    <button
                      type="button"
                      disabled={!!downloading[r.id]}
                      onClick={() => setZipPickerRow(r)}
                      className={[
                        "text-[12px] font-semibold px-2.5 py-1.5 rounded-input border transition-colors inline-flex items-center justify-center gap-1.5",
                        downloading[r.id]
                          ? "border-line bg-bg-soft text-text-muted cursor-not-allowed"
                          : "border-[#178a5c]/30 bg-white text-[#178a5c] hover:bg-[#f0faf5]",
                      ].join(" ")}
                    >
                      {IconDownload} {downloading[r.id] ? "Preparing…" : "Download ZIP"}
                    </button>
                  </div>
                </td>
                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <LenderCell
                    state={lenderState[r.id] ?? {}}
                    onToggle={(lender, field, v) => toggleLender(r.id, lender, field, v)}
                  />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <AddNewEpcModal open={addOpen} onClose={() => setAddOpen(false)} />
      <LenderPickerModal
        open={!!zipPickerRow}
        onClose={() => setZipPickerRow(null)}
        epcName={zipPickerRow ? (zipPickerRow.trade_name || zipPickerRow.legal_name || zipPickerRow.contact_name) : null}
        onConfirm={async (lender) => {
          const row = zipPickerRow;
          if (!row) return;
          await downloadZip(row, lender);
        }}
      />
    </>
  );
}

function SortMark({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="opacity-30">{IconArrowDown}</span>;
  return dir === "asc" ? IconArrowUp : IconArrowDown;
}

function SourcePill({ source }: { source: string | null }) {
  const s = (source || "website").toLowerCase();
  const isManual = s === "manual";
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full",
        isManual
          ? "bg-[#fef0d6] text-[#854f0b]"
          : "bg-[#dceffb] text-[#185fa5]",
      ].join(" ")}
    >
      {isManual ? IconUserPlus : IconGlobe}
      {isManual ? "Manual" : "Website"}
    </span>
  );
}

function LenderCell({
  state, onToggle,
}: {
  state: LenderMap;
  onToggle: (lender: Lender, field: "docs_given" | "approved" | "rejected", value: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      {LENDERS.map((l) => {
        const s = state[l.key] ?? { docs_given: false, approved: false, rejected: false };
        return (
          <div key={l.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            <span className="min-w-[58px] font-medium text-[#0f3d2e] whitespace-nowrap">{l.label}</span>
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={s.docs_given}
                onChange={(e) => onToggle(l.key, "docs_given", e.target.checked)}
                className="h-3.5 w-3.5 accent-[#185fa5]"
              />
              <span className="text-[#5a8a76]">Docs</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={s.approved}
                onChange={(e) => onToggle(l.key, "approved", e.target.checked)}
                className="h-3.5 w-3.5 accent-[#178a5c]"
              />
              <span className="text-[#5a8a76]">Approved</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!s.rejected}
                onChange={(e) => onToggle(l.key, "rejected", e.target.checked)}
                className="h-3.5 w-3.5 accent-[#dc2626]"
              />
              <span className="text-[#5a8a76]">Rejected</span>
            </label>
          </div>
        );
      })}
    </div>
  );
}

// ── Loan applications tab (unchanged) ──────────────────────────────────────

function AppsTab() {
  const router = useRouter();
  type Row = {
    id: string;
    // Borrower fallback chain: borrower_name → aadhaar_name (Step 2 KYC) → "—".
    borrower_name: string | null;
    aadhaar_name:  string | null;
    aadhaar_number_masked: string | null;
    loan_display_id: string | null;
    // Loan amount lives in loan_amount_required (Step 3). loan_amount is
    // the legacy 0001 column — read both, prefer the newer one.
    loan_amount: number | null;
    loan_amount_required: number | null;
    // Disbursement (migration 0044). sanctioned_amount replaces the applied
    // amount in the Amount column once the loan is approved.
    sanctioned_amount: number | null;
    first_disbursement_amount: number | null;
    first_disbursement_date: string | null;
    status: string; created_at: string; created_by: string;
    reviewed_at: string | null;
    // Application-doc presence for the "Documents Pending" card. Applicant PAN
    // is a user_application_docs row (see panDocIds); everything else is a
    // *_path column. Co-applicant docs only required when has_coapp.
    aadhaar_front_path: string | null;
    aadhaar_back_path: string | null;
    ebill_path: string | null;
    proforma_invoice_path: string | null;
    rooftop_photo_path: string | null;
    bank_statement_path: string | null;
    customer_photo_path: string | null;
    // false = a co-applicant was added (its docs then become required).
    bill_on_applicant_name: boolean | null;
    coapp_pan_path: string | null;
    coapp_aadhaar_front_path: string | null;
    coapp_aadhaar_back_path: string | null;
    // Which lender decided — powers the Lender filter (display/filter only).
    approved_lender: string | null;
    rejected_lender: string | null;
    epc_business: { contact_name: string | null; trade_name: string | null; legal_name: string | null; epc_display_id: string | null } | null;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // Client-side filters over the already-loaded list.
  const [epcFilter, setEpcFilter]       = useState("");
  const [lenderFilter, setLenderFilter] = useState("");
  // Single month+year picker ("YYYY-MM") — filters to applications created in
  // that calendar month.
  const [createdMonth, setCreatedMonth] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Loan IDs that have an applicant-PAN doc row (batched in one request).
  const [panDocIds, setPanDocIds] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [zipBusy, setZipBusy] = useState<string | null>(null);
  // Row whose Download ZIP popup is open — the lender picker is the same
  // component the EPC list uses.
  const [zipPickerRow, setZipPickerRow] = useState<Row | null>(null);
  // Row highlighted after returning from View — same behaviour as the EPC
  // list, with its own sessionStorage keys.
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // On mount (and after rows load) restore scroll position and mark the
  // last-viewed row for a brief highlight, then clear the sessionStorage so a
  // fresh session doesn't inherit stale state.
  useEffect(() => {
    if (rows.length === 0) return;
    const savedScroll = sessionStorage.getItem("appsList.scroll");
    const savedRow    = sessionStorage.getItem("appsList.lastRowId");
    if (savedScroll) {
      const y = parseInt(savedScroll, 10);
      if (!isNaN(y)) window.scrollTo(0, y);
    }
    if (savedRow) {
      setHighlightId(savedRow);
      const t = window.setTimeout(() => setHighlightId(null), 2100);
      sessionStorage.removeItem("appsList.lastRowId");
      sessionStorage.removeItem("appsList.scroll");
      return () => window.clearTimeout(t);
    }
    sessionStorage.removeItem("appsList.lastRowId");
    sessionStorage.removeItem("appsList.scroll");
  }, [rows.length]);

  // Save scroll + row id + the active tab, then navigate to View. The tab key
  // is what brings Back to the Loan applications tab rather than EPCs.
  function navigateToView(row: Row) {
    sessionStorage.setItem("appsList.scroll", String(window.scrollY));
    sessionStorage.setItem("appsList.lastRowId", row.id);
    sessionStorage.setItem("adminList.tab", "apps");
    router.push(`/admin/app/${row.id}/view` as any);
  }

  useEffect(() => {
    (async () => {
      let query = supabase()
        .from("epc_applications")
        .select(
          "id, borrower_name, aadhaar_name, aadhaar_number_masked, loan_display_id, " +
          "loan_amount, loan_amount_required, " +
          "sanctioned_amount, first_disbursement_amount, first_disbursement_date, " +
          "status, created_at, created_by, reviewed_at, approved_lender, rejected_lender, " +
          "aadhaar_front_path, aadhaar_back_path, ebill_path, proforma_invoice_path, " +
          "rooftop_photo_path, bank_statement_path, customer_photo_path, bill_on_applicant_name, " +
          "coapp_pan_path, coapp_aadhaar_front_path, coapp_aadhaar_back_path, " +
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .order("created_at", { ascending: false });
      // Filter maps a lender-outcome bucket to its underlying statuses.
      if (statusFilter && statusFilter in OUTCOME_STATUSES) {
        query = query.in("status", OUTCOME_STATUSES[statusFilter as LenderOutcome]);
      }
      const { data } = await query;
      const rs = (data ?? []) as unknown as Row[];
      setRows(rs);
      // ONE batched request: which loaded loans have an applicant-PAN doc row
      // (the only application doc without a *_path column). Merged client-side.
      const ids = rs.map((r) => r.id);
      if (ids.length) {
        const { data: panDocs } = await supabase()
          .from("user_application_docs")
          .select("application_id")
          .eq("category", "borrower_pan")
          .in("application_id", ids);
        setPanDocIds(new Set((panDocs ?? []).map((d) => (d as { application_id: string }).application_id)));
      } else {
        setPanDocIds(new Set());
      }
    })();
  }, [statusFilter]);

  // Display helpers — encapsulated so the render below stays clean.
  function displayBorrower(r: Row): string {
    return r.borrower_name || r.aadhaar_name || "—";
  }
  function displayEpc(r: Row): string {
    return r.epc_business?.trade_name
        || r.epc_business?.legal_name
        || r.epc_business?.contact_name
        || "—";
  }
  // Approved → show what the lender SANCTIONED; otherwise what was applied for.
  function displayAmount(r: Row): string {
    return fmtRupees(amountFor(r));
  }
  // Masked Aadhaar display: "xxxxxxxx1234" (stored) → "XXXX XXXX 1234".
  function displayMaskedAadhaar(r: Row): string | null {
    const m = r.aadhaar_number_masked;
    if (!m) return null;
    const last4 = m.slice(-4);
    return `XXXX XXXX ${last4}`;
  }

  // Streams the loan-app ZIP through the admin's bearer token and
  // triggers a browser download. Mirrors the EPC list's ZIP flow.
  async function downloadLoanZip(r: Row, lender: LenderKey) {
    if (zipBusy) return;
    setZipBusy(r.id);
    try {
      const res = await fetch(`/api/admin/loan-app/${r.id}/download-zip?lender=${lender}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert("ZIP failed: " + (data?.error || `HTTP ${res.status}`));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${r.loan_display_id || r.id.slice(0, 8)}_${(displayBorrower(r) || "loan").replace(/[^\w-]+/g, "_")}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setZipBusy(null);
    }
  }

  // EPC options for the filter dropdown — only EPCs actually present in the list.
  const epcOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      const name = displayEpc(r);
      if (name && name !== "—") seen.add(name);
    }
    return [...seen].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Client-side filter, then sort: rows with a RUNNING disbursement countdown
  // first (fewest days remaining on top — overdue is negative, so it floats to
  // the very top), everything else below, newest first. The query is untouched.
  function loanDocsPending(r: Row): boolean {
    if (!panDocIds.has(r.id)) return true;                          // applicant PAN
    if (!r.aadhaar_front_path || !r.aadhaar_back_path) return true; // applicant Aadhaar
    if (!r.proforma_invoice_path) return true;                      // quotation / proforma
    if (!r.ebill_path) return true;                                 // electricity bill
    if (!r.rooftop_photo_path) return true;                         // rooftop photo
    if (!r.customer_photo_path) return true;                        // customer photo
    if (!r.bank_statement_path) return true;                        // bank statement
    if (r.bill_on_applicant_name === false && (!r.coapp_pan_path || !r.coapp_aadhaar_front_path || !r.coapp_aadhaar_back_path)) return true;
    return false;
  }
  // Category predicate — shared by the card counts AND the table filter.
  function catMatch(r: Row, key: string): boolean {
    switch (key) {
      case "unseen":       return r.reviewed_at == null;
      case "docs_pending": return loanDocsPending(r);
      case "under_review": return lenderOutcome(r.status) === "review";
      case "approved":     return lenderOutcome(r.status) === "approved";
      case "rejected":     return lenderOutcome(r.status) === "rejected";
      case "disbursed":    return r.status === "approved" && r.first_disbursement_amount != null;
      default:             return true;
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Local calendar month of a row's created_at, as "YYYY-MM".
    const monthOf = (v: string) => {
      const d = new Date(v);
      return isNaN(d.getTime())
        ? ""
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    };

    const out = rows.filter((r) => {
      if (categoryFilter && !catMatch(r, categoryFilter)) return false;
      if (needle &&
          !(displayBorrower(r).toLowerCase().includes(needle) ||
            (r.loan_display_id ?? "").toLowerCase().includes(needle) ||
            displayEpc(r).toLowerCase().includes(needle))) return false;
      if (epcFilter && displayEpc(r) !== epcFilter) return false;
      if (lenderFilter && String(r.approved_lender ?? r.rejected_lender ?? "") !== lenderFilter) return false;
      if (createdMonth && monthOf(r.created_at) !== createdMonth) return false;
      return true;
    });

    const running = (r: Row) => r.status === "approved" && !!r.first_disbursement_date;
    return out.sort((a, b) => {
      const ra = running(a), rb = running(b);
      if (ra !== rb) return ra ? -1 : 1;
      if (ra && rb) {
        return deadlineState(a.first_disbursement_date).daysRemaining
             - deadlineState(b.first_disbursement_date).daysRemaining;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, categoryFilter, panDocIds, epcFilter, lenderFilter, createdMonth]);

  const cards: SummaryCard[] = [
    { key: "",             label: "Total Applications",    value: rows.length },
    { key: "unseen",       label: "Application Unseen",    value: rows.filter((r) => catMatch(r, "unseen")).length },
    { key: "docs_pending", label: "Documents Pending",     value: rows.filter((r) => catMatch(r, "docs_pending")).length },
    { key: "under_review", label: "Under Review",          value: rows.filter((r) => catMatch(r, "under_review")).length },
    { key: "approved",     label: "Sanctioned / Approved", value: rows.filter((r) => catMatch(r, "approved")).length },
    { key: "rejected",     label: "Rejected",              value: rows.filter((r) => catMatch(r, "rejected")).length },
    { key: "disbursed",    label: "Total Disbursed",       value: rows.filter((r) => catMatch(r, "disbursed")).length },
  ];
  const panelActive = [statusFilter, epcFilter, lenderFilter, createdMonth].filter(Boolean).length;
  const activeCount = panelActive + (categoryFilter ? 1 : 0);
  const pickCategory = (key: string) => setCategoryFilter(key === categoryFilter ? "" : key);
  function clearAll() {
    setStatusFilter(""); setEpcFilter(""); setLenderFilter(""); setCreatedMonth(""); setCategoryFilter("");
  }

  return (
    <>
      <SummaryCards accent={ACCENTS.apps.color} cards={cards} active={categoryFilter} onPick={pickCategory} />

      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1">
          <Input placeholder="Search by borrower…" value={q} onChange={(e) => setQ(capPhone(e.target.value))} />
        </div>
        <FiltersButton count={activeCount} open={filtersOpen} accent={ACCENTS.apps.color} onClick={() => setFiltersOpen((o) => !o)} />
        <Button variant="primary" onClick={() => setAddOpen(true)} style={{ backgroundColor: ACCENTS.apps.color }} className="whitespace-nowrap">
          + Add New Loan Application
        </Button>
      </div>

      <FiltersPanel open={filtersOpen} hasActive={activeCount > 0} onClear={clearAll}>
        <Select
          placeholder="Status filter"
          options={[
            { value: "review",   label: "Under Review" },
            { value: "approved", label: "Approved by lender" },
            { value: "rejected", label: "Rejected by lender" },
          ]}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
        <Select
          placeholder="EPC partner"
          options={epcOptions}
          value={epcFilter}
          onChange={(e) => setEpcFilter(e.target.value)}
        />
        <Select
          placeholder="Lender"
          options={[
            { value: "creditfair", label: "CreditFair" },
            { value: "aerem",      label: "Aerem" },
            { value: "solfin",     label: "Solfin" },
          ]}
          value={lenderFilter}
          onChange={(e) => setLenderFilter(e.target.value)}
        />
        <Input type="month" label="Created month" value={createdMonth} onChange={(e) => setCreatedMonth(e.target.value)} />
      </FiltersPanel>

      <Card className="overflow-hidden">
        <table className="w-full text-[14px] table-fixed">
          {/* Percentage widths — the table fills the page evenly and never
              needs a horizontal scrollbar. */}
          <colgroup>
            <col style={{ width: "17%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "9%"  }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "9%"  }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "8%"  }} />
            <col style={{ width: "11%" }} />
          </colgroup>
          {/* Everything centred except Borrower details, which stays left. */}
          <thead className="bg-[#f0faf5] border-b border-[#cdeadd] text-[#5a8a76]">
            <tr>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-left">Borrower details</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">EPC partner</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Amount</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Status</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Disbursement</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Days remaining</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Added on</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Created by</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-5 py-10 text-center text-[#5a8a76]">No applications match.</td></tr>
            ) : filtered.map((r) => {
              const isHighlighted = highlightId === r.id;
              return (
              <tr
                key={r.id}
                data-highlighted={isHighlighted ? "yes" : undefined}
                style={{
                  transition: "background-color 2s ease-out",
                  backgroundColor: isHighlighted ? "#dceffb" : undefined,
                }}
                onClick={() => navigateToView(r)}
                className="border-b border-[#eaf3ee] cursor-pointer hover:bg-[#f7fcfa] align-top"
              >
                {/* Borrower detail box: name + CC id + masked Aadhaar */}
                <td className="px-3 py-3">
                  <p className="text-[13px] font-semibold text-[#0f3d2e] truncate">{displayBorrower(r)}</p>
                  {r.loan_display_id && (
                    <p className="text-[11px] font-mono text-[#185fa5] mt-0.5">{r.loan_display_id}</p>
                  )}
                  {displayMaskedAadhaar(r) && (
                    <p className="text-[11px] font-mono text-[#5a8a76] mt-0.5">{displayMaskedAadhaar(r)}</p>
                  )}
                </td>
                {/* EPC partner — name + EPC ID text only. */}
                <td className="px-3 py-3 text-center">
                  <p className="text-[13px] text-[#0f3d2e] truncate">{displayEpc(r)}</p>
                  {r.epc_business?.epc_display_id && (
                    <p className="text-[11px] font-mono text-[#5a8a76] mt-0.5">{r.epc_business.epc_display_id}</p>
                  )}
                </td>
                <td className="px-3 py-3 text-center text-[13px] font-semibold text-[#0f3d2e]">{displayAmount(r)}</td>
                {/* Loan apps have no internal admin status — show the lender
                    outcome (same 3 buckets as the EPC's own view). Once the 1st
                    disbursement is entered, surface that instead — display-only,
                    the underlying status field is unchanged. */}
                <td className="px-3 py-3 text-center">
                  {r.status === "draft" ? (
                    <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-[#eef1f0] text-[#5a8a76]">
                      Draft
                    </span>
                  ) : r.status === "approved" && r.first_disbursement_amount != null ? (
                    <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-[#dceffb] text-[#185fa5]">
                      1st Disbursement Done
                    </span>
                  ) : (
                    <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${OUTCOME_PILL[lenderOutcome(r.status)]}`}>
                      {OUTCOME_LABEL[lenderOutcome(r.status)]}
                    </span>
                  )}
                </td>
                {/* Disbursement + countdown — only meaningful once approved. */}
                <td className="px-3 py-3 text-center">
                  {r.status !== "approved" ? (
                    <span className="text-[13px] text-[#5a8a76]">—</span>
                  ) : r.first_disbursement_amount != null ? (
                    <>
                      <p className="text-[13px] font-semibold text-[#0f3d2e]">{fmtRupees(r.first_disbursement_amount)}</p>
                      <p className="text-[11px] text-[#5a8a76] mt-0.5">{fmtDateShort(r.first_disbursement_date)}</p>
                    </>
                  ) : (
                    <span className="text-[13px] text-[#5a8a76]">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {r.status !== "approved" ? (
                    <span className="text-[13px] text-[#5a8a76]">—</span>
                  ) : (() => {
                    const dl = deadlineState(r.first_disbursement_date);
                    return (
                      <span className={["inline-block px-2 py-1 rounded-[6px] text-[11px] font-semibold whitespace-nowrap", DEADLINE_PILL[dl.tone]].join(" ")}>
                        {dl.label}
                      </span>
                    );
                  })()}
                </td>
                {/* Added on — date bold dark, time smaller grey beneath. */}
                <td className="px-3 py-3 text-center">
                  <p className="text-[13px] font-semibold text-[#0f3d2e]">{fmtAddedDate(r.created_at)}</p>
                  <p className="text-[11px] text-[#5a8a76] mt-0.5">{fmtAddedTime(r.created_at)}</p>
                </td>
                <td className="px-3 py-3 text-center text-[13px] text-[#5a8a76]">
                  {r.created_by === "admin" ? "Admin" : "Customer"}
                </td>
                {/* Action: View + Download ZIP. stopPropagation so the
                    buttons don't also trigger the row's navigate. */}
                {/* Action buttons — same shape/icons as the EPC list. */}
                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => navigateToView(r)}
                      className="text-[12px] font-semibold px-2.5 py-1.5 rounded-input border border-[#185fa5]/30 bg-white text-[#185fa5] hover:bg-[#dceffb] inline-flex items-center justify-center gap-1.5"
                    >
                      {IconEye} View
                    </button>
                    <button
                      type="button"
                      disabled={zipBusy === r.id}
                      onClick={() => setZipPickerRow(r)}
                      title="Download all documents + summary as ZIP"
                      className={[
                        "text-[12px] font-semibold px-2.5 py-1.5 rounded-input border transition-colors inline-flex items-center justify-center gap-1.5",
                        zipBusy === r.id
                          ? "border-line bg-bg-soft text-text-muted cursor-not-allowed"
                          : "border-[#178a5c]/30 bg-white text-[#178a5c] hover:bg-[#f0faf5]",
                      ].join(" ")}
                    >
                      {IconDownload} {zipBusy === r.id ? "Preparing…" : "Download ZIP"}
                    </button>
                    {/* Disbursement moved to the View profile (under the status
                        band) — approved rows reach it via View. */}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <AddNewLoanAppModal open={addOpen} onClose={() => setAddOpen(false)} />

      {/* Same lender picker the EPC list uses — the chosen lender stamps
          "Submitted to" in the Excel and lands in the ZIP filename. */}
      <LenderPickerModal
        open={!!zipPickerRow}
        onClose={() => setZipPickerRow(null)}
        epcName={zipPickerRow ? displayBorrower(zipPickerRow) : null}
        onConfirm={async (lender) => {
          const row = zipPickerRow;
          if (!row) return;
          await downloadLoanZip(row, lender);
        }}
      />
    </>
  );
}

// ── Insurance tab ──────────────────────────────────────────────────────────
//
// Same chrome as the EPC / Loan tables (green header, #eaf3ee rows). Lists
// insurance_applications with View + Edit + Download ZIP. Shares the loan
// list's scroll-restore + #dceffb highlight (appsList.* keys); the
// "insurance" tab is restored on Back.
function InsuranceTab() {
  const router = useRouter();
  type Row = {
    id: string;
    insurance_display_id: string | null;
    aadhaar_name: string | null;
    pan_number: string | null;
    sum_insured: number | null;
    invoice_confirmed_amount: number | null;
    invoice_amount: number | null;
    insurance_partner: string | null;
    policy_from_date: string | null;
    policy_to_date: string | null;
    // Storage path of the uploaded policy document — drives the Download
    // Policy button (hidden when there's no policy).
    policy_path: string | null;
    // Doc presence for the "Docs Pending" card (all *_path columns).
    pan_path: string | null;
    aadhaar_front_path: string | null;
    aadhaar_back_path: string | null;
    plant_photo_path: string | null;
    ebill_path: string | null;
    invoice_path: string | null;
    status: string;
    created_at: string;
    epc_business: { contact_name: string | null; trade_name: string | null; legal_name: string | null; epc_display_id: string | null } | null;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [zipBusy, setZipBusy] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Client-side filters over the already-loaded list (the query is untouched).
  const [statusFilter, setStatusFilter] = useState("");
  const [epcFilter, setEpcFilter]       = useState("");
  const [expiryFilter, setExpiryFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase()
        .from("insurance_applications")
        .select(
          "id, insurance_display_id, aadhaar_name, pan_number, sum_insured, invoice_confirmed_amount, " +
          "invoice_amount, insurance_partner, policy_from_date, policy_to_date, policy_path, status, created_at, " +
          "pan_path, aadhaar_front_path, aadhaar_back_path, plant_photo_path, ebill_path, invoice_path, " +
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .order("created_at", { ascending: false });
      setRows((data ?? []) as unknown as Row[]);
    })();
  }, []);

  useEffect(() => {
    if (rows.length === 0) return;
    const savedScroll = sessionStorage.getItem("appsList.scroll");
    const savedRow = sessionStorage.getItem("appsList.lastRowId");
    if (savedScroll) { const y = parseInt(savedScroll, 10); if (!isNaN(y)) window.scrollTo(0, y); }
    if (savedRow) {
      setHighlightId(savedRow);
      const t = window.setTimeout(() => setHighlightId(null), 2100);
      sessionStorage.removeItem("appsList.lastRowId");
      sessionStorage.removeItem("appsList.scroll");
      return () => window.clearTimeout(t);
    }
  }, [rows.length]);

  function navigateToView(row: Row) {
    sessionStorage.setItem("appsList.scroll", String(window.scrollY));
    sessionStorage.setItem("appsList.lastRowId", row.id);
    sessionStorage.setItem("adminList.tab", "insurance");
    router.push(`/admin/insurance/${row.id}/view` as any);
  }
  function editRow(row: Row) {
    sessionStorage.setItem("adminList.tab", "insurance");
    router.push(`/dashboard/insurance/${row.id}/step-1` as any);
  }

  function applicant(r: Row): string { return r.aadhaar_name || "—"; }
  function epc(r: Row): string {
    return r.epc_business?.trade_name || r.epc_business?.legal_name || r.epc_business?.contact_name || "—";
  }
  // Sum insured is auto-tagged from the final invoice amount at Step 2; the
  // fallbacks cover rows saved before that column existed.
  function amount(r: Row): string {
    return fmtRupees(r.sum_insured ?? r.invoice_confirmed_amount ?? r.invoice_amount);
  }

  // Download the uploaded policy document. Signed by path through the SAME
  // admin sign-doc route the View profile's document viewer uses — no new
  // endpoint. Only ever called for rows that have a policy_path.
  async function downloadPolicy(r: Row) {
    if (zipBusy || !r.policy_path) return;
    setZipBusy(r.id);
    try {
      const res = await fetch(`/api/admin/insurance/${r.id}/sign-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ path: r.policy_path }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok || !d.url) {
        alert("Couldn't open the policy: " + (d?.error || `HTTP ${res.status}`));
        return;
      }
      const a = document.createElement("a");
      a.href = d.url;
      a.download = `${r.insurance_display_id || r.id.slice(0, 8)}_policy`;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
    } finally { setZipBusy(null); }
  }

  // EPC options for the filter dropdown — only EPCs present in the list.
  const epcOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      const name = epc(r);
      if (name && name !== "—") seen.add(name);
    }
    return [...seen].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Client-side filter, then sort: rows WITH policy dates first, fewest days
  // left on top (expired is negative, so it floats to the very top); rows with
  // no policy below, newest first. The query is untouched.
  // Category predicate — shared by the card counts AND the table filter.
  function catMatch(r: Row, key: string): boolean {
    switch (key) {
      case "docs_pending":
        return !r.pan_path || !r.aadhaar_front_path || !r.aadhaar_back_path ||
               !r.plant_photo_path || !r.ebill_path || !r.invoice_path;
      case "awaiting_policy": return r.status === "issued" && r.policy_path == null;
      case "policy_issued":   return r.policy_path != null;
      default:                return true;
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const daysOf = (r: Row) =>
      policyValidityParts(r.policy_from_date, r.policy_to_date)?.daysLeft ?? null;

    const out = rows.filter((r) => {
      if (categoryFilter && !catMatch(r, categoryFilter)) return false;
      if (needle &&
          !(applicant(r).toLowerCase().includes(needle) ||
            (r.insurance_display_id ?? "").toLowerCase().includes(needle) ||
            epc(r).toLowerCase().includes(needle))) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (epcFilter && epc(r) !== epcFilter) return false;
      if (expiryFilter) {
        const d = daysOf(r);
        if (expiryFilter === "none")    { if (d !== null) return false; }
        else if (d === null)            { return false; }
        else if (expiryFilter === "expired") { if (d >= 0) return false; }
        else if (expiryFilter === "30")      { if (d < 0 || d > 30) return false; }
        else if (expiryFilter === "90")      { if (d < 0 || d > 90) return false; }
      }
      return true;
    });

    return out.sort((a, b) => {
      const da = daysOf(a), db = daysOf(b);
      const ha = da !== null, hb = db !== null;
      if (ha !== hb) return ha ? -1 : 1;
      if (ha && hb) return (da as number) - (db as number);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, categoryFilter, statusFilter, epcFilter, expiryFilter]);

  // Issued / Rejected / Hold / Draft / Under Review (migration 0047).
  const STATUS_LABEL: Record<string, string> = {
    draft: "Draft", under_review: "Under Review", issued: "Issued", rejected: "Rejected", hold: "Hold",
  };
  const STATUS_PILL: Record<string, string> = {
    draft: "bg-[#eef1f0] text-[#5a8a76]",
    under_review: "bg-[#fef0d6] text-[#854f0b]",
    issued: "bg-[#e6f6ee] text-[#178a5c]",
    rejected: "bg-red-50 text-red-700",
    hold: "bg-[#dceffb] text-[#185fa5]",
  };

  const cards: SummaryCard[] = [
    { key: "",                label: "Total Applications", value: rows.length },
    { key: "docs_pending",    label: "Docs Pending",       value: rows.filter((r) => catMatch(r, "docs_pending")).length },
    { key: "awaiting_policy", label: "Awaiting Policy",    value: rows.filter((r) => catMatch(r, "awaiting_policy")).length },
    { key: "policy_issued",   label: "Policy Issued",      value: rows.filter((r) => catMatch(r, "policy_issued")).length },
  ];
  const panelActive = [statusFilter, epcFilter, expiryFilter].filter(Boolean).length;
  const activeCount = panelActive + (categoryFilter ? 1 : 0);
  const pickCategory = (key: string) => setCategoryFilter(key === categoryFilter ? "" : key);
  function clearAll() {
    setStatusFilter(""); setEpcFilter(""); setExpiryFilter(""); setCategoryFilter("");
  }

  return (
    <>
      <SummaryCards accent={ACCENTS.insurance.color} cards={cards} active={categoryFilter} onPick={pickCategory} />

      <div className="mb-3 flex items-center gap-3">
        <div className="flex-1">
          <Input placeholder="Search by applicant, INS id, or EPC…" value={q} onChange={(e) => setQ(capPhone(e.target.value))} />
        </div>
        <FiltersButton count={activeCount} open={filtersOpen} accent={ACCENTS.insurance.color} onClick={() => setFiltersOpen((o) => !o)} />
        <Button type="button" variant="primary" onClick={() => setAddOpen(true)} className="whitespace-nowrap" style={{ backgroundColor: ACCENTS.insurance.color }}>
          + Add New Insurance Application
        </Button>
      </div>

      <FiltersPanel open={filtersOpen} hasActive={activeCount > 0} onClear={clearAll}>
        <Select
          placeholder="Status filter"
          options={[
            { value: "draft",        label: "Draft" },
            { value: "under_review", label: "Under Review" },
            { value: "issued",       label: "Issued" },
            { value: "rejected",     label: "Rejected" },
            { value: "hold",         label: "Hold" },
          ]}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
        <Select
          placeholder="EPC partner"
          options={epcOptions}
          value={epcFilter}
          onChange={(e) => setEpcFilter(e.target.value)}
        />
        <Select
          placeholder="Policy expiry"
          options={[
            { value: "30",      label: "Expiring in 30 days" },
            { value: "90",      label: "Expiring in 90 days" },
            { value: "expired", label: "Expired" },
            { value: "none",    label: "No policy" },
          ]}
          value={expiryFilter}
          onChange={(e) => setExpiryFilter(e.target.value)}
        />
      </FiltersPanel>
      <Card className="overflow-hidden">
        <table className="w-full text-[14px] table-fixed">
          {/* Percentage widths — fills the page evenly, never scrolls sideways. */}
          <colgroup>
            <col style={{ width: "17%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          {/* Everything centred except Insured name, which stays left. */}
          <thead className="bg-[#f0faf5] border-b border-[#cdeadd] text-[#5a8a76]">
            <tr>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-left">Insured name</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">EPC partner</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Sum insured</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Insurance partner</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Status</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Policy Validity</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Created on</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-[#5a8a76]">No insurance applications yet.</td></tr>
            ) : filtered.map((r) => {
              const hl = highlightId === r.id;
              return (
              <tr key={r.id}
                  style={{ transition: "background-color 2s ease-out", backgroundColor: hl ? "#dceffb" : undefined }}
                  className="border-b border-[#eaf3ee] hover:bg-[#f7fcfa] align-top">
                {/* Insured name with the INS id beneath — same shape as the
                    EPC name/ID cell on the EPCs tab. */}
                <td className="px-3 py-3 cursor-pointer" onClick={() => navigateToView(r)}>
                  <p className="text-[15px] font-semibold text-[#0f3d2e] truncate">{applicant(r)}</p>
                  {r.insurance_display_id && <p className="text-[12px] font-mono text-[#185fa5] mt-0.5">{r.insurance_display_id}</p>}
                </td>
                {/* EPC partner — name + EPC ID text only. */}
                <td className="px-3 py-3 text-center">
                  <p className="text-[13px] text-[#0f3d2e] truncate">{epc(r)}</p>
                  {r.epc_business?.epc_display_id && <p className="text-[11px] font-mono text-[#5a8a76] mt-0.5">{r.epc_business.epc_display_id}</p>}
                </td>
                <td className="px-3 py-3 text-center text-[13px] font-semibold text-[#0f3d2e]">{amount(r)}</td>
                <td className="px-3 py-3 text-center text-[13px] text-[#0f3d2e]">{insurerLabelShort(r.insurance_partner)}</td>
                <td className="px-3 py-3 text-center">
                  <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${STATUS_PILL[r.status] ?? STATUS_PILL.draft}`}>
                    {STATUS_LABEL[r.status] ?? r.status.replace(/_/g, " ")}
                  </span>
                </td>
                {/* Policy Validity — end date, with the colour-coded days-left
                    badge on the line below. */}
                <td className="px-3 py-3 text-center">
                  {(() => {
                    const v = policyValidityParts(r.policy_from_date, r.policy_to_date);
                    if (!v) return <span className="text-[13px] text-[#5a8a76]">—</span>;
                    const badge =
                      v.tone === "red"   ? "bg-red-50 text-red-700 border-red-200" :
                      v.tone === "amber" ? "bg-[#fef0d6] text-[#854f0b] border-[#f3d9a4]" :
                                           "bg-[#e6f6ee] text-[#178a5c] border-[#cdeadd]";
                    const daysText =
                      v.daysLeft == null ? null :
                      v.daysLeft < 0 ? `Expired ${Math.abs(v.daysLeft)}d ago` :
                      `${v.daysLeft} ${v.daysLeft === 1 ? "day" : "days"} left`;
                    return (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[13px] font-semibold text-[#0f3d2e]">{v.toLabel ?? "—"}</span>
                        {daysText && (
                          <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold ${badge}`}>{daysText}</span>
                        )}
                      </div>
                    );
                  })()}
                </td>
                {/* Created on — date bold dark, time smaller grey beneath. */}
                <td className="px-3 py-3 text-center">
                  <p className="text-[13px] font-semibold text-[#0f3d2e]">{fmtAddedDate(r.created_at)}</p>
                  <p className="text-[11px] text-[#5a8a76] mt-0.5">{fmtAddedTime(r.created_at)}</p>
                </td>
                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-col gap-1.5">
                    <button type="button" onClick={() => navigateToView(r)}
                      className="text-[12px] font-semibold px-2.5 py-1.5 rounded-input border border-[#185fa5]/30 bg-white text-[#185fa5] hover:bg-[#dceffb] inline-flex items-center justify-center gap-1.5">
                      {IconEye} View
                    </button>
                    <button type="button" onClick={() => editRow(r)}
                      className="text-[12px] font-semibold px-2.5 py-1.5 rounded-input border border-[#178a5c]/30 bg-white text-[#178a5c] hover:bg-[#f0faf5] inline-flex items-center justify-center gap-1.5">
                      Edit
                    </button>
                    {/* Download Policy — only when a policy document exists. */}
                    {r.policy_path && (
                      <button type="button" disabled={zipBusy === r.id} onClick={() => void downloadPolicy(r)}
                        className={["text-[12px] font-semibold px-2.5 py-1.5 rounded-input border transition-colors inline-flex items-center justify-center gap-1.5",
                          zipBusy === r.id ? "border-line bg-bg-soft text-text-muted cursor-not-allowed" : "border-[#854f0b]/30 bg-white text-[#854f0b] hover:bg-[#fef0d6]"].join(" ")}>
                        {IconDownload} {zipBusy === r.id ? "Opening…" : "Download Policy"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <AddNewInsuranceModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

// ── Leads (Non-EPC) — customer_leads captured from the public /apply form ──
type Lead = {
  id: string; created_at: string; lead_type: "loan" | "insurance";
  name: string | null; mobile: string; city: string | null; pincode: string | null;
  pan: string | null; aadhaar: string | null;
  project_cost: number | null; loan_amount: number | null;
  plant_value: number | null; gstin: string | null; status: string;
};
const LEAD_STATUS_PILL: Record<string, string> = {
  new:       "bg-[#dceffb] text-[#185fa5]",
  contacted: "bg-[#fef0d6] text-[#854f0b]",
  converted: "bg-[#e6f6ee] text-[#178a5c]",
  closed:    "bg-[#eef1f0] text-[#5a8a76]",
};
function LeadsTab() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewLead, setViewLead] = useState<Lead | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase()
        .from("customer_leads")
        .select("id, created_at, lead_type, name, mobile, city, pincode, pan, aadhaar, project_cost, loan_amount, plant_value, gstin, status")
        .order("created_at", { ascending: false });
      setRows((data ?? []) as unknown as Lead[]);
    })();
  }, []);

  async function setStatus(r: Lead, status: string) {
    setBusy(r.id);
    const { error } = await supabase().from("customer_leads").update({ status }).eq("id", r.id);
    if (error) alert("Couldn't update status: " + error.message);
    else setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status } : x)));
    setBusy(null);
  }
  async function deleteLead(r: Lead) {
    if (!window.confirm(`Delete this lead${r.name ? ` — ${r.name}` : ""} (+91 ${r.mobile})?\n\nThis permanently removes it and cannot be undone.`)) return;
    setBusy(r.id);
    const { error } = await supabase().from("customer_leads").delete().eq("id", r.id);
    if (error) alert("Couldn't delete: " + error.message);
    else { setRows((rs) => rs.filter((x) => x.id !== r.id)); setViewLead(null); }
    setBusy(null);
  }
  const maskAadhaar = (a: string | null) => (a ? "XXXX XXXX " + a.slice(-4) : "—");

  // Category predicate — the summary cards are the lead statuses. "" = all.
  const catMatch = (r: Lead, key: string) => (key ? r.status === key : true);
  const filtered = rows.filter((r) => {
    if (categoryFilter && !catMatch(r, categoryFilter)) return false;
    const needle = q.trim().toLowerCase();
    if (needle && !((r.name ?? "").toLowerCase().includes(needle) || r.mobile.includes(needle) || (r.city ?? "").toLowerCase().includes(needle))) return false;
    if (typeFilter && r.lead_type !== typeFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  });

  const cards: SummaryCard[] = [
    { key: "",          label: "Total Leads", value: rows.length },
    { key: "new",       label: "New",         value: rows.filter((r) => r.status === "new").length },
    { key: "contacted", label: "Contacted",   value: rows.filter((r) => r.status === "contacted").length },
    { key: "converted", label: "Converted",   value: rows.filter((r) => r.status === "converted").length },
    { key: "closed",    label: "Closed",      value: rows.filter((r) => r.status === "closed").length },
  ];
  const panelActive = [typeFilter, statusFilter].filter(Boolean).length;
  const activeCount = panelActive + (categoryFilter ? 1 : 0);
  const pickCategory = (key: string) => setCategoryFilter(key === categoryFilter ? "" : key);
  function clearAll() {
    setTypeFilter(""); setStatusFilter(""); setCategoryFilter("");
  }

  return (
    <>
      <SummaryCards accent={ACCENTS.leads.color} cards={cards} active={categoryFilter} onPick={pickCategory} />

      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1">
          <Input placeholder="Search by name, mobile, or city…" value={q} onChange={(e) => setQ(capPhone(e.target.value))} />
        </div>
        <FiltersButton count={activeCount} open={filtersOpen} accent={ACCENTS.leads.color} onClick={() => setFiltersOpen((o) => !o)} />
      </div>

      <FiltersPanel open={filtersOpen} hasActive={activeCount > 0} onClear={clearAll}>
        <Select placeholder="Type" options={[{ value: "loan", label: "Loan" }, { value: "insurance", label: "Insurance" }]} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} />
        <Select placeholder="Status" options={[{ value: "new", label: "New" }, { value: "contacted", label: "Contacted" }, { value: "converted", label: "Converted" }, { value: "closed", label: "Closed" }]} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
      </FiltersPanel>
      <Card className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="bg-[#f0faf5] border-b border-[#cdeadd] text-left text-[#5a8a76]">
            <tr>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">Customer</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Type</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">Amounts</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">KYC</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Received</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-[#5a8a76]">No leads yet.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} onClick={() => setViewLead(r)} className="border-b border-[#eaf3ee] hover:bg-[#f7fcfa] align-top cursor-pointer">
                <td className="px-3 py-3">
                  <p className="text-[15px] font-semibold text-[#0f3d2e]">{r.name || "—"}</p>
                  <p className="text-[12px] text-[#5a8a76] mt-0.5">+91 {r.mobile}</p>
                  {(r.city || r.pincode) && <p className="text-[12px] text-[#5a8a76]">{[r.city, r.pincode].filter(Boolean).join(" · ")}</p>}
                </td>
                <td className="px-3 py-3 text-center">
                  <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-[#dceffb] text-[#185fa5]">{r.lead_type}</span>
                </td>
                <td className="px-3 py-3 text-[13px] text-[#0f3d2e]">
                  {r.lead_type === "loan" ? (
                    <><div>Project: <b>{fmtRupees(r.project_cost)}</b></div><div>Loan: <b>{fmtRupees(r.loan_amount)}</b></div></>
                  ) : (
                    <><div>Plant: <b>{fmtRupees(r.plant_value)}</b></div>{r.gstin && <div className="text-[#5a8a76]">GST {r.gstin}</div>}</>
                  )}
                </td>
                <td className="px-3 py-3 text-[13px] text-[#0f3d2e]">
                  <div>PAN {r.pan || "—"}</div>
                  <div className="text-[#5a8a76]">{maskAadhaar(r.aadhaar)}</div>
                </td>
                <td className="px-3 py-3 text-center">
                  <p className="text-[13px] font-semibold text-[#0f3d2e]">{fmtAddedDate(r.created_at)}</p>
                  <p className="text-[11px] text-[#5a8a76] mt-0.5">{fmtAddedTime(r.created_at)}</p>
                </td>
                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <select
                    disabled={busy === r.id}
                    value={r.status}
                    onChange={(e) => void setStatus(r, e.target.value)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide border-none cursor-pointer outline-none ${LEAD_STATUS_PILL[r.status] ?? LEAD_STATUS_PILL.new}`}
                  >
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="converted">Converted</option>
                    <option value="closed">Closed</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {viewLead && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setViewLead(null)}>
          <div className="w-full max-w-lg bg-white rounded-card-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-display font-semibold text-[19px] text-[#0f3d2e]">{viewLead.name || "(no name given)"}</h3>
                <p className="text-[13px] text-[#5a8a76] mt-0.5">Non-EPC lead · <span className="uppercase font-semibold text-[#185fa5]">{viewLead.lead_type}</span></p>
              </div>
              <button type="button" onClick={() => setViewLead(null)} className="text-[22px] text-[#5a8a76] hover:text-[#0f3d2e] leading-none" aria-label="Close">×</button>
            </div>
            <div className="border border-[#e6f1ec] rounded-[12px] px-4">
              <LeadRow k="Mobile" v={"+91 " + viewLead.mobile} />
              <LeadRow k="City" v={viewLead.city} />
              <LeadRow k="Pincode" v={viewLead.pincode} />
              <LeadRow k="PAN" v={viewLead.pan} />
              <LeadRow k="Aadhaar" v={viewLead.aadhaar} />
              {viewLead.lead_type === "loan" ? (
                <>
                  <LeadRow k="Project cost" v={fmtRupees(viewLead.project_cost)} />
                  <LeadRow k="Loan amount wanted" v={fmtRupees(viewLead.loan_amount)} />
                </>
              ) : (
                <>
                  <LeadRow k="Approx. plant value" v={fmtRupees(viewLead.plant_value)} />
                  <LeadRow k="GSTIN" v={viewLead.gstin} />
                </>
              )}
              <LeadRow k="Status" v={viewLead.status[0].toUpperCase() + viewLead.status.slice(1)} />
              <LeadRow k="Received" v={fmtAddedDate(viewLead.created_at) + " · " + fmtAddedTime(viewLead.created_at)} />
            </div>
            <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[12px] text-[#5a8a76] max-w-xs">Basic lead details — not under any EPC. Use these to reach out and build the full profile.</p>
              <button
                type="button"
                disabled={busy === viewLead.id}
                onClick={() => void deleteLead(viewLead)}
                className="text-[13px] font-semibold px-3.5 py-2 rounded-[8px] border border-red-300 text-red-700 hover:bg-red-50 hover:border-red-500 disabled:opacity-60 shrink-0 inline-flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                Delete lead
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LeadRow({ k, v }: { k: string; v: unknown }) {
  const display = v === null || v === undefined || v === "" ? "—" : String(v);
  return (
    <div className="flex justify-between items-center gap-4 py-2.5 border-b border-[#eef1f0] last:border-0 text-[14px]">
      <span className="text-[#5a8a76] shrink-0">{k}</span>
      <span className="font-medium text-[#0f3d2e] text-right break-all">{display}</span>
    </div>
  );
}

