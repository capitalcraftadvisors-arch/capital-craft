"use client";

// Settings → Users & roles — the company's logins (Zoho-style). The owner (the
// KYC contact) is always there; it — or an admin, for Sales / Viewer — adds
// staff with a role and the modules they use, resets passwords and switches
// logins off. A new password is shown once here (copy it, or send it by email /
// WhatsApp) and must be changed at the first login; only the CC main admin can read
// it back (Stakeholders → EPCs, 0142).

import { useEffect, useState } from "react";
import { Card, Row } from "@/components/partner/SettingsKit";
import { NAVY } from "@/components/partner/PartnerShell";
import { input, Toggle } from "@/components/quotation/form-kit";
import NewPasswordBox from "@/components/NewPasswordBox";
import { getBusiness } from "@/lib/auth";
import { fetchKyc } from "@/lib/org-settings";
import { EPC_MODULES, epcRole, roleLabel, staffRoles, type EpcModule, type StaffRole } from "@/lib/epc-roles";
import { addMember, emailMemberPassword, fetchMembers, removeMember, setMemberPassword, updateMember, type MemberRow } from "@/lib/members";
import { generateStrongPassword } from "@/lib/password-gen";
import { loginShareText } from "@/lib/passwords";
import { fmtDateTime } from "@/lib/dates";
import { MOBILE_RE } from "@/lib/validators";
import { askConfirm } from "@/lib/confirm";

type Draft = { id: string | null; name: string; mobile: string; email: string; role: StaffRole; modules: EpcModule[]; password: string };
const blank = (): Draft => ({ id: null, name: "", mobile: "", email: "", role: "SALES", modules: EPC_MODULES.map((m) => m.key), password: generateStrongPassword(10) });

export default function UsersSettings() {
  const me = getBusiness();
  const myRole = epcRole(me);
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [owner, setOwner] = useState<{ name: string; mobile: string; email: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [shown, setShown] = useState<{ id: string; name: string; mobile: string; email: string | null; password: string } | null>(null); // a new password, once
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers().then(setRows, () => setFailed(true));
    fetchKyc().then((k) => setOwner({ name: k.contact_name || "", mobile: k.contact_mobile || "", email: k.contact_email || "" }), () => {});
  }, []);

  if (failed) return <p className="text-[13px] text-red-600">Couldn&apos;t load the users. Please refresh.</p>;
  if (!rows) return <p className="text-[13px] text-text-muted">Loading…</p>;

  // An admin manages Sales / Viewer only; the owner manages everyone.
  const canTouch = (m: MemberRow) => myRole === "OWNER" || (myRole === "ADMIN" && m.member_role !== "ADMIN");
  const roles = staffRoles(me).filter((r) => myRole === "OWNER" || r !== "ADMIN");

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) { setError("Enter the name."); return; }
    if (!MOBILE_RE.test(draft.mobile)) { setError("Enter a 10-digit mobile number."); return; }
    if (draft.role !== "SITE" && !draft.modules.length) { setError("Choose at least one module."); return; }
    setBusy(true); setError(null);
    try {
      const fields = { name: draft.name.trim(), mobile: draft.mobile, email: draft.email.trim() || null, member_role: draft.role, modules: draft.modules };
      if (draft.id) {
        const saved = await updateMember(draft.id, fields);
        setRows((r) => r!.map((x) => (x.id === saved.id ? saved : x)));
      } else {
        const saved = await addMember(me!.id, fields);
        await setMemberPassword(saved.id, draft.password);
        setRows((r) => [...r!, saved]);
        setShown({ id: saved.id, name: saved.name, mobile: saved.mobile, email: saved.email, password: draft.password });
      }
      setDraft(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function act(m: MemberRow, what: "reset" | "toggle" | "delete") {
    if (what === "delete" && !(await askConfirm(`Delete ${m.name}'s login? This can't be undone.`, { danger: true }))) return;
    setBusy(true); setError(null);
    try {
      if (what === "reset") {
        const pw = generateStrongPassword(10);
        await setMemberPassword(m.id, pw);
        setShown({ id: m.id, name: m.name, mobile: m.mobile, email: m.email, password: pw });
      } else if (what === "toggle") {
        const saved = await updateMember(m.id, { active: !m.active });
        setRows((r) => r!.map((x) => (x.id === saved.id ? saved : x)));
      } else {
        await removeMember(m.id);
        setRows((r) => r!.filter((x) => x.id !== m.id));
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const setD = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <>
      {shown && (
        <NewPasswordBox
          key={shown.id + shown.password}
          login={{ ...shown, shareText: loginShareText(shown) }}
          onEmail={(to) => emailMemberPassword(shown.id, to, shown.password)}
          onDone={() => setShown(null)}
        />
      )}

      {draft && (
        <Card title={draft.id ? "Edit user" : "New user"}>
          <Row label="Name"><input className={input} value={draft.name} onChange={(e) => setD({ name: e.target.value })} /></Row>
          <Row label="Mobile"><input className={input} inputMode="numeric" value={draft.mobile} onChange={(e) => setD({ mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></Row>
          <Row label="Email"><input className={input} type="email" value={draft.email} onChange={(e) => setD({ email: e.target.value.trim() })} /></Row>
          <Row label="Role">
            <div className="flex gap-2 flex-wrap">{roles.map((r) => <Toggle key={r} label={roleLabel(r, me)} on={draft.role === r} onClick={() => setD({ role: r })} />)}</div>
          </Row>
          {draft.role !== "SITE" && <Row label="Modules">
            <div className="flex gap-4 flex-wrap pt-1.5">
              {EPC_MODULES.map((m) => (
                <label key={m.key} className="flex items-center gap-2 text-[14px] text-text cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-navy" checked={draft.modules.includes(m.key)}
                    onChange={(e) => setD({ modules: e.target.checked ? [...draft.modules, m.key] : draft.modules.filter((x) => x !== m.key) })} />
                  {m.label}
                </label>
              ))}
            </div>
          </Row>}
          {!draft.id && (
            <Row label="Password">
              <div className="flex items-center gap-2">
                <input className={input + " font-mono max-w-[240px]"} value={draft.password} onChange={(e) => setD({ password: e.target.value.replace(/\s/g, "") })} />
                <button type="button" onClick={() => setD({ password: generateStrongPassword(10) })} className="text-[13px] font-semibold text-navy hover:underline whitespace-nowrap">New</button>
              </div>
            </Row>
          )}
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={() => void save()} disabled={busy} className="px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
              {busy ? "Saving…" : draft.id ? "Save" : "Add user"}
            </button>
            <button type="button" onClick={() => { setDraft(null); setError(null); }} className="text-[13px] font-semibold text-text-mid hover:underline">Cancel</button>
            {error && <span className="text-[13px] text-red-600">{error}</span>}
          </div>
        </Card>
      )}

      <Card title="Users & roles" right={!draft && (
        <button type="button" onClick={() => { setDraft(blank()); setError(null); }} className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY }}>Add user</button>
      )}>
        {!draft && error && <p className="text-[13px] text-red-600">{error}</p>}
        <div className="overflow-x-auto -mx-5 sm:-mx-6">
          <table className="w-full text-[13.5px] min-w-[720px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-wide text-text-muted border-b border-line">
                <th className="px-5 sm:px-6 py-2.5 font-semibold">User</th>
                <th className="px-3 py-2.5 font-semibold">Mobile</th>
                <th className="px-3 py-2.5 font-semibold">Role</th>
                <th className="px-3 py-2.5 font-semibold">Modules</th>
                <th className="px-3 py-2.5 font-semibold">Last login</th>
                <th className="px-5 sm:px-6 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {owner && (
                <tr className="border-b border-line">
                  <td className="px-5 sm:px-6 py-3"><div className="font-semibold text-text">{owner.name || "—"}</div>{owner.email && <div className="text-[12px] text-text-muted">{owner.email}</div>}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{owner.mobile ? `+91 ${owner.mobile}` : "—"}</td>
                  <td className="px-3 py-3"><Pill on>{roleLabel("OWNER", me)}</Pill></td>
                  <td className="px-3 py-3 text-text-mid">All</td>
                  <td className="px-3 py-3 text-text-muted">—</td>
                  <td className="px-5 sm:px-6 py-3" />
                </tr>
              )}
              {rows.map((m) => (
                <tr key={m.id} className={"border-b border-line last:border-0" + (m.active ? "" : " opacity-60")}>
                  <td className="px-5 sm:px-6 py-3"><div className="font-semibold text-text">{m.name}</div>{m.email && <div className="text-[12px] text-text-muted">{m.email}</div>}</td>
                  <td className="px-3 py-3 whitespace-nowrap">+91 {m.mobile}</td>
                  <td className="px-3 py-3"><Pill on={m.active}>{m.active ? roleLabel(m.member_role, me) : "Switched off"}</Pill></td>
                  <td className="px-3 py-3 text-text-mid">{m.member_role === "SITE" ? "Projects" : EPC_MODULES.filter((x) => m.modules.includes(x.key)).map((x) => x.label).join(", ")}</td>
                  <td className="px-3 py-3 text-text-muted whitespace-nowrap">{m.last_login_at ? fmtDateTime(m.last_login_at) : "—"}</td>
                  <td className="px-5 sm:px-6 py-3 text-right whitespace-nowrap">
                    {canTouch(m) && m.id !== me?.member?.id && (
                      <span className="inline-flex gap-3 text-[13px] font-semibold">
                        <button type="button" disabled={busy} className="text-navy hover:underline"
                          onClick={() => { setDraft({ id: m.id, name: m.name, mobile: m.mobile, email: m.email ?? "", role: m.member_role, modules: m.modules, password: "" }); setError(null); }}>Edit</button>
                        <button type="button" disabled={busy} className="text-navy hover:underline" onClick={() => void act(m, "reset")}>Reset password</button>
                        <button type="button" disabled={busy} className="text-text-mid hover:underline" onClick={() => void act(m, "toggle")}>{m.active ? "Switch off" : "Switch on"}</button>
                        <button type="button" disabled={busy} className="text-red-600 hover:underline" onClick={() => void act(m, "delete")}>Delete</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Pill({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={`px-2.5 py-1 rounded-full text-[12px] font-semibold ${on ? "bg-navy-tint text-navy" : "bg-grey-chip text-[#64748b]"}`}>{children}</span>;
}
