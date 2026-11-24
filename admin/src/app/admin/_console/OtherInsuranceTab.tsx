"use client";

// Admin console — Other Insurance tab: general (non-solar) insurance files,
// main admin only (migration 0093). Same table as Solar Insurance minus the EPC
// column; the file opens /admin/other-insurance/[id] (KYC docs → policy →
// validity → name).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import { ACCENTS } from "@/components/AdminSidebar";
import { supabase } from "@/lib/supabase";
import { getCached, setCached } from "@/lib/list-cache";
import { useAdminNames } from "@/lib/use-admin-names";
import RowLink from "@/components/RowLink";
import { fmtRupees } from "@/lib/money";
import { fmtDateTime } from "@/lib/dates";
import { notify } from "@/lib/notify";
import { otherInsDoc, OTHER_INS_LIST_CACHE } from "@/lib/other-insurance";
import { inPeriod, usePeriodRows, type TabPeriodProps } from "./console-period";
import {
  CreatedOnCell, DateRange, EmptyRow, FiltersPanel, ListToolbar, PILL, ReportButton, SummaryCards,
  createdRange, downloadCsv,
  type SummaryCard,
} from "./kit";
import {
  DownloadPolicyButton, EXPIRY_OPTIONS, IconPolicyDoc, PolicyValidityCell, byPolicyDaysLeft, expiryMatch, policyDateCells, policyDaysLeft,
} from "./policy";

export default function OtherInsuranceTab({ period, pFrom, pTo }: TabPeriodProps) {
  const router = useRouter();
  const adminNames = useAdminNames();
  type Row = {
    id: string;
    display_id: string | null;
    customer_name: string | null;
    sum_insured: number | null;
    insurance_company: string | null;
    policy_path: string | null;
    policy_from_date: string | null;
    policy_to_date: string | null;
    kyc_docs: unknown[] | null;
    created_at: string;
    created_by_user_id: string | null;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false); // first read done (cache or query)
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [expiryFilter, setExpiryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const CK = OTHER_INS_LIST_CACHE;
      const cached = getCached<Row[]>(CK, 45000);
      if (cached) { setRows(cached); setLoaded(true); return; }
      const { data } = await supabase()
        .from("other_insurance")
        .select("id, display_id, customer_name, sum_insured, insurance_company, policy_path, policy_from_date, policy_to_date, kyc_docs, created_at, created_by_user_id")
        .order("created_at", { ascending: false });
      const list = (data ?? []) as unknown as Row[];
      setRows(list);
      setLoaded(true);
      setCached(CK, list);
    })();
  }, []);

  // Row → the file's view profile; Edit / Add → the form ("new" adds one).
  const open = (id: string, edit = false) => {
    sessionStorage.setItem("adminList.tab", "otherins");
    router.push(edit ? `/admin/other-insurance/${id}` : `/admin/other-insurance/${id}/view`);
  };
  const customer = (r: Row) => r.customer_name || "—";
  const issued = (r: Row) => r.policy_path != null;

  async function downloadPolicy(r: Row) {
    if (busyId || !r.policy_path) return;
    setBusyId(r.id);
    try {
      const res = await otherInsDoc(r.id, r.policy_path, "sign");
      if (res.ok && res.url) window.open(res.url, "_blank", "noopener");
      else notify.error("Couldn't open the policy: " + res.error);
    } catch (e) {
      notify.error("Couldn't open the policy: " + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function catMatch(r: Row, key: string): boolean {
    switch (key) {
      case "docs_pending":    return !(r.kyc_docs?.length);
      case "awaiting_policy": return !issued(r);
      case "policy_issued":   return issued(r);
      default:                return true;
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const inRange = createdRange(dateFrom, dateTo);
    const out = rows.filter((r) => {
      if (!inPeriod(r.created_at, period, pFrom, pTo)) return false;
      if (categoryFilter && !catMatch(r, categoryFilter)) return false;
      if (needle && !(customer(r).toLowerCase().includes(needle) || (r.display_id ?? "").toLowerCase().includes(needle))) return false;
      if (statusFilter === "issued" && !issued(r)) return false;
      if (statusFilter === "awaiting" && issued(r)) return false;
      if (expiryFilter && !expiryMatch(policyDaysLeft(r), expiryFilter)) return false;
      return inRange(r.created_at);
    });
    // Rows with policy dates first, fewest days left on top; the rest newest first.
    return out.sort(byPolicyDaysLeft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, categoryFilter, statusFilter, expiryFilter, dateFrom, dateTo, period, pFrom, pTo]);

  const periodRows = usePeriodRows(rows, period, pFrom, pTo);
  const cards: SummaryCard[] = [
    { key: "",                label: "Total Applications", value: periodRows.length },
    { key: "docs_pending",    label: "Docs Pending",       value: periodRows.filter((r) => catMatch(r, "docs_pending")).length },
    { key: "awaiting_policy", label: "Awaiting Policy",    value: periodRows.filter((r) => catMatch(r, "awaiting_policy")).length },
    { key: "policy_issued",   label: "Policy Issued",      value: periodRows.filter((r) => catMatch(r, "policy_issued")).length },
  ];
  const panelActive = [statusFilter, expiryFilter, dateFrom, dateTo].filter(Boolean).length;
  const activeCount = panelActive + (categoryFilter ? 1 : 0);
  const pickCategory = (key: string) => setCategoryFilter(key === categoryFilter ? "" : key);
  function clearAll() {
    setStatusFilter(""); setExpiryFilter(""); setCategoryFilter(""); setDateFrom(""); setDateTo("");
  }

  // Created by — the admin user who added it (from created_by_user_id).
  const createdBy = (r: Row) =>
    r.created_by_user_id ? (adminNames.get(r.created_by_user_id) ?? "Admin") : "—";

  function exportReport() {
    const header = ["OI ID", "Customer", "Sum insured", "Insurance company", "Status", "Policy from", "Policy to", "Created on", "Created by"];
    downloadCsv("other-insurance", header, filtered.map((r) => [
      r.display_id || r.id,
      customer(r),
      r.sum_insured ?? "",
      r.insurance_company ?? "",
      issued(r) ? "Issued" : "Awaiting policy",
      ...policyDateCells(r),
      fmtDateTime(r.created_at),
      createdBy(r),
    ]));
  }

  const th = "px-3 py-3 font-medium text-[12px] uppercase tracking-wide";
  return (
    <>
      <SummaryCards accent={ACCENTS.otherins.color} cards={cards} active={categoryFilter} onPick={pickCategory} />

      <ListToolbar placeholder="Search by customer or OI id…" q={q} onQ={setQ}
        accent={ACCENTS.otherins.color} filterCount={activeCount} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen((o) => !o)}>
        <ReportButton onClick={exportReport} />
        <Button type="button" variant="primary" onClick={() => open("new", true)} className="whitespace-nowrap" style={{ backgroundColor: ACCENTS.otherins.color }}>
          + Add New Insurance Application
        </Button>
      </ListToolbar>

      <FiltersPanel open={filtersOpen} hasActive={activeCount > 0} onClear={clearAll}>
        <Select placeholder="Status filter" options={[{ value: "issued", label: "Issued" }, { value: "awaiting", label: "Awaiting policy" }]}
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
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
        <table className="w-full min-w-[900px] text-[14px] table-fixed cc-table">
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className={th + " text-left"}>Insured name</th>
              <th className={th + " text-center"}>Sum insured</th>
              <th className={th + " text-center"}>Insurance company</th>
              <th className={th + " text-center"}>Status</th>
              <th className={th + " text-center"}>Policy Validity</th>
              <th className={th + " text-center"}>Created on</th>
              <th className={th + " text-center"}>Created by</th>
              <th className={th + " text-center"}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <EmptyRow cols={8} loaded={loaded} hasRows={rows.length > 0} noun="insurance applications" />
            ) : filtered.map((r) => (
              <tr key={r.id} onClick={() => open(r.id)} className="border-b border-cc-row-line cursor-pointer hover:bg-cc-row-hover align-top">
                <td className="px-3 py-3">
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-md grid place-items-center shrink-0" style={{ backgroundColor: ACCENTS.otherins.tint, color: ACCENTS.otherins.color }}>
                      {IconPolicyDoc}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-cc-ink truncate"><RowLink href={`/admin/other-insurance/${r.id}/view`} onOpen={() => open(r.id)}>{customer(r)}</RowLink></p>
                      {r.display_id && <p className="text-[12px] font-mono text-cc-blue mt-0.5">{r.display_id}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-center text-[13px] font-semibold text-cc-ink">{fmtRupees(r.sum_insured)}</td>
                <td className="px-3 py-3 text-center text-[13px] text-cc-ink truncate">{r.insurance_company || "—"}</td>
                <td className="px-3 py-3 text-center">
                  <span className={`${PILL} ${issued(r) ? "bg-cc-tint text-cc-green" : "bg-warn-tint text-warn-ink"}`}>
                    {issued(r) ? "Issued" : "Awaiting policy"}
                  </span>
                </td>
                <td className="px-3 py-3 text-center"><PolicyValidityCell from={r.policy_from_date} to={r.policy_to_date} /></td>
                <CreatedOnCell at={r.created_at} />
                <td className="px-3 py-3 text-center text-[13px] text-cc-muted">
                  {createdBy(r)}
                </td>
                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-col gap-1.5">
                    <button type="button" onClick={() => open(r.id, true)}
                      className="text-[12px] font-semibold px-2.5 py-1.5 rounded-input border border-cc-green/30 bg-white text-cc-green hover:bg-cc-wash">
                      Edit
                    </button>
                    {r.policy_path && <DownloadPolicyButton busy={busyId === r.id} onClick={() => void downloadPolicy(r)} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </>
  );
}
