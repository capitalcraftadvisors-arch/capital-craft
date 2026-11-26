"use client";

// A new login password, shown once — copy it, email it (always from the Capital
// Craft Gmail) or send it on WhatsApp. Used by the Partner Portal's Users &
// roles and Stakeholders → EPCs. Later only the CC main admin can read an EPC login's
// password, on Stakeholders → EPCs (0142).

import { useState } from "react";
import { CopyButton } from "@/components/view/ViewKit";
import { openWhatsApp } from "@/lib/wa-link";
import { EMAIL_RE } from "@/lib/validators";

export type NewLogin = { name: string; mobile: string; email: string | null; password: string; shareText: string };
type Sent = { ok: boolean; sentTo?: string; error?: string };

export default function NewPasswordBox({ login, onEmail, onDone, className = "mb-5" }: {
  login: NewLogin;
  onEmail: (to: string) => Promise<Sent>;
  onDone: () => void;
  className?: string;
}) {
  const [to, setTo] = useState(login.email ?? "");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function email() {
    if (!EMAIL_RE.test(to.trim())) { setError("Enter a valid email."); return; }
    setBusy(true); setError(null);
    const r = await onEmail(to.trim());
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Couldn't send the email."); return; }
    setSentTo(r.sentTo ?? to.trim());
  }

  const btn = "px-3 py-1.5 rounded-[8px] text-[13px] font-semibold disabled:opacity-60";
  return (
    <section className={"rounded-2xl border border-cc-line bg-cc-wash p-5 " + className}>
      <div className="text-[14px] font-semibold text-cc-ink mb-2">Login for {login.name}</div>
      <div className="grid gap-1.5 text-[14px]">
        <div className="flex items-center gap-3"><span className="w-24 text-text-mid">Mobile</span><span className="font-semibold">{login.mobile}</span><CopyButton value={login.mobile} /></div>
        <div className="flex items-center gap-3"><span className="w-24 text-text-mid">Password</span><span className="font-mono font-semibold">{login.password}</span><CopyButton value={login.password} /></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input type="email" value={to} onChange={(e) => { setTo(e.target.value); setError(null); }} disabled={busy} placeholder="Email"
          className="flex-1 min-w-[200px] max-w-[300px] border border-cc-line rounded-[8px] px-3 py-1.5 text-[14px] bg-white outline-none focus:border-cc-blue" />
        <button type="button" onClick={() => void email()} disabled={busy} className={btn + " bg-cc-green text-white hover:bg-cc-green-hover"}>
          {busy ? "Sending…" : "Email"}
        </button>
        <button type="button" onClick={() => openWhatsApp(window.open("", "_blank"), login.mobile, login.shareText)}
          className={btn + " bg-[#25d366] text-white hover:brightness-95"}>
          WhatsApp
        </button>
        <button type="button" onClick={onDone} className="ml-auto text-[13px] font-semibold text-navy hover:underline">Done</button>
      </div>
      {sentTo && <p className="mt-2 text-[13px] text-cc-green">Emailed to <span className="font-semibold">{sentTo}</span>.</p>}
      {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
    </section>
  );
}
