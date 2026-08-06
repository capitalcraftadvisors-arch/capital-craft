"use client";

// Loan-lead dashboard (admin console "Lead" tab). Admin-created early-stage
// loan leads (table `loan_leads`), DISTINCT from the non-EPC marketing leads
// in the "Leads (Non-EPC)" tab. "+ Add lead" starts the 2-step onboarding;
// each row opens the lead profile. Leads that have been converted to a loan
// application (status='converted') are hidden here — they live in the Loan
// Applications tab as drafts.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type LeadRow = {
  id: string;
  lead_display_id: string | null;
  name: string | null;
  mobile: string | null;
  dob: string | null;
  loan_amount: number | null;
  project_size: number | null;
  project_size_unit: string | null;
  email: string | null;
  epc_business_id: string | null;
  epc_name_custom: string | null;
  status: string;
  created_at: string;
  epc_business: { trade_name: string | null; legal_name: string | null; contact_name: string | null; epc_display_id: string | null } | null;
};

function rupees(v: number | null): string {
  if (v == null) return "—";
  return "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function epcName(r: LeadRow): string {
  const b = r.epc_business;
  if (b) return b.trade_name || b.legal_name || b.contact_name || "—";
  return r.epc_name_custom || "—";
}

export default function LoanLeadsTab() {
  const router = useRouter();
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase()
      .from("loan_leads")
      .select("id, lead_display_id, name, mobile, dob, loan_amount, project_size, project_size_unit, email, epc_business_id, epc_name_custom, status, created_at, epc_business:epc_business_id(trade_name, legal_name, contact_name, epc_display_id)")
      .eq("status", "under_review")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as unknown as LeadRow[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.name || "").toLowerCase().includes(s) ||
      (r.mobile || "").toLowerCase().includes(s) ||
      (r.lead_display_id || "").toLowerCase().includes(s) ||
      epcName(r).toLowerCase().includes(s),
    );
  }, [rows, q]);

  // "+ Add lead" — create a blank draft, then open Step 1 of the onboarding.
  async function addLead() {
    if (adding) return;
    setAdding(true);
    const { data, error } = await supabase()
      .from("loan_leads")
      .insert({ status: "draft", current_step: 1 })
      .select("id")
      .single();
    setAdding(false);
    if (error || !data) { alert("Couldn't create the lead: " + (error?.message ?? "unknown error")); return; }
    router.push(`/admin/lead/${(data as { id: string }).id}/step-1`);
  }

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-[22px] font-bold text-[#0f3d2e]">Leads</h1>
          <p className="text-[13px] text-[#5a8a76] mt-0.5">Admin-created loan leads. Mark a lead “Ready for loan application” to move it into Loan Applications.</p>
        </div>
        <button
          type="button"
          onClick={() => void addLead()}
          disabled={adding}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[14px] font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: "#4338ca" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          {adding ? "Creating…" : "Add lead"}
        </button>
      </div>

      <div className="mb-3 max-w-sm">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, mobile, ID or EPC…"
          className="w-full rounded-[8px] border border-[#dbe7e1] bg-white px-3.5 py-2.5 text-[14px] text-[#0f3d2e] outline-none focus:border-[#4338ca]"
        />
      </div>

      <div className="rounded-[12px] border border-[#e0f0e8] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[14px]">
            <thead className="bg-[#eef0fb] border-b border-[#dcd9f5] text-[#4338ca]">
              <tr>
                <th className="text-left font-semibold px-4 py-3">Lead details</th>
                <th className="text-center font-semibold px-4 py-3">EPC</th>
                <th className="text-center font-semibold px-4 py-3">Loan amount</th>
                <th className="text-center font-semibold px-4 py-3">Project size</th>
                <th className="text-center font-semibold px-4 py-3">Status</th>
                <th className="text-center font-semibold px-4 py-3">Created on</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[#5a8a76]">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[#5a8a76]">No leads yet. Click “Add lead” to create one.</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/admin/lead/${r.id}/view`)}
                    className="border-b border-[#f0f4f2] last:border-0 hover:bg-[#f7f7fd] cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#0f3d2e]">{r.name || "—"}</div>
                      <div className="text-[12px] text-[#5a8a76] flex items-center gap-2">
                        <span className="font-mono text-[#4338ca]">{r.lead_display_id || "—"}</span>
                        {r.mobile && <span>· +91 {r.mobile}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="text-[#0f3d2e]">{epcName(r)}</div>
                      {r.epc_business?.epc_display_id && <div className="text-[11px] text-[#5a8a76] font-mono">{r.epc_business.epc_display_id}</div>}
                      {!r.epc_business_id && r.epc_name_custom && <div className="text-[11px] text-amber-700">Not in system</div>}
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-[#0f3d2e]">{rupees(r.loan_amount)}</td>
                    <td className="px-4 py-3 text-center text-[#0f3d2e]">
                      {r.project_size != null ? `${r.project_size} ${(r.project_size_unit || "kw").toUpperCase()}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#fef0d6] text-[#854f0b]">Under review</span>
                    </td>
                    <td className="px-4 py-3 text-center text-[13px] text-[#5a8a76]">
                      {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
