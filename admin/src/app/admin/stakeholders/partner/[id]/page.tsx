"use client";

// Partner profile — /admin/stakeholders/partner/[id] (main admin only): a
// lender's or insurance partner's details (partners, 0106), their work with us
// in the portal (counted only — files sent / decided for a lender, policies for
// an insurer) and their documents (lender policy, agreement …).

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import StakeholderShell from "@/components/StakeholderShell";
import StakeholderDetails, { FieldInput } from "@/components/StakeholderDetails";
import StakeholderDocs from "@/components/StakeholderDocs";
import { I, Section, StatCards } from "@/components/view/ViewKit";
import { supabase } from "@/lib/supabase";
import { getPartner, PARTNER_SPEC, savePartner, type Details, type Partner } from "@/lib/stakeholders";

export default function PartnerProfilePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type Stat = { label: string; value: string };

// A lender's files through the portal (loan_application_lenders, by lender_key).
async function lenderStats(key: string): Promise<Stat[]> {
  const n = async (col: string) => {
    const { count } = await supabase().from("loan_application_lenders")
      .select("id", { count: "exact", head: true }).eq("lender_key", key).not(col, "is", null);
    return String(count ?? 0);
  };
  const [sent, approved, rejected] = await Promise.all([n("docs_sent_at"), n("approved_at"), n("rejected_at")]);
  return [{ label: "Files sent", value: sent }, { label: "Approved", value: approved }, { label: "Rejected", value: rejected }];
}

// An insurer's cases — insurance_partner is free text ("SBI", "SBI General …"),
// so cases are matched on the partner name's first word.
async function insurerStats(name: string): Promise<Stat[]> {
  const word = name.trim().split(/\s+/)[0] ?? "";
  if (!word) return [];
  const n = async (issued: boolean) => {
    let q = supabase().from("insurance_applications").select("id", { count: "exact", head: true }).ilike("insurance_partner", `${word}%`);
    if (issued) q = q.eq("status", "issued");
    const { count } = await q;
    return String(count ?? 0);
  };
  const [all, issued] = await Promise.all([n(false), n(true)]);
  return [{ label: "Insurance cases", value: all }, { label: "Policies issued", value: issued }];
}

function Inner() {
  const { id } = useParams<{ id: string }>();
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined);
  const [stats, setStats] = useState<Stat[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Details>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const p = await getPartner(id);
      setPartner(p);
      if (!p) return;
      setStats(p.kind === "lender" ? (p.lender_key ? await lenderStats(p.lender_key) : []) : await insurerStats(p.name));
    })();
  }, [id]);

  function startEdit() { if (!partner) return; setName(partner.name); setDraft(partner.details); setError(null); setEditing(true); }

  async function save() {
    if (!partner) return;
    if (!name.trim()) { setError("Enter the name."); return; }
    setBusy(true); setError(null);
    const e = await savePartner(partner.id, name, draft);
    setBusy(false);
    if (e) { setError(e); return; }
    setPartner({ ...partner, name: name.trim(), details: draft });
    setEditing(false);
  }

  const back = "/admin/stakeholders?tab=partners";
  if (partner === undefined) return <StakeholderShell title="Loading…" back={back}><span /></StakeholderShell>;
  if (partner === null) return <StakeholderShell title="Not found" back={back}><p className="text-[13px] text-text-muted">This partner wasn&apos;t found.</p></StakeholderShell>;

  const spec = PARTNER_SPEC[partner.kind];
  const actions = editing ? (
    <>
      <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 rounded-[8px] border border-line text-[13px] text-text-mid hover:bg-bg-soft">Cancel</button>
      <button type="button" onClick={() => void save()} disabled={busy} className="px-4 py-2 rounded-[8px] bg-[#178a5c] text-white text-[13px] font-semibold hover:bg-[#12734c] disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
    </>
  ) : (
    <button type="button" onClick={startEdit} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] border border-[#cdeadd] bg-[#f4fbf7] text-[13px] font-semibold text-[#178a5c] hover:bg-[#e9f6ef]">{I.edit} Edit</button>
  );

  return (
    <StakeholderShell
      back={back}
      title={partner.name}
      sub={[spec.label, partner.details.lender_type, partner.details.rm_name].filter(Boolean).join("  ·  ")}
      actions={actions}
    >
      {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
      {stats && stats.length > 0 && <div className="mb-4"><StatCards items={stats} /></div>}
      <div className="grid gap-4 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          {editing && (
            <Section card white icon={I.building} title="Name">
              <FieldInput f={{ key: "name", label: "Name" }} value={name} onChange={setName} />
            </Section>
          )}
          <StakeholderDetails
            groups={spec.groups}
            values={editing ? draft : partner.details}
            editing={editing}
            onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
          />
        </div>
        <StakeholderDocs owner={{ partner_id: partner.id }} slots={spec.docs} />
      </div>
    </StakeholderShell>
  );
}
