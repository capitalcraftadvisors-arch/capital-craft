"use client";
import { fmtDate } from "@/lib/dates";

// Loan-lead dashboard (admin console "Lead" tab). Admin-created early-stage
// loan leads (table `loan_leads`), DISTINCT from the non-EPC marketing leads
// in the "Leads (Non-EPC)" tab. "+ Add lead" starts the 2-step onboarding;
// each row opens the lead profile. Leads that have been converted to a loan
// application (status='converted') are hidden here — they live in the Loan
// Applications tab as drafts.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import RowLink from "@/components/RowLink";
import { ACCENTS } from "@/components/AdminSidebar";
import { getToken, getBusiness } from "@/lib/auth";
import { useAdminNames } from "@/lib/use-admin-names";

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
  created_by_user_id: string | null;
  epc_business_id: string | null;
  epc_name_custom: string | null;
  status: string;
  dead_at: string | null;
  created_at: string;
  epc_business: { trade_name: string | null; legal_name: string | null; contact_name: string | null; epc_display_id: string | null } | null;
};

// Table header cell — same as the other console tables.
const TH = "px-4 py-3 font-medium text-[12px] uppercase tracking-wide";

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
  const adminNames = useAdminNames();
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState<string | null>(null);
  // Active and dead leads apart. Dead leads are deleted 30 days after being
  // marked dead (migration 0101, daily in the database).
  const [view, setView] = useState<"active" | "dead">("active");
  // The lead last opened — scrolled to and highlighted on the way back.
  const [highlightId, setHighlightId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase()
      .from("loan_leads")
      .select("id, lead_display_id, name, mobile, dob, loan_amount, project_size, project_size_unit, email, lead_owner_name, created_by, created_by_user_id, epc_business_id, epc_name_custom, status, dead_at, created_at, epc_business:epc_business_id(trade_name, legal_name, contact_name, epc_display_id)")
      .eq("status", "under_review")
      .is("aborted_at", null)
      .order("created_at", { ascending: false });
    setRows((data ?? []) as unknown as LeadRow[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  function openLead(id: string) {
    sessionStorage.setItem("leadsList.scroll", String(window.scrollY));
    sessionStorage.setItem("leadsList.lastRowId", id);
    router.push(`/admin/lead/${id}/view`);
  }
  // Back from a lead: same scroll, its tab (active / dead), the row flashing.
  useEffect(() => {
    if (loading) return;
    const y = sessionStorage.getItem("leadsList.scroll");
    const id = sessionStorage.getItem("leadsList.lastRowId");
    sessionStorage.removeItem("leadsList.scroll");
    sessionStorage.removeItem("leadsList.lastRowId");
    if (!id) return;
    if (rows.find((r) => r.id === id)?.dead_at) setView("dead");
    setHighlightId(id);
    if (y) requestAnimationFrame(() => window.scrollTo(0, Number(y) || 0));
    const t = window.setTimeout(() => setHighlightId(null), 2100);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const deadCount = useMemo(() => rows.filter((r) => r.dead_at).length, [rows]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (view === "dead") === !!r.dead_at).filter((r) => !s ||
      (r.name || "").toLowerCase().includes(s) ||
      (r.mobile || "").toLowerCase().includes(s) ||
      (r.lead_display_id || "").toLowerCase().includes(s) ||
      epcName(r).toLowerCase().includes(s),
    );
  }, [rows, q, view]);

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
      toast.error("This lead has a typed EPC name. Open the lead and assign an onboarded EPC before moving it to Loan Applications.");
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
      if (!res.ok || !data?.ok) { toast.error(data?.error || `Conversion failed (HTTP ${res.status}).`); setConverting(null); return; }
      router.push(`/admin/app/${data.application_id}/view`);
    } catch (e) {
      alert("Conversion failed: " + (e as Error).message);
      setConverting(null);
    }
  }

  return (
    <div className="w-full">
      <div className="inline-flex rounded-[8px] border bg-white p-0.5 mb-3" style={{ borderColor: ACCENTS.loanleads.tint }}>
        {([["active", "Active", rows.length - deadCount], ["dead", "Dead", deadCount]] as const).map(([key, label, n]) => (
          <button key={key} type="button" onClick={() => setView(key)}
            className={"px-3.5 py-1.5 rounded-[6px] text-[13px] font-semibold " + (view === key ? "text-white" : "text-[var(--acc)] hover:bg-[var(--acc-tint)]")}
            style={view === key ? { backgroundColor: key === "dead" ? "#b42318" : ACCENTS.loanleads.color } : undefined}>
            {label} · {n}
          </button>
        ))}
      </div>

      {/* Toolbar — same pattern as the other console tabs. */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex-1 min-w-[220px]">
          <Input placeholder="Search by name, mobile, ID or EPC…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button type="button" variant="primary" onClick={() => void addLead()} disabled={adding} className="whitespace-nowrap" style={{ backgroundColor: ACCENTS.loanleads.color }}>
          {adding ? "Creating…" : "+ Add lead"}
        </Button>
      </div>

      <div className="rounded-card border bg-white overflow-hidden cc-table-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[14px] cc-table">
            <thead>
              <tr>
                <th className={TH + " text-left"}>Borrower name</th>
                <th className={TH + " text-left"}>EPC · Lead owner</th>
                <th className={TH + " text-center"}>Project size</th>
                <th className={TH + " text-center"}>Loan amount</th>
                <th className={TH + " text-center"}>Created on</th>
                <th className={TH + " text-center"}>Created by</th>
                <th className={TH + " text-center"}>Status / Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[#5a8a76]">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[#5a8a76]">{(view === "dead" ? deadCount : rows.length - deadCount) > 0 ? "No leads match." : view === "dead" ? "No dead leads." : "No leads yet."}</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => openLead(r.id)}
                    style={{ transition: "background-color 2s ease-out", backgroundColor: highlightId === r.id ? "var(--acc-tint)" : undefined }}
                    className={"border-b border-[#f0f4f2] last:border-0 cursor-pointer " + (r.dead_at ? "bg-[#fdf0f0] hover:bg-[#fbe6e6]" : "hover:bg-[#f7f7fd]")}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#0f3d2e]">{r.name ? <RowLink href={`/admin/lead/${r.id}/view`} onOpen={() => openLead(r.id)}>{r.name}</RowLink> : "—"}</div>
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
                      {fmtDate(r.created_at)}
                    </td>
                    <td className="px-4 py-3 text-center text-[13px] text-[#5a8a76]">{r.created_by_user_id ? (adminNames.get(r.created_by_user_id) ?? "Admin") : createdByLabel(r.created_by)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        {r.dead_at ? (
                          <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[#fbe0e0] text-[#b42318] border border-[#f2c4c4]">Dead lead</span>
                        ) : (
                          <>
                            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[#e7f5ee] text-[#0f7a52] border border-[#cdeadd]">New</span>
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
                          </>
                        )}
                      </div>
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
