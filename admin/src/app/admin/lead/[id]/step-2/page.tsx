"use client";

// Lead onboarding — Step 2 of 2 (loan details + EPC). Admin-only. On submit
// the lead becomes status='under_review' and appears in the Lead dashboard.
// The EPC is a dropdown of existing EPCs; if none match, the admin can type a
// name (recorded as free text — a real EPC must be picked later to convert).

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { supabase } from "@/lib/supabase";

const CUSTOM = "__custom__";

type EpcOpt = { id: string; label: string };

export default function LeadStep2Page() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [displayId, setDisplayId] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [projectSize, setProjectSize] = useState("");
  const [projectUnit, setProjectUnit] = useState("kw");
  const [email, setEmail] = useState("");
  const [epcId, setEpcId] = useState("");        // real EPC id, "__custom__", or ""
  const [epcCustom, setEpcCustom] = useState("");
  const [epcs, setEpcs] = useState<EpcOpt[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [{ data: lead }, { data: epcRows }] = await Promise.all([
        supabase().from("loan_leads")
          .select("lead_display_id, loan_amount, project_size, project_size_unit, email, epc_business_id, epc_name_custom")
          .eq("id", params.id).maybeSingle(),
        supabase().from("epc_business")
          .select("id, epc_display_id, contact_name, trade_name, legal_name")
          .neq("business_type", "admin")
          .order("trade_name", { ascending: true, nullsFirst: false })
          .order("legal_name", { ascending: true, nullsFirst: false }),
      ]);
      const opts = ((epcRows ?? []) as Array<Record<string, string | null>>).map((e) => ({
        id: e.id as string,
        label: e.trade_name || e.legal_name || e.contact_name || "(unnamed EPC)",
      }));
      setEpcs(opts);
      if (lead) {
        const d = lead as Record<string, string | number | null>;
        setDisplayId((d.lead_display_id as string) ?? "");
        setLoanAmount(d.loan_amount != null ? String(d.loan_amount) : "");
        setProjectSize(d.project_size != null ? String(d.project_size) : "");
        setProjectUnit((d.project_size_unit as string) || "kw");
        setEmail((d.email as string) ?? "");
        if (d.epc_business_id) setEpcId(d.epc_business_id as string);
        else if (d.epc_name_custom) { setEpcId(CUSTOM); setEpcCustom(d.epc_name_custom as string); }
      }
      setLoading(false);
    })();
  }, [params.id]);

  const epcOptions = useMemo(
    () => [...epcs.map((e) => ({ value: e.id, label: e.label })), { value: CUSTOM, label: "Can’t find it — type a name" }],
    [epcs],
  );

  async function submit() {
    setErr(null);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr("Enter a valid email or leave it blank."); return; }
    if (!epcId) { setErr("Select the EPC (or choose “type a name”)."); return; }
    if (epcId === CUSTOM && !epcCustom.trim()) { setErr("Type the EPC name."); return; }
    setSaving(true);
    const { error } = await supabase()
      .from("loan_leads")
      .update({
        loan_amount: loanAmount ? Number(loanAmount) : null,
        project_size: projectSize ? Number(projectSize) : null,
        project_size_unit: projectUnit,
        email: email.trim() || null,
        epc_business_id: epcId === CUSTOM ? null : epcId,
        epc_name_custom: epcId === CUSTOM ? epcCustom.trim() : null,
        status: "under_review",
        current_step: 2,
      })
      .eq("id", params.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    router.push(`/admin/lead/${params.id}/view`);
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-text-muted">Loading…</p></main>;
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center">
          <button
            type="button"
            onClick={() => router.push(`/admin/lead/${params.id}/step-1`)}
            className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#4338ca] hover:opacity-80"
          >
            ← Back to Step 1
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-[#4338ca]">
            Step 2 of 2 {displayId && <span className="text-text-muted">· {displayId}</span>}
          </div>
          <h1 className="font-display text-[26px] sm:text-[30px] font-bold text-[#0f3d2e] mt-1">
            New lead — loan details
          </h1>
        </div>

        <Card className="p-6 space-y-4">
          <Input
            label="Amount required for loan (₹)"
            placeholder="e.g. 500000"
            inputMode="numeric"
            value={loanAmount}
            onChange={(e) => setLoanAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
          <div className="grid grid-cols-[1fr_120px] gap-3 items-end">
            <Input
              label="Project size expected"
              placeholder="e.g. 5"
              inputMode="numeric"
              value={projectSize}
              onChange={(e) => setProjectSize(e.target.value.replace(/[^\d.]/g, ""))}
            />
            <Select
              label="Unit"
              options={[{ value: "kw", label: "kW" }, { value: "mw", label: "MW" }]}
              value={projectUnit}
              onChange={(e) => setProjectUnit(e.target.value)}
            />
          </div>
          <Input label="Email ID" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select
            label="EPC name"
            placeholder="Select an EPC"
            options={epcOptions}
            value={epcId}
            onChange={(e) => setEpcId(e.target.value)}
          />
          {epcId === CUSTOM && (
            <Input
              label="EPC name (not in system)"
              placeholder="Type the EPC's name"
              value={epcCustom}
              onChange={(e) => setEpcCustom(e.target.value)}
              hint="Recorded as text. Pick a real EPC on the lead profile before converting to a loan application."
            />
          )}
        </Card>

        {err && <p className="text-[13px] text-red-600">{err}</p>}

        <div className="flex justify-end">
          <Button onClick={() => void submit()} loading={saving} variant="grad">Submit lead</Button>
        </div>
      </div>
    </main>
  );
}
