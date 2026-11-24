"use client";

// EPC login password — a DRAFTED email the main admin checks before sending.
// Opening it makes a ONE-TIME password (14 random characters — nothing from the
// company's name) and drafts the mail: the login link, the login mobile and the
// one-time password, which the EPC uses once to set its own password (the portal
// asks at that login, migration 0103/0110). The first email reads "set your
// password"; once the EPC has a password, it reads "reset your password".
// The admin can edit To / Subject / the message — the password too: whatever
// the "One-time password:" line says is what gets saved — and writes any CC; it
// always goes from the Capital Craft Gmail. Only after the mail is sent is the
// password saved — so a resend gives a new one and the old one stops working.

import { useEffect, useState } from "react";
import { generateStrongPassword, issuedPasswordOk, ISSUED_PASSWORD_RULE } from "@/lib/password-gen";
import { loginPasswordStatus, sendPasswordDraft } from "@/lib/passwords";
import { DEFAULT_MAIL_SENDER } from "@/lib/mail-sender";
import { fmtDate } from "@/lib/dates";
import { EMAIL_RE } from "@/lib/validators";
import Modal from "@/components/ui/Modal";

type Epc = { id: string; tradeName: string; contactName?: string | null; mobile?: string | null; email?: string | null };

// First email (no password yet) → set your password; afterwards → reset it.
function draftMail(epc: Epc, password: string, reset: boolean): { subject: string; body: string } {
  const login = [
    `Login: ${window.location.origin}/login`,
    `Mobile number: ${epc.mobile ?? ""}`,
    `One-time password: ${password}`,
  ];
  const close = ["", "Regards,", "Capital Craft Advisors"];
  const hello = `Namaste ${epc.contactName || epc.tradeName},`;
  if (reset) {
    return {
      subject: "Reset your Capital Craft partner portal password",
      body: [
        hello, "",
        `Here is a one-time password to reset the password of your Capital Craft partner portal login (${epc.tradeName}).`, "",
        ...login, "",
        "Log in with this one-time password and the portal will ask you to set a new password. Please choose one you will remember. Your old password no longer works, and this one-time password works only once.",
        ...close,
      ].join("\n"),
    };
  }
  return {
    subject: "Your Capital Craft partner portal login",
    body: [
      hello, "",
      `Your EPC partner account (${epc.tradeName}) has been approved by Capital Craft. Your partner portal login is ready.`, "",
      ...login, "",
      "Log in with this one-time password and the portal will ask you to set your own password. Please choose one you will remember — you'll use it every time you log in. This one-time password works only once.",
      ...close,
    ].join("\n"),
  };
}

/** The password as written on the message's "One-time password:" (or "Password:") line. */
const passwordIn = (body: string) => body.match(/^[ \t]*(?:one-time\s+)?password:[ \t]*(\S+)/im)?.[1] ?? "";

export default function EpcPasswordEmailModal({ open, epc, onClose }: { open: boolean; epc: Epc; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [setAt, setSetAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A fresh one-time password + draft every time it opens — the "reset" wording
  // once the EPC already has a password.
  useEffect(() => {
    if (!open) return;
    setTo(epc.email ?? ""); setCc("");
    setSubject(""); setBody("");
    setSentTo(null); setError(null); setSetAt(null);
    const otp = generateStrongPassword(14);
    void loginPasswordStatus([epc.id]).then((m) => {
      const at = m.get(epc.id) ?? null;
      setSetAt(at);
      const mail = draftMail(epc, otp, !!at);
      setSubject(mail.subject); setBody(mail.body);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, epc.id]);

  if (!open) return null;

  async function send() {
    if (busy) return;
    const ccList = cc.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!EMAIL_RE.test(to.trim())) { setError("Enter a valid To email."); return; }
    const bad = ccList.find((x) => !EMAIL_RE.test(x));
    if (bad) { setError(`"${bad}" isn't a valid CC email.`); return; }
    const password = passwordIn(body);
    if (!password) { setError("Keep the password in the message."); return; }
    if (!issuedPasswordOk(password)) { setError(ISSUED_PASSWORD_RULE); return; }
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
    <Modal onClose={onClose} busy={busy} className="w-full max-w-xl bg-white rounded-lg shadow-lg p-6 max-h-[92vh] overflow-y-auto">
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
    </Modal>
  );
}
