"use client";

// "Send to lender" — emails the whole application (named document links + a
// single ZIP link + the summary sheet attached) from capitalcraftadvisors@gmail.com
// to a recipient the admin types in. Keeps the Download-ZIP button untouched.

import { useState } from "react";
import { getToken } from "@/lib/auth";

const LENDERS = [
  { v: "creditfair", l: "Credit Fair" },
  { v: "aerem", l: "Aerem" },
  { v: "solfin", l: "Solfin" },
];

export default function SendToLenderModal({
  appId, open, onClose, defaultLender,
}: { appId: string; open: boolean; onClose: () => void; defaultLender?: string | null }) {
  const [lender, setLender] = useState<string>(defaultLender || "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cc, setCc] = useState("malvikasaxena323@gmail.com"); // default CC
  const [bcc, setBcc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!open) return null;

  async function send() {
    if (!lender) { setError("Pick a lender."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Enter a valid recipient email."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/loan-app/${appId}/send-to-lender`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ lender, recipient_name: name.trim(), recipient_email: email.trim(), cc: cc.trim(), bcc: bcc.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't send the email."); setBusy(false); return; }
      setDone(`Sent to ${email.trim()} — ${j.documents} document link${j.documents === 1 ? "" : "s"} + summary + ZIP.`);
    } catch (e) {
      setError((e as Error)?.message || "Network error.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-display font-semibold text-[18px] text-text">Send to lender</h3>
          <button type="button" onClick={onClose} className="text-[18px] text-text-muted hover:text-text leading-none" aria-label="Close">×</button>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="p-3 rounded-input bg-[#e9f7f0] border border-[#cdeadd] text-[13px] text-[#0f3d2e]">✓ {done}</div>
            <div className="flex justify-end"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-[#178a5c] text-white text-[13px] font-semibold">Done</button></div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-text-mid">
              Emailed from <b>capitalcraftadvisors@gmail.com</b> with a link to every document, one ZIP link, and the summary sheet attached.
            </p>
            <label className="block text-[13px] font-medium text-text-mid">Lender
              <select value={lender} onChange={(e) => setLender(e.target.value)}
                className="mt-1 w-full rounded-input border border-line bg-white px-3 py-2.5 text-[14px] outline-none focus:border-blue">
                <option value="">Select…</option>
                {LENDERS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
              </select>
            </label>
            <label className="block text-[13px] font-medium text-text-mid">Recipient name (optional)
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Credit Fair team"
                className="mt-1 w-full rounded-input border border-line px-3 py-2.5 text-[14px] outline-none focus:border-blue" />
            </label>
            <label className="block text-[13px] font-medium text-text-mid">Recipient email
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lender@example.com" inputMode="email"
                className="mt-1 w-full rounded-input border border-line px-3 py-2.5 text-[14px] outline-none focus:border-blue" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[13px] font-medium text-text-mid">CC (optional)
                <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@example.com"
                  className="mt-1 w-full rounded-input border border-line px-3 py-2.5 text-[13px] outline-none focus:border-blue" />
              </label>
              <label className="block text-[13px] font-medium text-text-mid">BCC (optional)
                <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="bcc@example.com"
                  className="mt-1 w-full rounded-input border border-line px-3 py-2.5 text-[13px] outline-none focus:border-blue" />
              </label>
            </div>
            <p className="text-[11px] text-text-muted">Separate multiple CC/BCC addresses with commas.</p>
            {error && <div className="p-2.5 rounded-input bg-red-50 border border-red-200 text-[12px] text-red-700">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg border border-line text-[13px] text-text-mid disabled:opacity-60">Cancel</button>
              <button type="button" onClick={() => void send()} disabled={busy} className="px-5 py-2 rounded-lg bg-[#178a5c] text-white text-[13px] font-semibold disabled:opacity-60">{busy ? "Sending…" : "Send"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
