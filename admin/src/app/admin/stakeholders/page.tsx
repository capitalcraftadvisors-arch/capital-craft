"use client";

// Stakeholders — /admin/stakeholders (main admin only).
//   Team      the CC team's logins: email each member's login password
//             (migration 0094); a name opens that member's profile.
//   Partners  lenders + insurance partners (0106); add one, open its profile.
// EPC passwords are generated from each EPC profile's ⋮ menu.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import SetPasswordModal from "@/components/SetPasswordModal";
import StakeholderShell from "@/components/StakeholderShell";
import { FieldInput } from "@/components/StakeholderDetails";
import { supabase } from "@/lib/supabase";
import { loginPasswordStatus } from "@/lib/passwords";
import { fmtDate } from "@/lib/dates";
import {
  createPartner, listPartners, PARTNER_SPEC, roleLabel,
  type Details, type FieldSpec, type Partner, type PartnerKind, type TeamMember,
} from "@/lib/stakeholders";

export default function StakeholdersPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type Tab = "team" | "partners";
const th = "px-4 py-2.5 font-semibold text-left whitespace-nowrap";
const td = "px-4 py-2.5 text-text";

function Inner() {
  const [tab, setTab] = useState<Tab>("team");
  // The open tab lives in the URL, so Back from a profile lands on it.
  useEffect(() => { if (new URLSearchParams(window.location.search).get("tab") === "partners") setTab("partners"); }, []);
  function pick(t: Tab) {
    setTab(t);
    window.history.replaceState(null, "", t === "team" ? "/admin/stakeholders" : "/admin/stakeholders?tab=partners");
  }
  return (
    <StakeholderShell title="Stakeholders">
      <div role="tablist" className="inline-flex gap-1 p-1 mb-4 rounded-[10px] bg-white border border-line">
        {(["team", "partners"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => pick(t)}
            className={["px-4 py-1.5 rounded-[8px] text-[13px] font-semibold", tab === t ? "bg-[#178a5c] text-white" : "text-text-mid hover:bg-bg-tint"].join(" ")}>
            {t === "team" ? "Team" : "Partners"}
          </button>
        ))}
      </div>
      {tab === "team" ? <TeamTab /> : <PartnersTab />}
    </StakeholderShell>
  );
}

function TeamTab() {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [pwSet, setPwSet] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState<TeamMember | null>(null);

  useEffect(() => {
    void (async () => {
      // team_accounts() (0096) lists the CC team without owner accounts.
      const { data } = await supabase().rpc("team_accounts");
      const list = (data ?? []) as TeamMember[];
      setMembers(list);
      setPwSet(await loginPasswordStatus(list.map((m) => m.id)));
    })();
  }, []);

  async function closeModal() {
    setEditing(null);
    if (members) setPwSet(await loginPasswordStatus(members.map((m) => m.id)));
  }

  return (
    <section className="bg-white border border-line rounded-xl overflow-x-auto">
      {!members ? (
        <p className="px-4 py-6 text-[13px] text-text-muted">Loading…</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-text-muted">
              <th className={th}>Name</th><th className={th}>Mobile</th><th className={th}>Email</th><th className={th}>Role</th><th className={th}>Password</th><th className={th} />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const at = pwSet.get(m.id);
              return (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <a href={`/admin/stakeholders/team/${m.id}`} className="font-semibold text-[#185fa5] hover:underline">{m.contact_name || "—"}</a>
                  </td>
                  <td className={td}>{m.contact_mobile || "—"}</td>
                  <td className={td}>{m.contact_email || "—"}</td>
                  <td className={td}>{roleLabel(m.role)}</td>
                  <td className="px-4 py-2.5">
                    {at
                      ? <span className="text-[#178a5c] font-semibold">Set on {fmtDate(at)}</span>
                      : <span className="text-[#854f0b] font-semibold">Not set</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => setEditing(m)}
                      className="text-[12px] font-semibold px-3 py-1.5 rounded border border-line text-text hover:bg-bg-tint">
                      Login password
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {editing && (
        <SetPasswordModal
          open
          account={{ id: editing.id, name: editing.contact_name || "Team member", mobile: editing.contact_mobile, email: editing.contact_email }}
          onClose={() => void closeModal()}
        />
      )}
    </section>
  );
}

function PartnersTab() {
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [adding, setAdding] = useState<PartnerKind | null>(null);
  useEffect(() => { void listPartners().then(setPartners); }, []);

  const table = (kind: PartnerKind, title: string) => {
    const rows = (partners ?? []).filter((p) => p.kind === kind);
    return (
      <section className="bg-white border border-line rounded-xl overflow-x-auto">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
          <h2 className="text-[15px] font-semibold text-[#178a5c]">{title}</h2>
          <button type="button" onClick={() => setAdding(kind)}
            className="text-[12.5px] font-semibold px-3 py-1.5 rounded-[8px] bg-[#178a5c] text-white hover:bg-[#12734c]">
            ＋ Add {PARTNER_SPEC[kind].label.toLowerCase()}
          </button>
        </div>
        {!partners ? (
          <p className="px-4 py-6 text-[13px] text-text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-text-muted">None yet</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-text-muted">
                <th className={th}>Name</th><th className={th}>Contact person</th><th className={th}>Phone</th><th className={th}>Email</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <a href={`/admin/stakeholders/partner/${p.id}`} className="font-semibold text-[#185fa5] hover:underline">{p.name}</a>
                  </td>
                  <td className={td}>{p.details.rm_name || "—"}</td>
                  <td className={td}>{p.details.rm_phone || "—"}</td>
                  <td className={td}>{p.details.files_email || p.details.rm_email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-4">
      {table("lender", "Lenders")}
      {table("insurance", "Insurance partners")}
      {adding && <AddPartnerModal kind={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

// The first details to add a partner with; the rest is filled on its profile.
const ADD_FIELDS: FieldSpec[] = [
  { key: "rm_name", label: "Relationship manager" },
  { key: "rm_phone", label: "RM phone", type: "tel" },
  { key: "rm_email", label: "RM email", type: "email" },
];

function AddPartnerModal({ kind, onClose }: { kind: PartnerKind; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [details, setDetails] = useState<Details>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = PARTNER_SPEC[kind].label;

  async function save() {
    if (!name.trim()) { setError("Enter the name."); return; }
    setBusy(true); setError(null);
    const r = await createPartner(kind, name, details);
    setBusy(false);
    if (r.error || !r.id) { setError(r.error || "Couldn't add."); return; }
    router.push(`/admin/stakeholders/partner/${r.id}` as never);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white rounded-xl shadow-lg p-6 space-y-3">
        <h3 className="text-[17px] font-semibold text-[#0f3d2e]">Add {label.toLowerCase()}</h3>
        <FieldInput f={{ key: "name", label: "Name" }} value={name} onChange={setName} />
        {ADD_FIELDS.map((f) => (
          <FieldInput key={f.key} f={f} value={details[f.key] ?? ""} onChange={(v) => setDetails((d) => ({ ...d, [f.key]: v }))} />
        ))}
        {error && <p className="text-[12px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-[8px] border border-line text-[13px] text-text-mid hover:bg-bg-soft">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy}
            className="px-4 py-2 rounded-[8px] bg-[#178a5c] text-white text-[13px] font-semibold hover:bg-[#12734c] disabled:opacity-60">
            {busy ? "Adding…" : `Add ${label.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
