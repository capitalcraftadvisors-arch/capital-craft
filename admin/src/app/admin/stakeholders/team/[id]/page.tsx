"use client";

// Team member profile — /admin/stakeholders/team/[id] (main admin only): the
// login (name, mobile, email, role, password), their work in the portal (what's
// assigned to them — counted only, nothing listed), the profile details
// (team_profiles, 0106) and their documents.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import SetPasswordModal from "@/components/SetPasswordModal";
import StakeholderShell from "@/components/StakeholderShell";
import StakeholderDetails, { inputCls } from "@/components/StakeholderDetails";
import StakeholderDocs from "@/components/StakeholderDocs";
import { I, KV, Section, StatCards } from "@/components/view/ViewKit";
import { supabase } from "@/lib/supabase";
import { loginPasswordStatus } from "@/lib/passwords";
import { fmtDate } from "@/lib/dates";
import { EMAIL_RE } from "@/lib/validators";
import { getTeamDetails, roleLabel, saveTeamDetails, TEAM_DOCS, TEAM_GROUPS, type Details, type TeamMember } from "@/lib/stakeholders";

export default function TeamProfilePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type Counts = { epcs: number; loansCreated: number; loansAssigned: number; insurance: number; leads: number };

async function countWhere(table: string, col: string, id: string): Promise<number> {
  const { count } = await supabase().from(table).select("id", { count: "exact", head: true }).eq(col, id);
  return count ?? 0;
}

function Inner() {
  const { id } = useParams<{ id: string }>();
  const [member, setMember] = useState<TeamMember | null | undefined>(undefined);
  const [details, setDetails] = useState<Details>({});
  const [pwAt, setPwAt] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Details>({});
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().from("epc_business")
        .select("id, contact_name, contact_mobile, contact_email, role").eq("id", id).eq("business_type", "admin").maybeSingle();
      setMember((data as TeamMember | null) ?? null);
      if (!data) return;
      const [d, pw, epcs, loansCreated, loansAssigned, insurance, leads] = await Promise.all([
        getTeamDetails(id),
        loginPasswordStatus([id]),
        countWhere("epc_business", "assigned_to_user_id", id),
        countWhere("epc_applications", "created_by_user_id", id),
        countWhere("epc_applications", "assigned_to_user_id", id),
        countWhere("insurance_applications", "assigned_to_user_id", id),
        countWhere("loan_leads", "assigned_to_user_id", id),
      ]);
      setDetails(d);
      setPwAt(pw.get(id) ?? null);
      setCounts({ epcs, loansCreated, loansAssigned, insurance, leads });
    })();
  }, [id]);

  function startEdit() { setDraft(details); setEmail(member?.contact_email ?? ""); setError(null); setEditing(true); }

  async function save() {
    if (!member) return;
    const mail = email.trim();
    if (mail && !EMAIL_RE.test(mail)) { setError("Enter a valid email address."); return; }
    setBusy(true); setError(null);
    if (mail !== (member.contact_email ?? "")) {
      const { error: e } = await supabase().from("epc_business").update({ contact_email: mail || null }).eq("id", member.id);
      if (e) { setBusy(false); setError(e.message); return; }
      setMember({ ...member, contact_email: mail || null });
    }
    const e2 = await saveTeamDetails(member.id, draft);
    setBusy(false);
    if (e2) { setError(e2); return; }
    setDetails(draft);
    setEditing(false);
  }

  async function closePw() {
    setPwOpen(false);
    setPwAt((await loginPasswordStatus([id])).get(id) ?? null);
  }

  if (member === undefined) return <StakeholderShell title="Loading…" back="/admin/stakeholders"><span /></StakeholderShell>;
  if (member === null) return <StakeholderShell title="Not found" back="/admin/stakeholders"><p className="text-[13px] text-text-muted">This team member wasn&apos;t found.</p></StakeholderShell>;

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
      back="/admin/stakeholders"
      title={member.contact_name || "Team member"}
      sub={[roleLabel(member.role), details.designation].filter(Boolean).join("  ·  ")}
      actions={actions}
    >
      {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
      {counts && (
        <div className="mb-4">
          <StatCards items={[
            { label: "EPCs assigned", value: String(counts.epcs) },
            { label: "Loans assigned", value: String(counts.loansAssigned), sub: `${counts.loansCreated} created` },
            { label: "Insurance assigned", value: String(counts.insurance) },
            { label: "Leads assigned", value: String(counts.leads) },
          ]} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <Section card white icon={I.user} title="Login">
            <KV k="Name" v={member.contact_name} />
            <KV k="Mobile" v={member.contact_mobile} copy={member.contact_mobile} />
            {editing ? (
              <label className="block py-1.5">
                <span className="block mb-1 text-[12.5px] text-[#5a8a76]">Email</span>
                <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            ) : (
              <KV k="Email" v={member.contact_email} valueClass="text-[#185fa5]" copy={member.contact_email} />
            )}
            <KV k="Role" v={roleLabel(member.role)} />
            <div className="flex justify-between items-center text-[14px] py-[5px] gap-3">
              <span className="text-[#5a8a76]">Password</span>
              <span className="flex items-center gap-2">
                {pwAt
                  ? <span className="font-medium text-[#178a5c]">Set on {fmtDate(pwAt)}</span>
                  : <span className="font-medium text-[#854f0b]">Not set</span>}
                <button type="button" onClick={() => setPwOpen(true)} className="text-[12px] font-semibold px-2.5 py-1 rounded border border-line text-text hover:bg-bg-tint">Login password</button>
              </span>
            </div>
          </Section>
          <StakeholderDetails
            groups={TEAM_GROUPS}
            values={editing ? draft : details}
            editing={editing}
            onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
          />
        </div>
        <StakeholderDocs owner={{ team_id: member.id }} slots={TEAM_DOCS} />
      </div>
      {pwOpen && (
        <SetPasswordModal
          open
          account={{ id: member.id, name: member.contact_name || "Team member", mobile: member.contact_mobile, email: member.contact_email }}
          onClose={() => void closePw()}
        />
      )}
    </StakeholderShell>
  );
}
