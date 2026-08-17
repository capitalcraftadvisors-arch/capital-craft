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
import { getToken, getBusiness } from "@/lib/auth";

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
  lead_owner_name: string | null;
  created_by: string | null;
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
function createdByLabel(v: string | null): string {
  if (!v) return "—";
  return v === "admin" ? "Admin" : v;
}

export default function LoanLeadsTab() {
  const router = useRouter();
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase()
      .from("loan_leads")
      .select("id, lead_display_id, name, mobile, dob, loan_amount, project_size, project_size_unit, email, lead_owner_name, created_by, epc_business_id, epc_name_custom, status, created_at, epc_business:epc_business_id(trade_name, legal_name, contact_name, epc_display_id)")
      .eq("status", "under_review")
      .is("aborted_at", null)
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
    const meId = getBusiness()?.id ?? null;
    const { data, error } = await supabase()
      .from("loan_leads")
      // Hierarchy (0066): stamp the admin/ops user who created this lead as
      // both creator and initial owner.
      .insert({ status: "draft", current_step: 1, created_by_user_id: meId, assigned_to_user_id: meId, last_updated_by_user_id: meId })
      .select("id")
      .single();
    setAdding(false);
    if (error || !data) { alert("Couldn't create the lead: " + (error?.message ?? "unknown error")); return; }
    router.push(`/admin/lead/${(data as { id: string }).id}/step-1`);
  }

  // "Ready for Loan" — convert the lead into a loan-application draft. Needs a
  // real (onboarded) EPC; custom-name leads must pick one on the profile first.
  async function readyForLoan(r: LeadRow) {
    if (converting) return;
    if (!r.epc_business_id) {
      alert("This lead has a typed EPC name. Open the lead and assign an onboarded EPC before moving it to Loan Applications.");
      router.push(`/admin/lead/${r.id}/view`);
      return;
    }
    if (!window.confirm(`Move "${r.name || "this lead"}" to Loan Applications as a new draft? It will disappear from Leads.`)) return;
    setConverting(r.id);
    try {
      const res = await fetch(`/api/admin/lead/${r.id}/convert-to-loan-app`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { alert(data?.error || `Conversion failed (HTTP ${res.status}).`); setConverting(null); return; }
      router.push(`/admin/app/${data.application_id}/view`);
    } catch (e) {
      alert("Conversion failed: " + (e as Error).message);
      setConverting(null);
    }
  }

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        {/* Heading comes from the page shell's section header ("Leads"). */}
        <p className="text-[13px] text-[#5a8a76]">Admin-created loan leads. Mark a lead “Ready for loan application” to move it into Loan Applications.</p>
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
                <th className="text-left font-semibold px-4 py-3">Borrower name</th>
                <th className="text-left font-semibold px-4 py-3">EPC · Lead owner</th>
                <th className="text-center font-semibold px-4 py-3">Project size</th>
                <th className="text-center font-semibold px-4 py-3">Loan amount</th>
                <th className="text-center font-semibold px-4 py-3">Created on</th>
                <th className="text-center font-semibold px-4 py-3">Created by</th>
                <th className="text-center font-semibold px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[#5a8a76]">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[#5a8a76]">No leads yet. Click “Add lead” to create one.</td></tr>
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
                    <td className="px-4 py-3">
                      <div className="text-[#0f3d2e]">{epcName(r)}</div>
                      {r.lead_owner_name
                        ? <div className="text-[12px] text-[#5a8a76]">Owner: {r.lead_owner_name}</div>
                        : <div className="text-[12px] text-[#b6bfc9]">Owner: —</div>}
                      {!r.epc_business_id && r.epc_name_custom && <div className="text-[11px] text-amber-700">Not onboarded</div>}
                    </td>
                    <td className="px-4 py-3 text-center text-[#0f3d2e]">
                      {r.project_size != null ? `${r.project_size} ${(r.project_size_unit || "kw").toUpperCase()}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-[#0f3d2e]">{rupees(r.loan_amount)}</td>
                    <td className="px-4 py-3 text-center text-[13px] text-[#5a8a76]">
                      {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3 text-center text-[13px] text-[#5a8a76]">{createdByLabel(r.created_by)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void readyForLoan(r); }}
                        disabled={converting === r.id}
                        className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
                        style={{ backgroundColor: "#178a5c" }}
                        title="Move this lead to Loan Applications"
                      >
                        {converting === r.id ? "Moving…" : "Ready for Loan"}
                      </button>
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
