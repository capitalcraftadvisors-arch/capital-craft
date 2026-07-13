"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import AddNewEpcModal from "@/components/AddNewEpcModal";
import AddNewLoanAppModal from "@/components/AddNewLoanAppModal";
import LenderPickerModal, { LenderKey } from "@/components/LenderPickerModal";
import { supabase } from "@/lib/supabase";
import { logout, getToken } from "@/lib/auth";
import { lenderOutcome, OUTCOME_LABEL, OUTCOME_PILL, OUTCOME_STATUSES, type LenderOutcome } from "@/lib/loan-status";

type Tab = "epcs" | "apps";

export default function AdminHomePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("epcs");
  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-[20px] grad-text">Capital Craft</span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">Admin</span>
          </div>
          <button onClick={() => { logout(); router.replace("/login"); }} className="text-[13px] text-text-muted hover:text-text">
            Log out
          </button>
        </div>
      </header>

      <section className="w-full px-4 sm:px-6 py-8">
        <h1 className="font-display text-[26px] sm:text-[30px] font-bold mb-6">Priyank Console</h1>

        <div className="flex gap-2 mb-6 border-b border-line">
          <TabBtn active={tab === "epcs"} onClick={() => setTab("epcs")}>EPCs</TabBtn>
          <TabBtn active={tab === "apps"} onClick={() => setTab("apps")}>Loan applications</TabBtn>
          {/* Analytics is a dedicated full page — the tab acts as a
              navigation link, not an inline tab body. */}
          <TabBtn active={false} onClick={() => router.push("/admin/analytics" as any)}>
            Analytics
          </TabBtn>
        </div>

        {tab === "epcs" ? <EpcsTab /> : <AppsTab />}
      </section>
    </main>
  );
}

function TabBtn({ active, children, ...rest }: any) {
  return (
    <button
      {...rest}
      className={[
        "px-4 py-2.5 text-[14px] font-semibold border-b-2 transition-colors",
        active ? "border-blue text-blue" : "border-transparent text-text-muted hover:text-text",
      ].join(" ")}
    >
      {children}
    </button>
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
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
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
      .select("id, epc_display_id, legal_name, trade_name, contact_name, contact_mobile, contact_email, business_type, status, source, created_at, submitted_at, epc_self_edited")
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

  const filtered = useMemo(() => {
    const base = q.trim()
      ? rows.filter((r) => {
          const ql = q.toLowerCase();
          return (
            (r.legal_name || "").toLowerCase().includes(ql) ||
            (r.trade_name || "").toLowerCase().includes(ql) ||
            (r.epc_display_id || "").toLowerCase().includes(ql) ||
            (r.contact_name || "").toLowerCase().includes(ql) ||
            (r.contact_mobile || "").includes(q) ||
            (r.contact_email || "").toLowerCase().includes(ql)
          );
        })
      : rows;
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
  }, [rows, q, sortKey, sortDir]);

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

  return (
    <>
      <div className="grid sm:grid-cols-[1fr_220px_auto] gap-3 mb-5">
        <Input
          placeholder="Search by name, ID, POC, mobile, or email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          placeholder="Status filter"
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
        <Button
          type="button"
          variant="primary"
          onClick={() => setAddOpen(true)}
          className="whitespace-nowrap"
        >
          + Add New EPC
        </Button>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-[14px] table-fixed">
          {/* Column widths tuned so every column shows fully at ~1366px+.
              Internal Status needs room for the status pill AND the
              UPDATED pill side-by-side without clipping. Lenders is
              tightened to give that space back. EPC details flexes. */}
          <colgroup>
            <col style={{ width: "auto" }} />
            <col style={{ width: "88px" }} />
            <col style={{ width: "110px" }} />
            <col style={{ width: "168px" }} />
            <col style={{ width: "140px" }} />
            <col style={{ width: "300px" }} />
          </colgroup>
          <thead className="bg-[#f0faf5] border-b border-[#cdeadd] text-left text-[#5a8a76]">
            <tr>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">EPC details</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">Source</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">
                <button type="button" onClick={() => toggleSort("created_at")} className="inline-flex items-center gap-1 uppercase tracking-wide">
                  Profile created
                  <SortMark active={sortKey === "created_at"} dir={sortDir} />
                </button>
              </th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">
                <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1 uppercase tracking-wide">
                  Internal status
                  <SortMark active={sortKey === "status"} dir={sortDir} />
                </button>
              </th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">Action</th>
              <th className="px-3 py-3 font-medium text-[12px] uppercase tracking-wide">Lenders</th>
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
                <td className="px-3 py-3">
                  <SourcePill source={r.source} />
                </td>
                <td className="px-3 py-3">
                  <p className="text-[13px] text-[#0f3d2e]">
                    {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                  <p className="text-[11px] text-[#5a8a76]">
                    {new Date(r.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={r.status} updated={r.epc_self_edited === true} />
                </td>
                <td className="px-3 py-3">
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
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
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
    status: string; created_at: string; created_by: string;
    epc_business: { contact_name: string | null; trade_name: string | null; legal_name: string | null; epc_display_id: string | null } | null;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [zipBusy, setZipBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let query = supabase()
        .from("epc_applications")
        .select(
          "id, borrower_name, aadhaar_name, aadhaar_number_masked, loan_display_id, " +
          "loan_amount, loan_amount_required, " +
          "status, created_at, created_by, " +
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .order("created_at", { ascending: false });
      // Filter maps a lender-outcome bucket to its underlying statuses.
      if (statusFilter && statusFilter in OUTCOME_STATUSES) {
        query = query.in("status", OUTCOME_STATUSES[statusFilter as LenderOutcome]);
      }
      const { data } = await query;
      setRows((data ?? []) as unknown as Row[]);
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
  function displayAmount(r: Row): string {
    const n = r.loan_amount_required ?? r.loan_amount;
    return n ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
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
  async function downloadLoanZip(r: Row) {
    if (zipBusy) return;
    setZipBusy(r.id);
    try {
      const res = await fetch(`/api/admin/loan-app/${r.id}/download-zip`, {
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

  const filtered = q.trim()
    ? rows.filter((r) =>
        displayBorrower(r).toLowerCase().includes(q.toLowerCase()) ||
        (r.loan_display_id ?? "").toLowerCase().includes(q.toLowerCase()) ||
        displayEpc(r).toLowerCase().includes(q.toLowerCase()))
    : rows;

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          + Add New Loan Application
        </Button>
      </div>
      <div className="grid sm:grid-cols-[1fr_220px] gap-3 mb-5">
        <Input placeholder="Search by borrower or EPC…" value={q} onChange={(e) => setQ(e.target.value)} />
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
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-[14px] table-fixed">
          <colgroup>
            <col />
            <col />
            <col style={{ width: "130px" }} />
            <col style={{ width: "140px" }} />
            <col style={{ width: "105px" }} />
            <col style={{ width: "150px" }} />
          </colgroup>
          <thead className="bg-bg-soft border-b border-line text-left text-text-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Borrower Details</th>
              <th className="px-5 py-3 font-medium">EPC Partner</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">By</th>
              <th className="px-5 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-text-muted">No applications match.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/admin/app/${r.id}/view` as any)}
                  className="border-b border-line cursor-pointer hover:bg-[#f0faf5] transition-colors">
                {/* Borrower detail box: name + LA id + masked Aadhaar */}
                <td className="px-5 py-4">
                  <div className="font-semibold text-text truncate">{displayBorrower(r)}</div>
                  {r.loan_display_id && (
                    <div className="text-[11px] font-mono text-[#185fa5] mt-0.5">{r.loan_display_id}</div>
                  )}
                  {displayMaskedAadhaar(r) && (
                    <div className="text-[11px] font-mono text-text-muted mt-0.5">{displayMaskedAadhaar(r)}</div>
                  )}
                </td>
                <td className="px-5 py-4 truncate">
                  <div className="text-text">{displayEpc(r)}</div>
                  {r.epc_business?.epc_display_id && (
                    <div className="text-[11px] font-mono text-text-muted mt-0.5">{r.epc_business.epc_display_id}</div>
                  )}
                </td>
                <td className="px-5 py-4 font-semibold text-[#0f3d2e]">{displayAmount(r)}</td>
                {/* Loan apps have no internal admin status — show the
                    lender outcome (same 3 buckets as the EPC's own view). */}
                <td className="px-5 py-4">
                  <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${OUTCOME_PILL[lenderOutcome(r.status)]}`}>
                    {OUTCOME_LABEL[lenderOutcome(r.status)]}
                  </span>
                </td>
                <td className="px-5 py-4 text-text-muted">
                  {r.created_by === "admin" ? "Admin" : "Customer"}
                </td>
                {/* Action: View + Download ZIP. stopPropagation so the
                    buttons don't also trigger the row's navigate. */}
                <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/admin/app/${r.id}/view` as any)}
                      className="px-2.5 py-1.5 text-[12px] font-semibold text-[#185fa5] border border-[#d3e9f7] rounded hover:bg-[#dceffb] transition-colors"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadLoanZip(r)}
                      disabled={zipBusy === r.id}
                      title="Download all documents + summary as ZIP"
                      className="px-2.5 py-1.5 text-[12px] font-semibold text-[#178a5c] border border-[#cdeadd] rounded hover:bg-[#f0faf5] disabled:opacity-60 transition-colors"
                    >
                      {zipBusy === r.id ? "…" : "ZIP"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <AddNewLoanAppModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
