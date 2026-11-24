"use client";

// Admin console — Solar Insurance tab: insurance_applications with status,
// policy validity, Edit / Message to EPC / Download Policy, and the CSV report.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import AddNewInsuranceModal from "@/components/AddNewInsuranceModal";
import { ACCENTS } from "@/components/AdminSidebar";
import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/auth";
import { INSURANCE_STATUS_LABEL } from "@/lib/insurance-validity";
import { getCached, setCached } from "@/lib/list-cache";
import { useAdminNames } from "@/lib/use-admin-names";
import { useEpcUpdates } from "@/lib/use-epc-updates";
import RowLink from "@/components/RowLink";
import { fmtRupees } from "@/lib/money";
import { fmtDateTime } from "@/lib/dates";
import { inPeriod, usePeriodRows, type TabPeriodProps } from "./console-period";
import {
  CreatedOnCell, DateRange, EmptyRow, FiltersPanel, ListToolbar, PILL, ReportButton, SummaryCards, UnseenBadge,
  createdRange, downloadCsv, highlightRowStyle, nameOptions, useRestoredFilters, useReturnHighlight,
  type EpcBusinessRef, type SummaryCard,
} from "./kit";
import {
  DownloadPolicyButton, EXPIRY_OPTIONS, IconPolicyDoc, PolicyValidityCell, byPolicyDaysLeft, expiryMatch, policyDateCells, policyDaysLeft,
} from "./policy";

// DISPLAY-ONLY short label for the insurer in the table. The stored
// insurance_partner value is untouched and nothing keyed on it changes;
// anything that isn't SBI renders exactly as stored.
function insurerLabelShort(v: string | null | undefined): string {
  if (!v) return "—";
  return /^sbi\b/i.test(v.trim()) ? "SBI-GI" : v;
}

const STATUS_PILL: Record<string, string> = {
  draft: "bg-[#eef1f0] text-[#5a8a76]",
  under_review: "bg-[#fef0d6] text-[#854f0b]",
  issued: "bg-[#e6f6ee] text-[#178a5c]",
  rejected: "bg-red-50 text-red-700",
  hold: "bg-[#e5edf5] text-[#3b5a76]",
};

// Same chrome as the EPC / Loan tables (green header, #eaf3ee rows). Back from
// a row's View restores scroll, highlight and filters with its own insList.*
// keys, and the "insurance" tab is restored.
export default function InsuranceTab({ period, pFrom, pTo }: TabPeriodProps) {
  const router = useRouter();
  const adminNames = useAdminNames();
  const { insCounts } = useEpcUpdates();   // per-admin unseen EPC-reply counts
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
    created_by_user_id: string | null;
    // "Message to EPC" attention (0082) — for the "EPC updates" notice.
    attention_status: string | null;
    attention_resolved_at: string | null;
    epc_last_activity_at: string | null;
    msg_admin_seen_at: string | null;
    epc_business: EpcBusinessRef;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false); // first read done (cache or query)
  const [q, setQ] = useState("");
  const [policyBusy, setPolicyBusy] = useState<string | null>(null);
  // Row highlighted after returning from View (scroll restored too).
  const highlightId = useReturnHighlight("insList.scroll", "insList.lastRowId", rows.length);
  const [addOpen, setAddOpen] = useState(false);
  // Client-side filters over the already-loaded list (the query is untouched).
  const [statusFilter, setStatusFilter] = useState("");
  const [epcFilter, setEpcFilter]       = useState("");
  const [expiryFilter, setExpiryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const CK = "dash.insurance";
      const cached = getCached<Row[]>(CK, 45000);
      if (cached) { setRows(cached); setLoaded(true); return; }
      const { data } = await supabase()
        .from("insurance_applications")
        .select(
          "id, insurance_display_id, aadhaar_name, pan_number, sum_insured, invoice_confirmed_amount, " +
          "invoice_amount, insurance_partner, policy_from_date, policy_to_date, policy_path, status, created_at, created_by_user_id, " +
          "pan_path, aadhaar_front_path, aadhaar_back_path, plant_photo_path, ebill_path, invoice_path, " +
          "attention_status, attention_resolved_at, epc_last_activity_at, msg_admin_seen_at, " +
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .order("created_at", { ascending: false });
      const rows = (data ?? []) as unknown as Row[];
      setRows(rows);
      setLoaded(true);
      setCached("dash.insurance", rows);
    })();
  }, []);

  // Restore the filter/search state saved by navigateToView, so returning
  // from a View lands on the same filtered list. Mount-only + consumed
  // immediately so a fresh visit is clean. (Insurance-specific keys so scroll
  // / highlight / filters never collide with the Loan tab.)
  useRestoredFilters("insList.filters", (f) => {
    if (typeof f.q === "string") setQ(f.q);
    if (typeof f.statusFilter === "string") setStatusFilter(f.statusFilter);
    if (typeof f.epcFilter === "string") setEpcFilter(f.epcFilter);
    if (typeof f.expiryFilter === "string") setExpiryFilter(f.expiryFilter);
    if (typeof f.dateFrom === "string") setDateFrom(f.dateFrom);
    if (typeof f.dateTo === "string") setDateTo(f.dateTo);
    if (typeof f.categoryFilter === "string") setCategoryFilter(f.categoryFilter);
    if (f.statusFilter || f.epcFilter || f.expiryFilter || f.dateFrom || f.dateTo || f.categoryFilter) {
      setFiltersOpen(true);
    }
  });

  function navigateToView(row: Row) {
    sessionStorage.setItem("insList.scroll", String(window.scrollY));
    sessionStorage.setItem("insList.lastRowId", row.id);
    sessionStorage.setItem("adminList.tab", "insurance");
    sessionStorage.setItem("insList.filters", JSON.stringify({
      q, statusFilter, epcFilter, expiryFilter,
      dateFrom, dateTo, categoryFilter,
    }));
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
    if (policyBusy || !r.policy_path) return;
    setPolicyBusy(r.id);
    try {
      const res = await fetch(`/api/admin/insurance/${r.id}/sign-doc`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
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
    } finally { setPolicyBusy(null); }
  }

  // EPC options for the filter dropdown — only EPCs present in the list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const epcOptions = useMemo(() => nameOptions(rows, epc), [rows]);

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
    const inRange = createdRange(dateFrom, dateTo);

    const out = rows.filter((r) => {
      if (!inPeriod(r.created_at, period, pFrom, pTo)) return false; // period drives the list too
      if (categoryFilter && !catMatch(r, categoryFilter)) return false;
      if (needle &&
          !(applicant(r).toLowerCase().includes(needle) ||
            (r.insurance_display_id ?? "").toLowerCase().includes(needle) ||
            epc(r).toLowerCase().includes(needle))) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (epcFilter && epc(r) !== epcFilter) return false;
      if (expiryFilter && !expiryMatch(policyDaysLeft(r), expiryFilter)) return false;
      return inRange(r.created_at);
    });

    // EPC-updated profiles float up — per admin: only until THIS admin opens it.
    const upd = (r: Row) => (insCounts.get(r.id) ?? 0) > 0;
    return out.sort((a, b) => {
      const au = upd(a) ? 1 : 0, bu = upd(b) ? 1 : 0;
      if (au !== bu) return bu - au;
      return byPolicyDaysLeft(a, b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, categoryFilter, statusFilter, epcFilter, expiryFilter, dateFrom, dateTo, period, pFrom, pTo, insCounts]);

  const periodRows = usePeriodRows(rows, period, pFrom, pTo);
  const cards: SummaryCard[] = [
    { key: "",                label: "Total Applications", value: periodRows.length },
    { key: "docs_pending",    label: "Docs Pending",       value: periodRows.filter((r) => catMatch(r, "docs_pending")).length },
    { key: "awaiting_policy", label: "Awaiting Policy",    value: periodRows.filter((r) => catMatch(r, "awaiting_policy")).length },
    { key: "policy_issued",   label: "Policy Issued",      value: periodRows.filter((r) => catMatch(r, "policy_issued")).length },
  ];
  const panelActive = [statusFilter, epcFilter, expiryFilter, dateFrom, dateTo].filter(Boolean).length;
  const activeCount = panelActive + (categoryFilter ? 1 : 0);
  const pickCategory = (key: string) => setCategoryFilter(key === categoryFilter ? "" : key);
  function clearAll() {
    setStatusFilter(""); setEpcFilter(""); setExpiryFilter(""); setCategoryFilter("");
    setDateFrom(""); setDateTo("");
  }

  // Created by — the admin user who added it (from created_by_user_id).
  const createdBy = (r: Row) =>
    r.created_by_user_id ? (adminNames.get(r.created_by_user_id) ?? "Admin") : "—";

  // "Report" — CSV export of the CURRENTLY-FILTERED insurance list.
  function exportReport() {
    const header = ["INS ID", "Insured", "EPC partner", "Sum insured", "Insurance partner", "Status", "Policy from", "Policy to", "Created on", "Created by"];
    const rowsOut = filtered.map((r) => [
      r.insurance_display_id || r.id,
      applicant(r),
      epc(r),
      r.sum_insured ?? r.invoice_confirmed_amount ?? r.invoice_amount ?? "",
      insurerLabelShort(r.insurance_partner),
      INSURANCE_STATUS_LABEL[r.status] ?? r.status,
      ...policyDateCells(r),
      fmtDateTime(r.created_at),
      createdBy(r),
    ]);
    downloadCsv("insurance-applications", header, rowsOut);
  }

  return (
    <>
      <SummaryCards accent={ACCENTS.insurance.color} cards={cards} active={categoryFilter} onPick={pickCategory} />

      <ListToolbar placeholder="Search by applicant, INS id, or EPC…" q={q} onQ={setQ}
        accent={ACCENTS.insurance.color} filterCount={activeCount} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen((o) => !o)}>
        <ReportButton onClick={exportReport} />
        <Button type="button" variant="primary" onClick={() => setAddOpen(true)} className="whitespace-nowrap" style={{ backgroundColor: ACCENTS.insurance.color }}>
          + Add New Insurance Application
        </Button>
      </ListToolbar>

      <FiltersPanel open={filtersOpen} hasActive={activeCount > 0} onClear={clearAll}>
        <Select
          placeholder="Status filter"
          options={Object.entries(INSURANCE_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
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
          options={EXPIRY_OPTIONS}
          value={expiryFilter}
          onChange={(e) => setExpiryFilter(e.target.value)}
        />
        <DateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
      </FiltersPanel>
      <Card className="overflow-hidden cc-table-card">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-[14px] table-fixed cc-table">
          {/* Percentage widths — fills the page evenly, scrolls sideways only on small screens. */}
          <colgroup>
            <col style={{ width: "15%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "9%"  }} />
            <col style={{ width: "9%"  }} />
            <col style={{ width: "9%"  }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%"  }} />
            <col style={{ width: "9%"  }} />
            <col style={{ width: "15%" }} />
          </colgroup>
          {/* Everything centred except Insured name, which stays left. */}
          <thead>
            <tr>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-left">Insured name</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">EPC partner</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Sum insured</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Insurance partner</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Status</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Policy Validity</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Created on</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Created by</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <EmptyRow cols={9} loaded={loaded} hasRows={rows.length > 0} noun="insurance applications" />
            ) : filtered.map((r) => {
              const hl = highlightId === r.id;
              return (
              <tr key={r.id}
                  data-highlighted={hl ? "yes" : undefined}
                  style={highlightRowStyle(hl)}
                  onClick={() => navigateToView(r)}
                  className="border-b border-[#eaf3ee] cursor-pointer hover:bg-[#f7fcfa] align-top">
                {/* Insured name with the INS id beneath — same shape as the
                    EPC name/ID cell on the EPCs tab. */}
                <td className="px-3 py-3">
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-lg bg-[var(--acc-tint)] text-[var(--acc)] grid place-items-center shrink-0">
                      {IconPolicyDoc}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-[#0f3d2e] truncate"><RowLink href={`/admin/insurance/${r.id}/view`} onOpen={() => navigateToView(r)}>{applicant(r)}</RowLink></p>
                      {r.insurance_display_id && <p className="text-[12px] font-mono text-[#185fa5] mt-0.5">{r.insurance_display_id}</p>}
                    </div>
                  </div>
                </td>
                {/* EPC partner — name + EPC ID text only. */}
                <td className="px-3 py-3 text-center">
                  <p className="text-[13px] text-[#0f3d2e] truncate">{epc(r)}</p>
                  {r.epc_business?.epc_display_id && <p className="text-[11px] font-mono text-[#5a8a76] mt-0.5">{r.epc_business.epc_display_id}</p>}
                </td>
                <td className="px-3 py-3 text-center text-[13px] font-semibold text-[#0f3d2e]">{amount(r)}</td>
                <td className="px-3 py-3 text-center text-[13px] text-[#0f3d2e]">{insurerLabelShort(r.insurance_partner)}</td>
                <td className="px-3 py-3 text-center">
                  <span className={`${PILL} ${STATUS_PILL[r.status] ?? STATUS_PILL.draft}`}>
                    {INSURANCE_STATUS_LABEL[r.status] ?? r.status.replace(/_/g, " ")}
                  </span>
                </td>
                {/* Policy Validity — end date, with the colour-coded days-left
                    badge on the line below. */}
                <td className="px-3 py-3 text-center">
                  <PolicyValidityCell from={r.policy_from_date} to={r.policy_to_date} />
                </td>
                <CreatedOnCell at={r.created_at} />
                {/* Created by — the admin user who added it (from created_by_user_id). */}
                <td className="px-3 py-3 text-center text-[13px] text-[#5a8a76]">
                  {createdBy(r)}
                </td>
                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <button type="button" onClick={() => editRow(r)}
                        className="text-[12px] font-semibold px-2.5 py-1.5 rounded-input border border-[#178a5c]/30 bg-white text-[#178a5c] hover:bg-[#f0faf5] inline-flex items-center justify-center gap-1.5">
                        Edit
                      </button>
                      <button type="button" onClick={() => router.push(`/admin/insurance/${r.id}/messages` as any)}
                        title="Message to EPC" aria-label="Message to EPC"
                        className="relative grid place-items-center w-8 h-8 rounded-input border border-[#cdeadd] bg-white text-[#178a5c] hover:bg-[#f0faf5] transition-colors">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        <UnseenBadge n={insCounts.get(r.id) ?? 0} />
                      </button>
                    </div>
                    {/* Download Policy — only when a policy document exists. */}
                    {r.policy_path && <DownloadPolicyButton busy={policyBusy === r.id} onClick={() => void downloadPolicy(r)} />}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>

      <AddNewInsuranceModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
