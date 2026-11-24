"use client";

// Stakeholders → EPCs (main admin): every EPC's Partner Portal logins — its
// owner and its team members (0119). Nobody can read a password (0136); when an
// EPC asks for one, Reset makes a new one-time password, shown once to send by
// email or WhatsApp, and the EPC sets its own at the next login.
// One read when the tab opens (kept 5 minutes), no polling.

import { useEffect, useMemo, useState } from "react";
import NewPasswordBox, { type NewLogin } from "@/components/NewPasswordBox";
import Modal, { OVERLAY } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";
import { getCached, setCached } from "@/lib/list-cache";
import { epcPasswordMail, loginPasswordStatus, loginShareText, sendPasswordDraft, setEpcLoginPassword } from "@/lib/passwords";
import { emailMemberPassword, setMemberPassword } from "@/lib/members";
import { generateStrongPassword } from "@/lib/password-gen";
import { ROLE_LABEL, type StaffRole } from "@/lib/epc-roles";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { notify } from "@/lib/notify";
import { askConfirm } from "@/lib/confirm";
import { errText } from "@/lib/errors";

type Member = { id: string; name: string; mobile: string; email: string | null; member_role: StaffRole; active: boolean; last_login_at: string | null };
type Epc = {
  id: string; trade_name: string | null; legal_name: string | null;
  contact_name: string | null; contact_mobile: string | null; contact_email: string | null;
  last_login_at: string | null; epc_members: Member[];
};
type Loaded = { epcs: Epc[]; pwSet: [string, string][] };
type Open = { login: NewLogin; onEmail: (to: string) => Promise<{ ok: boolean; sentTo?: string; error?: string }> };

const KEY = "stake.epcLogins";
const TTL = 300_000;
const th = "px-4 py-2.5 font-semibold text-left whitespace-nowrap";
const td = "px-4 py-2.5 text-text";
const companyOf = (e: Epc) => e.trade_name || e.legal_name || e.contact_name || "—";

export default function EpcLoginsTab() {
  const [data, setData] = useState<Loaded | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const hit = getCached<Loaded>(KEY, TTL);
    if (hit) { setData(hit); return; }
    void (async () => {
      const { data: rows } = await supabase().from("epc_business")
        .select("id, trade_name, legal_name, contact_name, contact_mobile, contact_email, last_login_at, epc_members(id, name, mobile, email, member_role, active, last_login_at)")
        .neq("business_type", "admin").not("contact_mobile", "is", null)
        .order("trade_name", { ascending: true, nullsFirst: false });
      const epcs = (rows ?? []) as Epc[];
      const pw = await loginPasswordStatus(epcs.map((e) => e.id));
      const v = { epcs, pwSet: [...pw] };
      setCached(KEY, v);
      setData(v);
    })();
  }, []);

  const pwSet = useMemo(() => new Map(data?.pwSet ?? []), [data]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!data || !s) return data?.epcs ?? [];
    return data.epcs.filter((e) => [companyOf(e), e.contact_name, e.contact_mobile, ...e.epc_members.flatMap((m) => [m.name, m.mobile])]
      .some((x) => (x ?? "").toLowerCase().includes(s)));
  }, [data, q]);

  async function resetOwner(e: Epc) {
    if (pwSet.has(e.id) && !(await askConfirm(`Reset ${companyOf(e)}'s password? The current one stops working.`, { danger: true }))) return;
    const pw = generateStrongPassword(14);
    setBusy(e.id);
    try {
      await setEpcLoginPassword(e.id, pw);
      const at = new Date().toISOString();
      setData((d) => {
        if (!d) return d;
        const v = { ...d, pwSet: [...d.pwSet.filter(([id]) => id !== e.id), [e.id, at] as [string, string]] };
        setCached(KEY, v);
        return v;
      });
      const name = e.contact_name || companyOf(e);
      const epc = { tradeName: companyOf(e), contactName: e.contact_name, mobile: e.contact_mobile };
      setOpen({
        login: { name, mobile: e.contact_mobile ?? "", email: e.contact_email, password: pw,
          shareText: loginShareText({ name, company: companyOf(e), mobile: e.contact_mobile ?? "", password: pw }) },
        onEmail: (to) => {
          const mail = epcPasswordMail(epc, pw, true);
          return sendPasswordDraft(e.id, { to, cc: [], subject: mail.subject, body: mail.body, password: pw });
        },
      });
    } catch (err) { notify.error(errText(err)); }
    finally { setBusy(null); }
  }

  async function resetMember(e: Epc, m: Member) {
    if (!(await askConfirm(`Reset ${m.name}'s password? The current one stops working.`, { danger: true }))) return;
    const pw = generateStrongPassword(10);
    setBusy(m.id);
    try {
      await setMemberPassword(m.id, pw);
      setOpen({
        login: { name: m.name, mobile: m.mobile, email: m.email, password: pw,
          shareText: loginShareText({ name: m.name, company: companyOf(e), mobile: m.mobile, password: pw }) },
        onEmail: (to) => emailMemberPassword(m.id, to, pw),
      });
    } catch (err) { notify.error(errText(err)); }
    finally { setBusy(null); }
  }

  const resetBtn = (id: string, onClick: () => void) => (
    <button type="button" onClick={onClick} disabled={busy !== null}
      className="text-[12px] font-semibold px-3 py-1.5 rounded border border-line text-text hover:bg-bg-tint disabled:opacity-60">
      {busy === id ? "Resetting…" : "Reset password"}
    </button>
  );

  return (
    <section className="bg-white border rounded-card overflow-x-auto cc-table-card">
      <div className="px-4 py-3 border-b border-line">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search"
          className="w-full max-w-[320px] border border-line rounded-[8px] px-3 py-1.5 text-[13px] outline-none focus:border-cc-blue" />
      </div>
      {!data ? (
        <p className="px-4 py-6 text-[13px] text-text-muted">Loading…</p>
      ) : (
        <table className="w-full text-[13px] cc-table">
          <thead>
            <tr>
              <th className={th}>EPC</th><th className={th}>Login</th><th className={th}>Role</th><th className={th}>Mobile</th>
              <th className={th}>Email</th><th className={th}>Password</th><th className={th}>Last login</th><th className={th} />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const at = pwSet.get(e.id);
              return [
                <tr key={e.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-semibold text-text">{companyOf(e)}</td>
                  <td className={td}>{e.contact_name || "—"}</td>
                  <td className={td}>{ROLE_LABEL.OWNER}</td>
                  <td className={td}>{e.contact_mobile}</td>
                  <td className={td}>{e.contact_email || "—"}</td>
                  <td className="px-4 py-2.5">
                    {at
                      ? <span className="text-cc-green font-semibold">Set on {fmtDate(at)}</span>
                      : <span className="text-warn-ink font-semibold">Not set</span>}
                  </td>
                  <td className={td + " whitespace-nowrap"}>{e.last_login_at ? fmtDateTime(e.last_login_at) : "—"}</td>
                  <td className="px-4 py-2.5 text-right">{resetBtn(e.id, () => void resetOwner(e))}</td>
                </tr>,
                ...e.epc_members.map((m) => (
                  <tr key={m.id} className={"border-t border-line" + (m.active ? "" : " opacity-60")}>
                    <td className="px-4 py-2.5" />
                    <td className={td}>{m.name}</td>
                    <td className={td}>{m.active ? ROLE_LABEL[m.member_role] : "Switched off"}</td>
                    <td className={td}>{m.mobile}</td>
                    <td className={td}>{m.email || "—"}</td>
                    <td className="px-4 py-2.5 text-cc-green font-semibold">Set</td>
                    <td className={td + " whitespace-nowrap"}>{m.last_login_at ? fmtDateTime(m.last_login_at) : "—"}</td>
                    <td className="px-4 py-2.5 text-right">{resetBtn(m.id, () => void resetMember(e, m))}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      )}
      {open && (
        // Shown once: only Done closes it, so a stray click or Escape can't lose the password.
        <Modal onClose={() => setOpen(null)} closeOnBackdrop={false} closeOnEscape={false}
          overlayClassName={OVERLAY.grid} className="w-full max-w-lg" aria-label={"Login for " + open.login.name}>
          <NewPasswordBox login={open.login} onEmail={open.onEmail} onDone={() => setOpen(null)} className="shadow-lg" />
        </Modal>
      )}
    </section>
  );
}
