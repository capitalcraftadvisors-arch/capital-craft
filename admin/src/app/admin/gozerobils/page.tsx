"use client";

// gozerobils Leads — /admin/gozerobils (main admin only).
//
// Solar enquiries from the gozerobils.com form (gozerobils_leads, migration
// 0123), saved by POST /api/gozerobils/leads. One query on open, cached like
// the other lists; a status change updates its row locally (no refetch).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar, { ACCENTS, SectionMark, themeStyle } from "@/components/AdminSidebar";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { getCached, setCached, invalidate } from "@/lib/list-cache";
import { fmtDateTime } from "@/lib/dates";
import { waUrl } from "@/lib/wa-link";
import { LEAD_STATUS_OPTIONS, LEAD_STATUS_PILL } from "@/lib/lead-status";

type Lead = {
  id: string; created_at: string;
  name: string | null; mobile: string;
  pincode: string | null; city: string | null; state: string | null;
  monthly_bill: string | null; looking_for: string | null; timeline: string | null;
  utm_source: string | null; utm_campaign: string | null;
  status: string;
};

const CK = "dash.gzb";
const th = "px-3 py-3 font-medium text-[12px] uppercase tracking-wide";

export default function GozerobilsLeadsPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const allowed = isMainAdmin(getBusiness());
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) { router.replace("/admin"); return; }
    void (async () => {
      const cached = getCached<Lead[]>(CK, 45000);
      if (cached) { setRows(cached); return; }
      const { data, error: e } = await supabase()
        .from("gozerobils_leads")
        .select("id, created_at, name, mobile, pincode, city, state, monthly_bill, looking_for, timeline, utm_source, utm_campaign, status")
        .order("created_at", { ascending: false });
      const list = (data ?? []) as Lead[];
      setError(e ? e.message : null);
      setRows(list);
      if (!e) setCached(CK, list);
    })();
  }, [allowed, router]);

  async function setStatus(r: Lead, status: string) {
    setBusy(r.id);
    const { error: e } = await supabase().from("gozerobils_leads").update({ status }).eq("id", r.id);
    if (e) alert("Couldn't update status: " + e.message);
    else { setRows((rs) => (rs ?? []).map((x) => (x.id === r.id ? { ...x, status } : x))); invalidate(CK); }
    setBusy(null);
  }

  if (!allowed) return null;

  const needle = q.trim().toLowerCase();
  const filtered = (rows ?? []).filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (!needle) return true;
    return [r.name, r.mobile, r.city, r.pincode].some((v) => (v ?? "").toLowerCase().includes(needle));
  });

  return (
    <div className="min-h-screen lg:flex" style={themeStyle("gzb")}>
      <AdminSidebar active="gzb" />
      <div className="flex-1 min-w-0">
        <header className="px-4 sm:px-6 py-4 border-b border-line">
          <div className="flex items-center gap-3">
            <SectionMark k="gzb" />
            <h1 className="font-display text-[22px] sm:text-[26px] font-bold" style={{ color: ACCENTS.gzb.color }}>
              {ACCENTS.gzb.label}
            </h1>
          </div>
        </header>
        <main className="px-4 sm:px-6 py-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="flex-1 min-w-[220px]">
              <Input placeholder="Search by name, mobile, city or pincode…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="w-[170px]">
              <Select placeholder="Status" options={LEAD_STATUS_OPTIONS} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
            </div>
          </div>
          {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
          <Card className="overflow-x-auto cc-table-card">
            <table className="w-full text-[14px] cc-table">
              <thead className="text-left">
                <tr>
                  <th className={th}>Customer</th>
                  <th className={th}>Monthly bill</th>
                  <th className={th}>Looking for</th>
                  <th className={th}>Timeline</th>
                  <th className={th}>Source</th>
                  <th className={th + " text-center"}>Received</th>
                  <th className={th + " text-center"}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-[#5a8a76]">{!rows ? "Loading…" : rows.length ? "No leads match." : "No leads yet."}</td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="border-b border-[#eaf3ee] hover:bg-[#f7fcfa] align-top">
                    <td className="px-3 py-3">
                      <p className="text-[15px] font-semibold text-[#0f3d2e]">{r.name || "—"}</p>
                      <p className="text-[12px] mt-0.5">
                        <a href={waUrl(r.mobile, "")} target="_blank" rel="noreferrer" className="text-[#185fa5] hover:underline">+91 {r.mobile}</a>
                      </p>
                      <p className="text-[12px] text-[#5a8a76]">{[r.city, r.pincode, r.state].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-[#0f3d2e]">{r.monthly_bill || "—"}</td>
                    <td className="px-3 py-3 text-[13px] text-[#0f3d2e]">{r.looking_for || "—"}</td>
                    <td className="px-3 py-3 text-[13px] text-[#0f3d2e]">{r.timeline || "—"}</td>
                    <td className="px-3 py-3 text-[13px] text-[#0f3d2e]">
                      <div>{r.utm_source || "—"}</div>
                      {r.utm_campaign && <div className="text-[12px] text-[#5a8a76]">{r.utm_campaign}</div>}
                    </td>
                    <td className="px-3 py-3 text-center text-[13px] text-[#0f3d2e] whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td className="px-3 py-3 text-center">
                      <select
                        disabled={busy === r.id}
                        value={r.status}
                        onChange={(e) => void setStatus(r, e.target.value)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border-none cursor-pointer outline-none ${LEAD_STATUS_PILL[r.status] ?? LEAD_STATUS_PILL.new}`}
                      >
                        {LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </main>
      </div>
    </div>
  );
}
