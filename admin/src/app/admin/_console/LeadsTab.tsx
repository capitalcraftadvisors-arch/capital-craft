"use client";

// Admin console — Leads (Non-EPC) tab: customer_leads captured from the public
// /apply form. Status cards, list with inline status change, lead details
// popup with delete, and the CSV report.

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import DeleteLeadModal from "@/components/DeleteLeadModal";
import { ACCENTS } from "@/components/AdminSidebar";
import { supabase } from "@/lib/supabase";
import { getCached, setCached, invalidate } from "@/lib/list-cache";
import { nameCase } from "@/lib/names";
import { fmtRupees } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { LEAD_STATUS_PILL } from "@/lib/lead-status";
import { inPeriod, usePeriodRows, type TabPeriodProps } from "./console-period";
import {
  CreatedOnCell, DateRange, EmptyRow, FiltersPanel, ListToolbar, PILL, ReportButton, SummaryCards,
  createdRange, downloadCsv, fmtAddedTime,
  type SummaryCard,
} from "./kit";

type Lead = {
  id: string; created_at: string; lead_type: "loan" | "insurance";
  name: string | null; mobile: string; city: string | null; pincode: string | null;
  pan: string | null; aadhaar: string | null;
  project_cost: number | null; loan_amount: number | null;
  plant_value: number | null; gstin: string | null; status: string;
};
export default function LeadsTab({ period, pFrom, pTo }: TabPeriodProps) {
  const [rows, setRows] = useState<Lead[]>([]);
  const [loaded, setLoaded] = useState(false); // first read done (cache or query)
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewLead, setViewLead] = useState<Lead | null>(null);
  const [delLead, setDelLead] = useState<Lead | null>(null);

  useEffect(() => {
    (async () => {
      const CK = "dash.leads";
      const cached = getCached<Lead[]>(CK, 45000);
      if (cached) { setRows(cached); setLoaded(true); return; }
      const { data } = await supabase()
        .from("customer_leads")
        .select("id, created_at, lead_type, name, mobile, city, pincode, pan, aadhaar, project_cost, loan_amount, plant_value, gstin, status")
        .order("created_at", { ascending: false });
      const rows = (data ?? []) as unknown as Lead[];
      setRows(rows);
      setLoaded(true);
      setCached(CK, rows);
    })();
  }, []);

  async function setStatus(r: Lead, status: string) {
    setBusy(r.id);
    const { error } = await supabase().from("customer_leads").update({ status }).eq("id", r.id);
    if (error) alert("Couldn't update status: " + error.message);
    else { setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status } : x))); invalidate("dash.leads"); }
    setBusy(null);
  }
  const maskAadhaar = (a: string | null) => (a ? "XXXX XXXX " + a.slice(-4) : "—");

  // Category predicate — the summary cards are the lead statuses. "" = all.
  const catMatch = (r: Lead, key: string) => (key ? r.status === key : true);
  const inRange = createdRange(dateFrom, dateTo);
  const filtered = rows.filter((r) => {
    if (!inPeriod(r.created_at, period, pFrom, pTo)) return false; // period drives the list too
    if (categoryFilter && !catMatch(r, categoryFilter)) return false;
    const needle = q.trim().toLowerCase();
    if (needle && !((r.name ?? "").toLowerCase().includes(needle) || r.mobile.includes(needle) || (r.city ?? "").toLowerCase().includes(needle))) return false;
    if (typeFilter && r.lead_type !== typeFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return inRange(r.created_at);
  });

  const periodRows = usePeriodRows(rows, period, pFrom, pTo);
  const cards: SummaryCard[] = [
    { key: "",          label: "Total Leads", value: periodRows.length },
    { key: "new",       label: "New",         value: periodRows.filter((r) => r.status === "new").length },
    { key: "contacted", label: "Contacted",   value: periodRows.filter((r) => r.status === "contacted").length },
    { key: "converted", label: "Converted",   value: periodRows.filter((r) => r.status === "converted").length },
    { key: "closed",    label: "Closed",      value: periodRows.filter((r) => r.status === "closed").length },
  ];
  const panelActive = [typeFilter, statusFilter, dateFrom, dateTo].filter(Boolean).length;
  const activeCount = panelActive + (categoryFilter ? 1 : 0);
  const pickCategory = (key: string) => setCategoryFilter(key === categoryFilter ? "" : key);
  function clearAll() {
    setTypeFilter(""); setStatusFilter(""); setCategoryFilter("");
    setDateFrom(""); setDateTo("");
  }

  // "Report" — CSV export of the CURRENTLY-FILTERED non-EPC lead list.
  function exportReport() {
    const header = ["Name", "Mobile", "Type", "City", "Pincode", "Project cost", "Loan amount", "Plant value", "GSTIN", "PAN", "Status", "Received"];
    const rowsOut = filtered.map((r) => [
      r.name || "",
      r.mobile,
      r.lead_type,
      r.city ?? "",
      r.pincode ?? "",
      r.project_cost ?? "",
      r.loan_amount ?? "",
      r.plant_value ?? "",
      r.gstin ?? "",
      r.pan ?? "",
      r.status,
      fmtDateTime(r.created_at),
    ]);
    downloadCsv("customer-leads", header, rowsOut);
  }

  return (
    <>
      <SummaryCards accent={ACCENTS.leads.color} cards={cards} active={categoryFilter} onPick={pickCategory} />

      <ListToolbar placeholder="Search by name, mobile, or city…" q={q} onQ={setQ}
        accent={ACCENTS.leads.color} filterCount={activeCount} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen((o) => !o)}>
        <ReportButton onClick={exportReport} />
      </ListToolbar>

      <FiltersPanel open={filtersOpen} hasActive={activeCount > 0} onClear={clearAll}>
        <Select placeholder="Type" options={[{ value: "loan", label: "Loan" }, { value: "insurance", label: "Insurance" }]} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} />
        <Select placeholder="Status" options={[{ value: "new", label: "New" }, { value: "contacted", label: "Contacted" }, { value: "converted", label: "Converted" }, { value: "closed", label: "Closed" }]} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
        <DateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
      </FiltersPanel>
      <Card className="overflow-x-auto cc-table-card">
        <table className="w-full text-[14px] cc-table">
          <thead className="text-left">
            <tr>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">Customer</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Type</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">Amounts</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">KYC</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Created on</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <EmptyRow cols={6} loaded={loaded} hasRows={rows.length > 0} noun="leads" />
            ) : filtered.map((r) => (
              <tr key={r.id} onClick={() => setViewLead(r)} className="border-b border-[#eaf3ee] hover:bg-[#f7fcfa] align-top cursor-pointer">
                <td className="px-3 py-3">
                  <p className="text-[15px] font-semibold text-[#0f3d2e]">
                    <button type="button" onClick={(e) => { e.stopPropagation(); setViewLead(r); }} className="text-left hover:underline">{r.name || "—"}</button>
                  </p>
                  <p className="text-[12px] text-[#5a8a76] mt-0.5">+91 {r.mobile}</p>
                  {(r.city || r.pincode) && <p className="text-[12px] text-[#5a8a76]">{[r.city, r.pincode].filter(Boolean).join(" · ")}</p>}
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`${PILL} bg-[#dceffb] text-[#185fa5]`}>{nameCase(r.lead_type)}</span>
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
                <CreatedOnCell at={r.created_at} />
                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <select
                    disabled={busy === r.id}
                    value={r.status}
                    onChange={(e) => void setStatus(r, e.target.value)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border-none cursor-pointer outline-none ${LEAD_STATUS_PILL[r.status] ?? LEAD_STATUS_PILL.new}`}
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
              <LeadRow k="Received" v={fmtDate(viewLead.created_at) + " · " + fmtAddedTime(viewLead.created_at)} />
            </div>
            <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[12px] text-[#5a8a76] max-w-xs">Basic lead details — not under any EPC. Use these to reach out and build the full profile.</p>
              <button
                type="button"
                onClick={() => setDelLead(viewLead)}
                className="text-[13px] font-semibold px-3.5 py-2 rounded-[8px] border border-red-300 text-red-700 hover:bg-red-50 hover:border-red-500 disabled:opacity-60 shrink-0 inline-flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                Delete lead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Type-DELETE confirm — replaces the old window.confirm. Deletes via the
          admin-only route (writes an activity-log entry). */}
      <DeleteLeadModal
        open={!!delLead}
        onClose={() => setDelLead(null)}
        onDeleted={(p) => {
          setRows((rs) => rs.filter((x) => x.id !== p.id));
          invalidate("dash.leads");
          setDelLead(null);
          setViewLead(null);
        }}
        leadId={delLead?.id ?? ""}
        name={delLead?.name ?? null}
        mobile={delLead?.mobile ?? null}
        leadType={delLead?.lead_type ?? null}
      />
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
