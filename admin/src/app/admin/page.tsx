"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import StatusBadge from "@/components/StatusBadge";
import { supabase } from "@/lib/supabase";
import { logout, getToken } from "@/lib/auth";

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
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-[20px] grad-text">Capital Craft</span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">Admin</span>
          </div>
          <button onClick={() => { logout(); router.replace("/login"); }} className="text-[13px] text-text-muted hover:text-text">
            Log out
          </button>
        </div>
      </header>

      <section className="max-w-container mx-auto px-5 sm:px-7 py-10">
        <h1 className="font-display text-[26px] sm:text-[30px] font-bold mb-6">Ops console</h1>

        <div className="flex gap-2 mb-6 border-b border-line">
          <TabBtn active={tab === "epcs"} onClick={() => setTab("epcs")}>EPCs</TabBtn>
          <TabBtn active={tab === "apps"} onClick={() => setTab("apps")}>Loan applications</TabBtn>
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

type LenderState = { docs_given: boolean; approved: boolean };
type LenderMap = Partial<Record<Lender, LenderState>>;

// Display-only mask for the admin LIST table. Full number still shows on
// the admin EPC detail page. Non-10-digit numbers pass through unchanged.
function maskMobile(m: string | null): string {
  if (!m) return "—";
  return m.length === 10 ? "•••••" + m.slice(5) : m;
}

function EpcsTab() {
  const router = useRouter();
  type Row = {
    id: string;
    legal_name: string | null;
    trade_name: string | null;
    contact_name: string | null;
    contact_mobile: string | null;
    contact_email: string | null;
    business_type: string | null;
    status: string;
    submitted_at: string | null;
    epc_self_edited: boolean | null;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // business_id → lender_name → state. Missing key = both false.
  const [lenderState, setLenderState] = useState<Record<string, LenderMap>>({});
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  async function load() {
    let query = supabase().from("epc_business")
      .select("id, legal_name, trade_name, contact_name, contact_mobile, contact_email, business_type, status, submitted_at, epc_self_edited")
      .neq("business_type", "admin")
      .order("submitted_at", { ascending: false, nullsFirst: false });
    if (statusFilter) query = query.eq("status", statusFilter);
    const { data } = await query;
    const rs = (data ?? []) as Row[];
    setRows(rs);

    // Batch-fetch lender state for all EPCs in view.
    if (rs.length > 0) {
      const ids = rs.map((r) => r.id);
      const { data: lenderRows } = await supabase()
        .from("epc_lender_status")
        .select("business_id, lender, docs_given, approved")
        .in("business_id", ids);
      const map: Record<string, LenderMap> = {};
      for (const lr of (lenderRows ?? []) as { business_id: string; lender: Lender; docs_given: boolean; approved: boolean }[]) {
        if (!map[lr.business_id]) map[lr.business_id] = {};
        map[lr.business_id][lr.lender] = { docs_given: lr.docs_given, approved: lr.approved };
      }
      setLenderState(map);
    } else {
      setLenderState({});
    }
  }

  useEffect(() => { void load(); }, [statusFilter]);

  const filtered = q.trim()
    ? rows.filter((r) =>
        (r.legal_name || "").toLowerCase().includes(q.toLowerCase()) ||
        (r.trade_name || "").toLowerCase().includes(q.toLowerCase()) ||
        (r.contact_name || "").toLowerCase().includes(q.toLowerCase()) ||
        (r.contact_mobile || "").includes(q) ||
        (r.contact_email || "").toLowerCase().includes(q.toLowerCase()))
    : rows;

  // Lazy upsert: if no row exists, insert; otherwise update.
  async function toggleLender(epcId: string, lender: Lender, field: "docs_given" | "approved", value: boolean) {
    // Approve-ON requires an admin confirmation. Approve-OFF and any
    // docs_given toggle proceed silently.
    if (field === "approved" && value === true) {
      if (!window.confirm("Are you sure for this approval?")) return;
    }
    // Optimistic UI update.
    const prevState = lenderState;
    setLenderState((s) => {
      const next = { ...s };
      const cur = (next[epcId] ?? {}) as LenderMap;
      const lenderCur = (cur[lender] ?? { docs_given: false, approved: false }) as LenderState;
      next[epcId] = { ...cur, [lender]: { ...lenderCur, [field]: value } };
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
          .update({ [field]: value })
          .eq("id", (existing as { id: string }).id);
      } else {
        // Lazy insert. The other boolean defaults to false.
        const row: Record<string, unknown> = {
          business_id: epcId,
          lender,
          docs_given: false,
          approved: false,
        };
        row[field] = value;
        await supabase().from("epc_lender_status").insert(row);
      }
    } catch (e) {
      // Revert on failure.
      setLenderState(prevState);
      alert("Couldn't save lender state: " + (e as Error).message);
    }
  }

  // Streams the ZIP from /api/epc/[id]/download-zip and triggers a browser
  // download. Per-row spinner while fetching; alert on failure.
  async function downloadZip(row: Row) {
    if (downloading[row.id]) return;
    setDownloading((d) => ({ ...d, [row.id]: true }));
    try {
      const res = await fetch(`/api/epc/${row.id}/download-zip`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch { /* body wasn't JSON — keep HTTP status */ }
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
      setDownloading((d) => {
        const next = { ...d };
        delete next[row.id];
        return next;
      });
    }
  }

  return (
    <>
      <div className="grid sm:grid-cols-[1fr_220px] gap-3 mb-5">
        <Input placeholder="Search by legal name, POC, mobile, or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          placeholder="All statuses"
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
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-[14px] min-w-[1000px]">
          <thead className="bg-bg-soft border-b border-line text-left text-text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">EPC details</th>
              <th className="px-4 py-3 font-medium">Email ID</th>
              <th className="px-4 py-3 font-medium">Type of business</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Submitted on</th>
              <th className="px-4 py-3 font-medium">Lenders</th>
              <th className="px-4 py-3 font-medium">Download</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-text-muted">No EPCs match.</td></tr>
            ) : filtered.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/admin/epc/${r.id}` as any)}
                className="border-b border-line cursor-pointer hover:bg-bg-soft transition-colors align-top"
              >
                <td className="px-4 py-3">
                  <div className="space-y-0.5 min-w-[180px]">
                    <p className="text-[13px] font-semibold text-text">
                      {r.legal_name || <span className="text-text-muted font-normal">—</span>}
                    </p>
                    {r.trade_name && (
                      <p className="text-[12px] text-text-mid italic">{r.trade_name}</p>
                    )}
                    <p className="text-[12px] text-text-mid">{r.contact_name || "—"}</p>
                    <p className="text-[12px] text-text-muted">+91 {maskMobile(r.contact_mobile)}</p>
                  </div>
                </td>
                <td className="px-4 py-3 text-[13px]">{r.contact_email || <span className="text-text-muted">—</span>}</td>
                <td className="px-4 py-3 text-[13px]">{BUSINESS_TYPE_LABEL[r.business_type ?? ""] ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} updated={r.epc_self_edited === true} />
                </td>
                <td className="px-4 py-3 text-[13px] text-text-muted">
                  {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString("en-IN") : "—"}
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <LenderCell
                    state={lenderState[r.id] ?? {}}
                    onToggle={(lender, field, v) => toggleLender(r.id, lender, field, v)}
                  />
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    disabled={!!downloading[r.id]}
                    onClick={() => downloadZip(r)}
                    className={[
                      "text-[12px] font-semibold px-3 py-1.5 rounded-input border transition-colors",
                      downloading[r.id]
                        ? "border-line bg-bg-soft text-text-muted cursor-not-allowed"
                        : "border-blue/30 bg-white text-blue hover:bg-blue/5",
                    ].join(" ")}
                    title={downloading[r.id] ? "Preparing ZIP…" : "Download all documents + profile summary as a ZIP"}
                  >
                    {downloading[r.id] ? "Preparing…" : "Download ZIP"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function LenderCell({
  state, onToggle,
}: {
  state: LenderMap;
  onToggle: (lender: Lender, field: "docs_given" | "approved", value: boolean) => void;
}) {
  return (
    <div className="space-y-1.5 min-w-[220px]">
      {LENDERS.map((l) => {
        const s = state[l.key] ?? { docs_given: false, approved: false };
        return (
          <div key={l.key} className="flex items-center gap-3 text-[11px]">
            <span className="min-w-[64px] font-medium text-text-mid">{l.label}</span>
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={s.docs_given}
                onChange={(e) => onToggle(l.key, "docs_given", e.target.checked)}
                className="h-3.5 w-3.5 accent-blue"
              />
              <span className="text-text-mid">Docs</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={s.approved}
                onChange={(e) => onToggle(l.key, "approved", e.target.checked)}
                className="h-3.5 w-3.5 accent-green"
              />
              <span className="text-text-mid">Approved</span>
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
    id: string; borrower_name: string | null; loan_amount: number | null;
    status: string; created_at: string; created_by: string;
    epc_business: { contact_name: string | null } | null;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    (async () => {
      let query = supabase()
        .from("epc_applications")
        .select("id, borrower_name, loan_amount, status, created_at, created_by, epc_business:epc_business_id(contact_name)")
        .order("created_at", { ascending: false });
      if (statusFilter) query = query.eq("status", statusFilter);
      const { data } = await query;
      setRows((data ?? []) as unknown as Row[]);
    })();
  }, [statusFilter]);

  const filtered = q.trim()
    ? rows.filter((r) =>
        (r.borrower_name || "").toLowerCase().includes(q.toLowerCase()) ||
        (r.epc_business?.contact_name || "").toLowerCase().includes(q.toLowerCase()))
    : rows;

  return (
    <>
      <div className="grid sm:grid-cols-[1fr_220px] gap-3 mb-5">
        <Input placeholder="Search by borrower or EPC…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          placeholder="All statuses"
          options={[
            { value: "draft", label: "Draft" },
            { value: "submitted", label: "Submitted" },
            { value: "under_review", label: "Under review" },
            { value: "approved", label: "Approved" },
            { value: "on_hold", label: "On hold" },
            { value: "rejected", label: "Rejected" },
            { value: "sent_to_nbfc", label: "Sent to NBFC" },
            { value: "disbursed", label: "Disbursed" },
          ]}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="bg-bg-soft border-b border-line text-left text-text-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Borrower</th>
              <th className="px-5 py-3 font-medium">EPC</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 font-medium">By</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-text-muted">No applications match.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/admin/app/${r.id}` as any)}
                  className="border-b border-line cursor-pointer hover:bg-bg-soft transition-colors">
                <td className="px-5 py-4">{r.borrower_name || "—"}</td>
                <td className="px-5 py-4">{r.epc_business?.contact_name || "—"}</td>
                <td className="px-5 py-4">{r.loan_amount ? `₹${Number(r.loan_amount).toLocaleString("en-IN")}` : "—"}</td>
                <td className="px-5 py-4"><StatusBadge status={r.status} /></td>
                <td className="px-5 py-4 text-text-muted">{new Date(r.created_at).toLocaleDateString("en-IN")}</td>
                <td className="px-5 py-4 text-text-muted capitalize">{r.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
