"use client";

// Admin console — EPCs tab: every EPC profile with its single derived stage,
// per-lender docs/approved/rejected state, send-to-lender email and CSV report.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import AddNewEpcModal from "@/components/AddNewEpcModal";
import { ACCENTS } from "@/components/AdminSidebar";
import { supabase } from "@/lib/supabase";
import { getCached, setCached, invalidate } from "@/lib/list-cache";
import { useAdminNames } from "@/lib/use-admin-names";
import EmailComposerModal from "@/components/EmailComposerModal";
import RowLink from "@/components/RowLink";
import { toast } from "sonner";
import { nameCase } from "@/lib/names";
import { fmtDateTime } from "@/lib/dates";
// LenderCell lives in @/components/LenderCell (shared with the EPC profile
// action bar so both render the identical dropdown). Lender keys are DYNAMIC
// (the `lenders` registry — lib/lenders), so Lender is a plain string.
import LenderCell, { type Lender, type LenderMap, type LenderState } from "@/components/LenderCell";
import AdminPendingPill from "@/components/AdminPendingPill";
import { epcLocked, saveEpcLenderState } from "@/lib/review";
import { addLender as addRegistryLender, useLenders } from "@/lib/lenders";
import { inPeriod, usePeriodRows, type TabPeriodProps } from "./console-period";
import type { EpcKpis } from "./DashboardKpis";
import {
  CreatedOnCell, DateRange, EmptyRow, FiltersPanel, ListToolbar, PILL, ReportButton, SummaryCards,
  downloadCsv, highlightRowStyle, useRestoredFilters, useReturnHighlight,
  type SummaryCard,
} from "./kit";

// Distinct colours for the derived EPC single-stage badge (admin display only).
const EPC_STAGE_META: Record<string, { label: string; cls: string }> = {
  unseen:          { label: "Application Unseen",  cls: "bg-[#eef1f0] text-[#5a8a76]" },
  under_review:    { label: "Under Review",        cls: "bg-[#fef0d6] text-[#854f0b]" },
  updated:         { label: "Updated",             cls: "bg-[#fff2cc] text-[#8a6500]" },
  approved:        { label: "Approved by Manish",  cls: "bg-[#e6f6ee] text-[#178a5c]" },
  hold:            { label: "Hold",                cls: "bg-[#e5edf5] text-[#3b5a76]" },
  rejected:        { label: "Rejected by CC",      cls: "bg-red-50 text-red-700" },
  docs_sent:       { label: "Docs Sent to Lender", cls: "bg-[#dceffb] text-[#185fa5]" },
  lender_approved: { label: "Approved by Lender",  cls: "bg-[#d6efe3] text-[#0f7a52]" },
  rejected_by_lender: { label: "Rejected by Lender", cls: "bg-[#ffe4e6] text-[#9f1239]" },
};
// The Status column sorts by the shown stage, in this order (= the summary cards).
const EPC_STAGE_ORDER = Object.keys(EPC_STAGE_META);

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

export default function EpcsTab({ period, pFrom, pTo, onKpis }: TabPeriodProps & { onKpis?: (k: EpcKpis) => void }) {
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
    created_by_user_id: string | null;
    admin_review_status: string | null;
    // Its lender ticks (epc_lender_status, embedded in the list query) — read
    // once into lenderState at load.
    lender_status?: { lender: Lender; docs_given: boolean; approved: boolean; rejected: boolean }[] | null;
  };
  const adminNames = useAdminNames();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
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
  const [loaded, setLoaded] = useState(false); // first read done (cache or query)
  // The lender registry (lib/lenders) — every lender the portal works with.
  const lenderList = useLenders();
  const [addOpen, setAddOpen] = useState(false);
  const [emailRow, setEmailRow] = useState<Row | null>(null); // EPC → send-to-lender email
  // Row highlighted after returning from View (scroll restored too).
  // sessionStorage-backed so it survives navigation but not full reload.
  const highlightId = useReturnHighlight("adminList.scroll", "adminList.lastRowId", rows.length);

  // Restore the filter/search/sort state saved by navigateToView, so
  // returning from a View lands on the same filtered list (not a reset
  // one). Mount-only + consumed immediately so a fresh visit is clean.
  useRestoredFilters("epcsList.filters", (f) => {
    if (typeof f.q === "string") setQ(f.q);
    if (typeof f.sourceFilter === "string") setSourceFilter(f.sourceFilter);
    if (typeof f.lenderFilter === "string") setLenderFilter(f.lenderFilter);
    if (typeof f.lenderStateFilter === "string") setLenderStateFilter(f.lenderStateFilter);
    if (typeof f.dateFrom === "string") setDateFrom(f.dateFrom);
    if (typeof f.dateTo === "string") setDateTo(f.dateTo);
    if (typeof f.categoryFilter === "string") setCategoryFilter(f.categoryFilter);
    if (f.sortKey) setSortKey(f.sortKey as SortKey);
    if (f.sortDir) setSortDir(f.sortDir as SortDir);
    if (f.sourceFilter || f.lenderFilter || f.lenderStateFilter || f.dateFrom || f.dateTo || f.categoryFilter) {
      setFiltersOpen(true);
    }
  });

  // Save scroll + row id + the active filter state, then navigate to View.
  function navigateToView(row: Row) {
    sessionStorage.setItem("adminList.scroll", String(window.scrollY));
    sessionStorage.setItem("adminList.lastRowId", row.id);
    sessionStorage.setItem("epcsList.filters", JSON.stringify({
      q, sourceFilter, lenderFilter, lenderStateFilter,
      dateFrom, dateTo, categoryFilter, sortKey, sortDir,
    }));
    router.push(`/admin/epc/${row.id}/view` as any);
  }

  async function load(force = false) {
    // Short per-tab cache (45s). `force` skips it after an in-tab mutation.
    const CK = "dash.epcs";
    if (!force) {
      const cached = getCached<{ rows: Row[]; lenderState: Record<string, LenderMap> }>(CK, 45000);
      if (cached) { setRows(cached.rows); setLenderState(cached.lenderState); setLoaded(true); return; }
    }
    let query = supabase().from("epc_business")
      .select("id, epc_display_id, legal_name, trade_name, contact_name, contact_mobile, contact_email, business_type, status, source, created_at, submitted_at, epc_self_edited, reviewed_at, created_by_user_id, admin_review_status, " +
        // Each EPC's lender ticks in the SAME request — no id list in the URL.
        "lender_status:epc_lender_status(lender, docs_given, approved, rejected)")
      .neq("business_type", "admin");
    const { data } = await query;
    const rs = (data ?? []) as unknown as Row[];
    setRows(rs);
    setLoaded(true);

    const map: Record<string, LenderMap> = {};
    for (const r of rs) {
      for (const lr of r.lender_status ?? []) {
        if (!map[r.id]) map[r.id] = {};
        map[r.id][lr.lender] = { docs_given: lr.docs_given, approved: lr.approved, rejected: !!lr.rejected };
      }
    }
    setLenderState(map);
    setCached(CK, { rows: rs, lenderState: map });
  }

  // Load once; stage filtering (cards + panel dropdown) is entirely client-side.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  // Add a lender to the registry (GLOBAL — every list in the portal shows it).
  async function addLender(name: string) {
    if (!name.trim()) return;
    const r = await addRegistryLender(name);
    if (r.error) toast.error(r.error);
    else if (r.existed) toast.error("That lender already exists.");
  }

  // Single mutually-exclusive stage per EPC — highest rule wins (top→bottom).
  // ADMIN-DISPLAY ONLY; EPC-facing views are unaffected (EPCs still read
  // lenderOutcome → "Under Review"). Derived purely from already-loaded
  // columns: lender ticks + internal status (draft = not yet submitted = docs
  // pending; under_review+ = onboarding complete). It is also the row's
  // Status-column badge (A2 — distinguishes lender vs internal outcomes) and
  // the Report's Status, so the badge, the cards and the Stage filter agree.
  function epcStage(r: Row): string {
    const ls = Object.values(lenderState[r.id] ?? {});
    if (ls.some((v) => v?.approved))   return "lender_approved";
    if (ls.some((v) => v?.rejected))   return "rejected_by_lender"; // its own stage/card
    if (ls.some((v) => v?.docs_given)) return "docs_sent";
    if (r.status === "approved")       return "approved";
    if (r.status === "on_hold")        return "hold";
    if (r.status === "rejected")       return "rejected";
    if (r.status === "draft")          return "unseen"; // Application Unseen = Draft
    // No downstream action yet: a self-edit is its OWN single status "Updated"
    // (never a second badge) until the next action above supersedes it.
    if (r.epc_self_edited === true)    return "updated";
    return "under_review"; // submitted / under_review
  }
  // Card/badge/filter predicate. Stage keys are mutually exclusive (sum = Total).
  function catMatch(r: Row, key: string): boolean {
    if (key === "") return true;
    return epcStage(r) === key;
  }

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (!inPeriod(r.created_at, period, pFrom, pTo)) return false; // period drives the list too, not just the cards
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
        av = EPC_STAGE_ORDER.indexOf(epcStage(a));
        bv = EPC_STAGE_ORDER.indexOf(epcStage(b));
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, categoryFilter, sourceFilter, lenderFilter, lenderStateFilter, dateFrom, dateTo, lenderState, sortKey, sortDir, period, pFrom, pTo]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  // Set ONE exclusive lender state (none / docs / approved / rejected),
  // clearing the other two flags — Docs Sent, Approved and Rejected can never
  // combine (B1). Approved/Rejected are gated behind Docs Sent in the UI, and
  // this reuses the same epc_lender_status upsert as before.
  async function setLenderExclusive(epcId: string, lender: Lender, target: "none" | "docs" | "approved" | "rejected") {
    const flags: LenderState = {
      docs_given: target === "docs",
      approved:   target === "approved",
      rejected:   target === "rejected",
    };
    const dbPatch: Record<string, unknown> = { ...flags, rejected_at: target === "rejected" ? new Date().toISOString() : null };

    const prevState = lenderState;
    setLenderState((s) => {
      const next = { ...s };
      const cur = (next[epcId] ?? {}) as LenderMap;
      next[epcId] = { ...cur, [lender]: { ...flags } };
      return next;
    });
    try {
      await saveEpcLenderState(epcId, lender, dbPatch);
      invalidate("dash.epcs"); // local state already updated; refresh cache on next mount
    } catch (e) {
      setLenderState(prevState);
      alert("Couldn't save lender state: " + (e as Error).message);
    }
  }

  // Mutually-exclusive stage cards (sum = Total).
  const periodRows = usePeriodRows(rows, period, pFrom, pTo);
  const cards: SummaryCard[] = [
    { key: "",                label: "Total EPCs",          value: periodRows.length },
    { key: "unseen",          label: "Application Unseen",  value: periodRows.filter((r) => catMatch(r, "unseen")).length },
    { key: "under_review",    label: "Under Review",        value: periodRows.filter((r) => catMatch(r, "under_review")).length },
    { key: "updated",         label: "Updated",             value: periodRows.filter((r) => catMatch(r, "updated")).length },
    { key: "approved",        label: "Approved by Manish",  value: periodRows.filter((r) => catMatch(r, "approved")).length },
    { key: "hold",            label: "Hold",                value: periodRows.filter((r) => catMatch(r, "hold")).length },
    { key: "rejected",        label: "Rejected by CC",      value: periodRows.filter((r) => catMatch(r, "rejected")).length },
    { key: "docs_sent",       label: "Docs Sent to Lender", value: periodRows.filter((r) => catMatch(r, "docs_sent")).length },
    { key: "lender_approved", label: "Approved by Lender",  value: periodRows.filter((r) => catMatch(r, "lender_approved")).length },
    { key: "rejected_by_lender", label: "Rejected by Lender", value: periodRows.filter((r) => catMatch(r, "rejected_by_lender")).length },
  ];
  // Feed the top KPI strip from these same period-scoped counts (no extra query).
  const countOf = (key: string) => cards.find((c) => c.key === key)?.value ?? 0;
  const kpiSig = cards.map((c) => c.value).join(",");
  useEffect(() => {
    onKpis?.({
      total: countOf(""),
      // KPI "Application unseen" = every profile CC hasn't acted on yet:
      // draft + under review + self-updated.
      unseen: countOf("unseen") + countOf("under_review") + countOf("updated"),
      docsSent: countOf("docs_sent"),
      lenderApproved: countOf("lender_approved"),
      approved: countOf("approved"),
      rejected: countOf("rejected"),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiSig]);
  const panelActive = [sourceFilter, lenderFilter, lenderStateFilter, dateFrom, dateTo].filter(Boolean).length;
  const activeCount = panelActive + (categoryFilter ? 1 : 0);
  const pickCategory = (key: string) => setCategoryFilter(key === categoryFilter ? "" : key);
  function clearAll() {
    setSourceFilter(""); setLenderFilter(""); setLenderStateFilter("");
    setDateFrom(""); setDateTo(""); setCategoryFilter("");
  }

  // Created by — the admin user who added it (from created_by_user_id);
  // self-onboarded EPCs have none → "EPC"; legacy admin-added → "Admin".
  const createdBy = (r: Row) =>
    r.created_by_user_id ? (adminNames.get(r.created_by_user_id) ?? "Admin") : ((r.source || "website").toLowerCase() === "manual" ? "Admin" : "EPC");

  // "Report" — client-side CSV of the CURRENTLY-FILTERED EPC list.
  function exportEpcReport() {
    const header = ["EPC ID", "Trade name", "Legal name", "Contact", "Mobile", "Email", "Status", "Created by", "Created on"];
    downloadCsv("epcs", header, filtered.map((r) => [
      r.epc_display_id || r.id,
      nameCase(r.trade_name),
      nameCase(r.legal_name),
      nameCase(r.contact_name),
      r.contact_mobile || "",
      r.contact_email || "",
      EPC_STAGE_META[epcStage(r)]?.label ?? "",
      createdBy(r),
      fmtDateTime(r.created_at),
    ]));
  }

  return (
    <>
      <SummaryCards accent={ACCENTS.epcs.color} cards={cards} active={categoryFilter} onPick={pickCategory} />

      <ListToolbar placeholder="Search by name, ID, POC, mobile, or email…" q={q} onQ={setQ}
        accent={ACCENTS.epcs.color} filterCount={activeCount} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen((o) => !o)}>
        <ReportButton onClick={exportEpcReport} />
        <Button type="button" variant="primary" onClick={() => setAddOpen(true)} className="whitespace-nowrap" style={{ backgroundColor: ACCENTS.epcs.color }}>
          + Add New EPC
        </Button>
      </ListToolbar>

      <FiltersPanel open={filtersOpen} hasActive={activeCount > 0} onClear={clearAll}>
        <Select
          placeholder="Stage"
          options={Object.entries(EPC_STAGE_META).map(([value, m]) => ({ value, label: m.label }))}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
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
          options={lenderList.map((l) => ({ value: l.key, label: l.label }))}
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
        <DateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
      </FiltersPanel>

      <Card className="overflow-hidden cc-table-card">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-[14px] table-fixed cc-table">
          {/* Percentage widths — the table fills the page evenly and scrolls sideways
              only on small screens (matches the loan table). Internal
              status keeps room for the status + UPDATED pills side by side. */}
          <colgroup>
            <col style={{ width: "26%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "9%"  }} />
            <col style={{ width: "14%" }} />
          </colgroup>
          {/* Everything centred except EPC details, which stays left. */}
          <thead>
            <tr>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-left">EPC details</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">
                <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1 uppercase tracking-wide">
                  Status
                  <SortMark active={sortKey === "status"} dir={sortDir} />
                </button>
              </th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Lender</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">
                <button type="button" onClick={() => toggleSort("created_at")} className="inline-flex items-center gap-1 uppercase tracking-wide">
                  Created on
                  <SortMark active={sortKey === "created_at"} dir={sortDir} />
                </button>
              </th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Created by</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <EmptyRow cols={6} loaded={loaded} hasRows={rows.length > 0} noun="EPCs" />
            ) : filtered.map((r) => {
              const isHighlighted = highlightId === r.id;
              return (
              <tr
                key={r.id}
                data-highlighted={isHighlighted ? "yes" : undefined}
                style={highlightRowStyle(isHighlighted)}
                onClick={() => navigateToView(r)}
                className="border-b border-[#eaf3ee] cursor-pointer hover:bg-[#f7fcfa] align-top"
              >
                <td className="px-3 py-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[var(--acc-tint)] text-[var(--acc)] grid place-items-center shrink-0">
                      {IconBuilding}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#0f3d2e] truncate">
                        {r.trade_name || r.legal_name ? (
                          <RowLink href={`/admin/epc/${r.id}/view`} onOpen={() => navigateToView(r)}>{nameCase(r.trade_name || r.legal_name)}</RowLink>
                        ) : <span className="text-[#5a8a76] font-normal">—</span>}
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
                  {(() => {
                    const m = EPC_STAGE_META[epcStage(r)];
                    return <span className={`${PILL} ${m.cls}`}>{m.label}</span>;
                  })()}
                </td>
                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                  {epcLocked(r) ? <AdminPendingPill /> : (
                    <LenderCell
                      state={lenderState[r.id] ?? {}}
                      lenders={lenderList}
                      onSet={(lender, target) => setLenderExclusive(r.id, lender, target)}
                      onAddLender={addLender}
                    />
                  )}
                </td>
                <CreatedOnCell at={r.created_at} />
                <td className="px-3 py-3 text-center text-[13px] text-[#5a8a76]">{createdBy(r)}</td>
                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-col items-center gap-1">
                    <button type="button" disabled={epcLocked(r)} onClick={(e) => { e.stopPropagation(); setEmailRow(r); }}
                      className="text-[12px] font-semibold px-2.5 py-1.5 rounded-input inline-flex items-center justify-center gap-1.5 bg-[#178a5c] text-white hover:bg-[#12734c] transition-colors disabled:opacity-40 disabled:pointer-events-none">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
                      Email
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>

      <AddNewEpcModal open={addOpen} onClose={() => setAddOpen(false)} />
      <EmailComposerModal
        open={!!emailRow}
        onClose={() => setEmailRow(null)}
        endpoint={emailRow ? `/api/admin/epc/${emailRow.id}/send-to-lender` : ""}
        title="Send EPC to lender"
      />
    </>
  );
}

function SortMark({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="opacity-30">{IconArrowDown}</span>;
  return dir === "asc" ? IconArrowUp : IconArrowDown;
}
