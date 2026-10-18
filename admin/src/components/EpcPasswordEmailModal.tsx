"use client";

// EPC login password — a DRAFTED email the main admin checks before sending.
// Opening it generates a new strong password and drafts the mail (login link,
// login mobile, password). The admin can edit To / Subject / the message and
// writes any CC; it always goes from the Capital Craft Gmail. Only after the
// mail is sent is the password saved — so sending again (a resend) gives the
// EPC a new password and the old one stops working.

import { useEffect, useState } from "react";
import { generateStrongPassword } from "@/lib/password-gen";
import { loginPasswordStatus, sendPasswordDraft } from "@/lib/passwords";
import { DEFAULT_MAIL_SENDER } from "@/lib/mail-sender";
import { fmtDate } from "@/lib/dates";
import { EMAIL_RE } from "@/lib/validators";

type Epc = { id: string; tradeName: string; contactName?: string | null; mobile?: string | null; email?: string | null };

function draftBody(epc: Epc, password: string): string {
  return [
    `Namaste ${epc.contactName || epc.tradeName},`,
    "",
    `Your EPC partner account (${epc.tradeName}) has been approved by Capital Craft. Your partner portal login is ready.`,
    "",
    `Login: ${window.location.origin}/login`,
    `Mobile number: ${epc.mobile ?? ""}`,
    `Password: ${password}`,
    "",
    "Please keep this password private.",
    "",
    "Regards,",
    "Capital Craft Advisors",
  ].join("\n");
}

export default function EpcPasswordEmailModal({ open, epc, onClose }: { open: boolean; epc: Epc; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [setAt, setSetAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A fresh password + draft every time it opens.
  useEffect(() => {
    if (!open) return;
    const pw = generateStrongPassword();
    setPassword(pw);
    setTo(epc.email ?? ""); setCc("");
    setSubject("Your Capital Craft partner portal login");
    setBody(draftBody(epc, pw));
    setSentTo(null); setError(null); setSetAt(null);
    void loginPasswordStatus([epc.id]).then((m) => setSetAt(m.get(epc.id) ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, epc.id]);

  if (!open) return null;

  async function send() {
    if (busy) return;
    const ccList = cc.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!EMAIL_RE.test(to.trim())) { setError("Enter a valid To email."); return; }
    const bad = ccList.find((x) => !EMAIL_RE.test(x));
    if (bad) { setError(`"${bad}" isn't a valid CC email.`); return; }
    if (!body.includes(password)) { setError("Keep the password in the message."); return; }
    if (setAt && !window.confirm(`Send a new password to ${epc.tradeName}? The current password will stop working.`)) return;
    setBusy(true); setError(null);
    const r = await sendPasswordDraft(epc.id, { to: to.trim(), cc: ccList, subject, body, password });
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Couldn't send the email."); return; }
    setSentTo(r.sentTo ?? to.trim());
  }

  const inputCls = "w-full border border-[#cdeadd] rounded-[8px] px-3 py-2 text-[14px] focus:border-[#185fa5] outline-none bg-white";
  const row = "grid grid-cols-[64px_1fr] items-center gap-2";
  const lbl = "text-[12px] text-[#5a8a76]";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { if (!busy) onClose(); }}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl bg-white rounded-lg shadow-lg p-6 max-h-[92vh] overflow-y-auto">
        <h3 className="font-semibold text-[18px] text-[#0f3d2e]">Email password</h3>
        <p className="text-[13px] text-[#5a8a76] mt-0.5">
          {epc.tradeName}{epc.mobile ? ` · ${epc.mobile}` : ""}{setAt ? ` · last sent ${fmtDate(setAt)}` : ""}
        </p>

        {sentTo ? (
          <p className="mt-4 text-[13px] text-[#178a5c] bg-[#e6f6ee] border border-[#cdeadd] rounded-[8px] px-3 py-2">
            Password emailed to <span className="font-semibold">{sentTo}</span>.
          </p>
        ) : (
          <div className="mt-4 space-y-2.5">
            <div className={row}><span className={lbl}>From</span><span className="text-[14px] text-[#0f3d2e]">{DEFAULT_MAIL_SENDER}</span></div>
            <div className={row}><span className={lbl}>To</span><input type="email" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div className={row}><span className={lbl}>CC</span><input className={inputCls} value={cc} onChange={(e) => setCc(e.target.value)} /></div>
            <div className={row}><span className={lbl}>Subject</span><input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <textarea className={inputCls + " font-[inherit] leading-relaxed"} rows={13} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        )}

        {error && <p className="mt-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="text-[13px] font-semibold px-3 py-2 rounded-[8px] border border-[#cdeadd] bg-white text-[#0f3d2e] hover:bg-[#f0faf5] disabled:opacity-60">
            {sentTo ? "Done" : "Cancel"}
          </button>
          {!sentTo && (
            <button type="button" onClick={() => void send()} disabled={busy}
              className="text-[13px] font-semibold px-4 py-2 rounded-[8px] bg-[#178a5c] text-white hover:bg-[#12734c] disabled:opacity-60">
              {busy ? "Sending…" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
