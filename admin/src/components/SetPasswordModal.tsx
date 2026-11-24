"use client";

// Login password for a CC-team account: the server generates a
// strong password and EMAILS it with the login number to the address in the
// box (pre-filled with the account's email). Sending again replaces it — the
// old password stops working. Nobody can read a password back.

import { useEffect, useId, useState } from "react";
import Modal from "@/components/ui/Modal";
import { emailLoginPassword, loginPasswordStatus } from "@/lib/passwords";
import { fmtDate } from "@/lib/dates";
import { EMAIL_RE } from "@/lib/validators";
import { askConfirm } from "@/lib/confirm";

export default function SetPasswordModal({
  open, account, onClose,
}: {
  open: boolean;
  account: { id: string; name: string; mobile?: string | null; email?: string | null };
  onClose: () => void;
}) {
  const [setAt, setSetAt] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const emailId = useId();

  useEffect(() => {
    if (!open) return;
    setEmail(account.email ?? ""); setSentTo(null); setError(null); setSetAt(null);
    void loginPasswordStatus([account.id]).then((m) => setSetAt(m.get(account.id) ?? null));
  }, [open, account.id, account.email]);

  if (!open) return null;

  async function send() {
    if (busy) return;
    const to = email.trim();
    if (!EMAIL_RE.test(to)) { setError("Enter a valid email."); return; }
    if (setAt && !(await askConfirm(`Send a new password to ${to}? ${account.name}'s current password will stop working.`))) return;
    setBusy(true); setError(null);
    const r = await emailLoginPassword(account.id, to);
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Couldn't send the password."); return; }
    setSentTo(r.sentTo ?? to);
    setSetAt(new Date().toISOString());
  }

  return (
    <Modal onClose={onClose} busy={busy} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6" aria-labelledby={titleId}>
      <h3 id={titleId} className="font-semibold text-[18px] text-cc-ink">Login password</h3>
      <p className="text-[13px] text-cc-muted mt-0.5">
        {account.name}{account.mobile ? ` · ${account.mobile}` : ""}
        {setAt ? ` · set on ${fmtDate(setAt)}` : ""}
      </p>

      {sentTo ? (
        <p className="mt-4 text-[13px] text-cc-green bg-cc-tint border border-cc-line rounded-[8px] px-3 py-2">
          Password emailed to <span className="font-semibold">{sentTo}</span>.
        </p>
      ) : (
        <div className="mt-4">
          <label htmlFor={emailId} className="block text-[12px] text-cc-muted mb-1">Email</label>
          <input id={emailId} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy}
            className="w-full border border-cc-line rounded-[8px] px-3 py-2.5 text-[14px] focus:border-cc-blue outline-none bg-white" />
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy}
          className="text-[13px] font-semibold px-3 py-2 rounded-[8px] border border-cc-line bg-white text-cc-ink hover:bg-cc-wash disabled:opacity-60">
          {sentTo ? "Done" : "Cancel"}
        </button>
        {!sentTo && (
          <button type="button" onClick={() => void send()} disabled={busy}
            className="text-[13px] font-semibold px-3 py-2 rounded-[8px] bg-cc-green text-white hover:bg-cc-green-hover disabled:opacity-60">
            {busy ? "Sending…" : setAt ? "Email new password" : "Email password"}
          </button>
        )}
      </div>
    </Modal>
  );
}
