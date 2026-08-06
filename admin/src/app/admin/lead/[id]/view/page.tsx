"use client";

// Lead profile (admin-only). Shows the lead's details and the primary action:
// "Ready for loan application" → converts the lead into an epc_applications
// DRAFT (via the convert route) and the lead then disappears from the Lead
// dashboard. A real EPC must be assigned first (the inline dropdown lets the
// admin pick one for custom-name leads).

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
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
  status: string;
  created_at: string;
};

type EpcOpt = { value: string; label: string };

function KV({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-[#eef1f4] last:border-0">
      <span className="text-[13px] text-[#5a8a76]">{k}</span>
      <span className="text-[14px] font-medium text-[#0f3d2e] text-right">{v || "—"}</span>
    </div>
  );
}

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

  const dobDisplay = useMemo(() => {
    if (!lead?.dob) return null;
    const m = lead.dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : lead.dob;
  }, [lead?.dob]);

  const epcLabel = useMemo(() => {
    if (!lead) return "—";
    if (lead.epc_business_id) return epcs.find((e) => e.value === lead.epc_business_id)?.label ?? "(EPC)";
    return lead.epc_name_custom ? `${lead.epc_name_custom} (not in system)` : "—";
  }, [lead, epcs]);

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

  async function del() {
    if (!lead) return;
    if (!window.confirm(`Delete lead ${lead.lead_display_id ?? ""}? This cannot be undone.`)) return;
    const { error } = await supabase().from("loan_leads").delete().eq("id", lead.id);
    if (error) { alert("Couldn't delete: " + error.message); return; }
    router.push("/admin");
  }

  if (loading) return <main className="min-h-screen grid place-items-center"><p className="text-[#5a8a76]">Loading…</p></main>;
  if (!lead) return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Lead not found.</p></main>;

  const money = (v: number | null) => (v == null ? "—" : "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }));

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#dcd9f5] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center">
          <button
            type="button"
            onClick={() => { sessionStorage.setItem("adminList.tab", "loanleads"); router.push("/admin"); }}
            className="text-[14px] text-[#4338ca] hover:opacity-80 inline-flex items-center gap-1"
          >
            ← Back to Leads
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-4">
        {/* Header card */}
        <div className="rounded-[12px] border border-[#dcd9f5] bg-[#f4f3fd] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[24px] font-bold text-[#0f3d2e]">{lead.name || "(unnamed lead)"}</div>
              <div className="text-[13px] text-[#5a8a76] mt-0.5">
                <span className="font-mono text-[#4338ca]">{lead.lead_display_id || "—"}</span>
                {lead.mobile && <span> · +91 {lead.mobile}</span>}
              </div>
            </div>
            <span className="inline-flex items-center px-3 py-1.5 rounded-full text-[13px] font-semibold bg-[#fef0d6] text-[#854f0b]">Under review</span>
          </div>
        </div>

        {/* Action bar */}
        <div className="rounded-[12px] border border-[#dcd9f5] bg-white p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[13px] text-[#5a8a76]">
            When ready, move this lead into <span className="font-semibold text-[#0f3d2e]">Loan Applications</span> as a draft.
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push(`/admin/lead/${lead.id}/step-1`)} className="!px-4 !py-2 !text-[13px]">Edit</Button>
            <button
              type="button"
              onClick={() => void del()}
              className="px-4 py-2 rounded-btn text-[13px] font-semibold text-red-700 border-[1.5px] border-red-200 hover:bg-red-50"
            >
              Delete
            </button>
            <Button onClick={() => void convert()} loading={converting} variant="grad" className="!px-4 !py-2 !text-[13px]">
              Ready for loan application
            </Button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* Contact */}
          <Card className="p-5">
            <div className="text-[15px] font-bold text-[#0f3d2e] mb-2">Contact</div>
            <KV k="Name" v={lead.name} />
            <KV k="Contact no." v={lead.mobile ? `+91 ${lead.mobile}` : null} />
            <KV k="Address" v={lead.address} />
            <KV k="Date of birth" v={dobDisplay} />
            <KV k="Email" v={lead.email} />
          </Card>

          {/* Loan */}
          <Card className="p-5">
            <div className="text-[15px] font-bold text-[#0f3d2e] mb-2">Loan</div>
            <KV k="Amount required" v={money(lead.loan_amount)} />
            <KV k="Project size" v={lead.project_size != null ? `${lead.project_size} ${(lead.project_size_unit || "kw").toUpperCase()}` : null} />
            <KV k="EPC" v={epcLabel} />
          </Card>
        </div>

        {/* EPC assignment */}
        <Card className="p-5">
          <div className="text-[15px] font-bold text-[#0f3d2e] mb-2">EPC assignment</div>
          <p className="text-[12px] text-[#5a8a76] mb-3">
            A loan application needs a real EPC. Pick the EPC this lead belongs to; this is required to convert.
          </p>
          <div className="max-w-md flex items-center gap-2">
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
            <p className="mt-2 text-[12px] text-amber-700">Typed name on file: “{lead.epc_name_custom}”. Select a real EPC above to enable conversion.</p>
          )}
        </Card>
      </div>
    </main>
  );
}
