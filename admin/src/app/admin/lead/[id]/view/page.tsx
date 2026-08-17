"use client";

// Lead profile (admin-only). Styled to MATCH the EPC / Loan-application View
// pages — same ViewKit chrome (SectionCard / KV / icons), sticky back header,
// tinted header card, and a responsive column grid.
//
// Shows: Borrower Name, Phone no, EPC Partner, Project Size, Project cost,
// Lead Owner Name, and a threaded admin-only Comments box (lead_comments,
// migration 0065). Primary action: "Ready for loan application" → converts
// the lead into an epc_applications DRAFT (needs a real EPC assigned first).
// Secondary: Abort (drops the lead off the dashboard, kept for the record).
// Delete was removed deliberately — aborting is the reversible-by-record path.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import CommentsSection from "@/components/CommentsSection";
import OwnershipCard from "@/components/OwnershipCard";
import { I, SectionCard, KV } from "@/components/view/ViewKit";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";

type Lead = {
  id: string;
  lead_display_id: string | null;
  name: string | null;
  mobile: string | null;
  address: string | null;
  dob: string | null;
  loan_amount: number | null;
  project_size: number | null;
  project_size_unit: string | null;
  email: string | null;
  epc_business_id: string | null;
  epc_name_custom: string | null;
  lead_owner_name: string | null;
  status: string;
  aborted_at: string | null;
  abort_reason: string | null;
  created_at: string;
  created_by_user_id: string | null;
  assigned_to_user_id: string | null;
};

type EpcOpt = { value: string; label: string };

export default function LeadViewPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [lead, setLead] = useState<Lead | null>(null);
  const [epcs, setEpcs] = useState<EpcOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [savingEpc, setSavingEpc] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  const [abortReason, setAbortReason] = useState("");
  const [aborting, setAborting] = useState(false);

  useEffect(() => {
    void (async () => {
      const [{ data: l }, { data: epcRows }] = await Promise.all([
        supabase().from("loan_leads").select("*").eq("id", params.id).maybeSingle(),
        supabase().from("epc_business")
          .select("id, contact_name, trade_name, legal_name")
          .neq("business_type", "admin")
          .order("trade_name", { ascending: true, nullsFirst: false }),
      ]);
      setLead((l as Lead) ?? null);
      setEpcs(((epcRows ?? []) as Array<Record<string, string | null>>).map((e) => ({
        value: e.id as string,
        label: e.trade_name || e.legal_name || e.contact_name || "(unnamed EPC)",
      })));
      setLoading(false);
    })();
  }, [params.id]);

  async function assignEpc(id: string) {
    if (!lead) return;
    setSavingEpc(true);
    const { error } = await supabase().from("loan_leads")
      .update({ epc_business_id: id || null, epc_name_custom: id ? null : lead.epc_name_custom })
      .eq("id", lead.id);
    setSavingEpc(false);
    if (error) { alert("Couldn't update EPC: " + error.message); return; }
    setLead({ ...lead, epc_business_id: id || null });
  }

  async function convert() {
    if (!lead) return;
    if (!lead.epc_business_id) { alert("Assign a real EPC (dropdown below) before converting."); return; }
    if (!window.confirm("Move this lead to Loan Applications as a new draft? It will disappear from the Lead dashboard.")) return;
    setConverting(true);
    try {
      const res = await fetch(`/api/admin/lead/${lead.id}/convert-to-loan-app`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { alert(data?.error || `Conversion failed (HTTP ${res.status}).`); setConverting(false); return; }
      router.push(`/admin/app/${data.application_id}/view`);
    } catch (e) {
      alert("Conversion failed: " + (e as Error).message);
      setConverting(false);
    }
  }

  async function doAbort() {
    if (!lead) return;
    setAborting(true);
    const { error } = await supabase().from("loan_leads")
      .update({ aborted_at: new Date().toISOString(), abort_reason: abortReason.trim() || null })
      .eq("id", lead.id);
    setAborting(false);
    if (error) { alert("Couldn't abort: " + error.message); return; }
    setAbortOpen(false);
    router.push("/admin");
  }

  if (loading) return <main className="min-h-screen grid place-items-center bg-white"><p className="text-[#5a8a76]">Loading…</p></main>;
  if (!lead) return <main className="min-h-screen grid place-items-center bg-white"><p className="text-red-700">Lead not found.</p></main>;

  const money = (v: number | null) => (v == null ? "—" : "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }));
  const sizeStr = lead.project_size != null ? `${lead.project_size} ${(lead.project_size_unit || "kw").toUpperCase()}` : "—";
  const aborted = !!lead.aborted_at;

  return (
    <main className="min-h-screen bg-white">
      {/* Sticky back-nav header */}
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center">
          <button
            type="button"
            onClick={() => { sessionStorage.setItem("adminList.tab", "loanleads"); router.push("/admin"); }}
            className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1"
          >
            ← Back to Leads
          </button>
        </div>
      </header>

      <div className="w-full px-5 sm:px-8 py-6"
        style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>

        {/* ── HEADER CARD ── */}
        <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-5 sm:p-6 mb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 rounded-[12px] bg-[#d6efe3] text-[#178a5c] grid place-items-center shrink-0"
                style={{ transform: "scale(1.3)", transformOrigin: "left center" }}>
                {I.user}
              </div>
              <div className="min-w-0">
                <div className="text-[24px] font-semibold text-[#0f3d2e] truncate">{lead.name || "(unnamed lead)"}</div>
                <div className="text-[13px] text-[#5a8a76] mt-0.5">
                  <span className="font-mono text-[#0f7a52]">{lead.lead_display_id || "—"}</span>
                  {lead.mobile && <span> · +91 {lead.mobile}</span>}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              {aborted ? (
                <span className="inline-flex items-center px-3 py-1.5 rounded-full text-[13px] font-semibold bg-red-50 text-red-700 border border-red-200">Aborted</span>
              ) : (
                <span className="inline-flex items-center px-3 py-1.5 rounded-full text-[13px] font-semibold bg-[#fef0d6] text-[#854f0b]">Under review</span>
              )}
            </div>
          </div>
        </div>

        {/* ── ABORTED BANNER ── */}
        {aborted && (
          <div className="rounded-[12px] border border-red-200 bg-red-50 p-4 mb-4">
            <div className="text-[13px] font-semibold text-red-700">This lead was aborted.</div>
            {lead.abort_reason && <div className="text-[13px] text-red-700/90 mt-1">Reason: {lead.abort_reason}</div>}
          </div>
        )}

        {/* ── ACTION BAR (hidden once aborted) ── */}
        {!aborted && (
          <div className="rounded-[12px] border border-[#cdeadd] bg-white p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[13px] text-[#5a8a76]">
              When ready, move this lead into <span className="font-semibold text-[#0f3d2e]">Loan Applications</span> as a draft.
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => router.push(`/admin/lead/${lead.id}/step-1`)} className="!px-4 !py-2 !text-[13px]">Edit</Button>
              <button
                type="button"
                onClick={() => { setAbortReason(""); setAbortOpen(true); }}
                className="px-4 py-2 rounded-btn text-[13px] font-semibold text-red-700 border-[1.5px] border-red-200 hover:bg-red-50"
              >
                Abort
              </button>
              <Button onClick={() => void convert()} loading={converting} variant="grad" className="!px-4 !py-2 !text-[13px]">
                Ready for loan application
              </Button>
            </div>
          </div>
        )}

        {/* ── COLUMN GRID ── */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* COL 1 — borrower */}
          <div className="flex flex-col gap-2.5">
            <SectionCard title="Borrower" accent="blue" icon={I.user}>
              <KV k="Borrower Name" v={lead.name} />
              <KV k="Phone no" v={lead.mobile ? `+91 ${lead.mobile}` : "—"} />
              <KV k="Email" v={lead.email} valueClass="text-[#185fa5]" />
            </SectionCard>
          </div>

          {/* COL 2 — project / loan + EPC assignment */}
          <div className="flex flex-col gap-2.5">
            <SectionCard title="Project & loan" accent="blue" icon={I.money}>
              <KV k="Project Size" v={sizeStr} />
              <KV k="Project cost" v={money(lead.loan_amount)} />
              <KV k="Lead Owner Name" v={lead.lead_owner_name} />
            </SectionCard>

            {!aborted && (
              <SectionCard title="EPC assignment" accent="green" icon={I.building}>
                <p className="text-[12px] text-[#5a8a76] mb-3">
                  A loan application needs a real EPC. Pick the EPC this lead belongs to — required to convert.
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Select
                      placeholder="Select an EPC"
                      options={epcs}
                      value={lead.epc_business_id ?? ""}
                      onChange={(e) => void assignEpc(e.target.value)}
                      disabled={savingEpc}
                    />
                  </div>
                  {savingEpc && <span className="text-[12px] text-[#5a8a76]">Saving…</span>}
                </div>
                {!lead.epc_business_id && lead.epc_name_custom && (
                  <p className="mt-2 text-[12px] text-amber-700">Typed name on file: “{lead.epc_name_custom}”. Select a real EPC to enable conversion.</p>
                )}
              </SectionCard>
            )}
          </div>

          {/* COL 3 — ownership + comments */}
          <div className="flex flex-col gap-2.5">
            <OwnershipCard
              module="loanleads"
              recordId={lead.id}
              createdByUserId={lead.created_by_user_id}
              assignedToUserId={lead.assigned_to_user_id}
            />
            <SectionCard title="Comments" tint icon={I.lock} adminOnly>
              <CommentsSection leadId={lead.id} />
            </SectionCard>
          </div>
        </div>
      </div>

      {/* ── ABORT MODAL ── */}
      {abortOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={() => !aborting && setAbortOpen(false)}>
          <div className="w-full max-w-md rounded-[12px] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[16px] font-semibold text-[#0f3d2e]">Abort this lead?</div>
            <p className="text-[13px] text-[#5a8a76] mt-1">
              It will drop off the Lead dashboard but stay on record. Add a reason (optional).
            </p>
            <textarea
              value={abortReason}
              onChange={(e) => setAbortReason(e.target.value)}
              rows={3}
              placeholder="Reason for aborting…"
              className="mt-3 w-full border border-[#cdeadd] rounded-input px-3 py-2 text-[13px] bg-white focus:border-[#185fa5] outline-none resize-none"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setAbortOpen(false)}
                disabled={aborting}
                className="px-4 py-2 rounded-btn text-[13px] font-semibold text-[#5a8a76] border-[1.5px] border-[#cdeadd] hover:bg-[#f0faf5] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void doAbort()}
                disabled={aborting}
                className="px-4 py-2 rounded-btn text-[13px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
              >
                {aborting ? "Aborting…" : "Abort lead"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
