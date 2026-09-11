"use client";

// Shared email composer for "send to lender" — used by BOTH the loan flow and
// the EPC dashboard (via the `endpoint` prop). Flow:
//   1. On open it fetches a PREVIEW (mode:"preview") — subject, the editable
//      detail table, the document list, and default CC/BCC — so the admin sees
//      exactly what will be sent and can fix any missing field first.
//   2. TO is a single primary address; CC/BCC are chip lists (type → Add, no
//      commas). Every field autocompletes from the shared address book
//      (email_contacts), and every address sent is saved back for next time.
//   3. Send (mode:"send") posts the edited content.

import { useEffect, useMemo, useState } from "react";
import { getToken } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const LENDERS = [
  { v: "creditfair", l: "Credit Fair" },
  { v: "aerem", l: "Aerem" },
  { v: "solfin", l: "Solfin" },
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Preview = { subject: string; toName: string; detail: [string, string][]; docLabels: string[]; ccDefault: string[]; bccDefault: string[] };

export default function EmailComposerModal({
  open, onClose, endpoint, title = "Send to lender", defaultLender,
}: { open: boolean; onClose: () => void; endpoint: string; title?: string; defaultLender?: string | null }) {
  const [lender, setLender] = useState<string>(defaultLender || "creditfair");
  const [loading, setLoading] = useState(true);
  const [toName, setToName] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [detail, setDetail] = useState<[string, string][]>([]);
  const [docLabels, setDocLabels] = useState<string[]>([]);
  const [contacts, setContacts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function api(payload: Record<string, unknown>) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok && j?.ok, j };
  }

  // Load the preview + the shared address book when the modal opens.
  useEffect(() => {
    if (!open) return;
    setLoading(true); setError(null); setDone(null);
    void (async () => {
      const { ok, j } = await api({ mode: "preview", lender: defaultLender || "creditfair" });
      if (ok) {
        const p = j as Preview;
        setSubject(p.subject || ""); setToName(p.toName || "");
        setDetail(p.detail || []); setDocLabels(p.docLabels || []);
        setCc(p.ccDefault || []); setBcc(p.bccDefault || []);
      } else {
        setError(j?.error || "Couldn't load the email preview.");
      }
      try {
        const { data } = await supabase().from("email_contacts").select("email").order("last_used_at", { ascending: false }).limit(500);
        setContacts(((data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean));
      } catch { /* suggestions are best-effort */ }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dl = useMemo(() => "email-book", []);

  if (!open) return null;

  async function send() {
    if (!lender) { setError("Pick a lender."); return; }
    if (!EMAIL_RE.test(to.trim())) { setError("Enter a valid TO email."); return; }
    setBusy(true); setError(null);
    const { ok, j } = await api({ mode: "send", lender, to: to.trim(), toName: toName.trim(), cc, bcc, subject: subject.trim(), detail });
    if (ok) setDone(`Sent to ${to.trim()} — ${j.documents} document link${j.documents === 1 ? "" : "s"} + summary + ZIP.`);
    else setError(j?.error || "Couldn't send the email.");
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-white rounded-lg shadow-lg p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-display font-semibold text-[18px] text-text">{title}</h3>
          <button type="button" onClick={onClose} className="text-[18px] text-text-muted hover:text-text leading-none" aria-label="Close">×</button>
        </div>

        {/* Shared datalist backing every email input's autocomplete. */}
        <datalist id={dl}>{contacts.map((e) => <option key={e} value={e} />)}</datalist>

        {done ? (
          <div className="space-y-4">
            <div className="p-3 rounded-input bg-[#e9f7f0] border border-[#cdeadd] text-[13px] text-[#0f3d2e]">✓ {done}</div>
            <div className="flex justify-end"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-[#178a5c] text-white text-[13px] font-semibold">Done</button></div>
          </div>
        ) : loading ? (
          <p className="text-[13px] text-text-muted py-6 text-center">Loading preview…</p>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-text-mid">Sent from <b>capitalcraftadvisors@gmail.com</b>. Review below — everything is editable before you send.</p>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[13px] font-medium text-text-mid">Lender
                <select value={lender} onChange={(e) => setLender(e.target.value)}
                  className="mt-1 w-full rounded-input border border-line bg-white px-3 py-2.5 text-[14px] outline-none focus:border-blue">
                  {LENDERS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
                </select>
              </label>
              <label className="block text-[13px] font-medium text-text-mid">Name (for greeting)
                <input value={toName} onChange={(e) => setToName(e.target.value)} placeholder="e.g. Credit Fair team"
                  className="mt-1 w-full rounded-input border border-line px-3 py-2.5 text-[14px] outline-none focus:border-blue" />
              </label>
            </div>

            <label className="block text-[13px] font-medium text-text-mid">TO
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="lender@example.com" inputMode="email" list={dl}
                className="mt-1 w-full rounded-input border border-line px-3 py-2.5 text-[14px] outline-none focus:border-blue" />
            </label>

            <ChipField label="CC" values={cc} onChange={setCc} listId={dl} />
            <ChipField label="BCC" values={bcc} onChange={setBcc} listId={dl} />

            <label className="block text-[13px] font-medium text-text-mid">Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-input border border-line px-3 py-2.5 text-[14px] outline-none focus:border-blue" />
            </label>

            {/* Editable detail table — this is the email body; fix any missing value here. */}
            <div>
              <div className="text-[13px] font-medium text-text-mid mb-1">Details in the email</div>
              <div className="border border-line rounded-input divide-y divide-line">
                {detail.map(([k, v], i) => (
                  <div key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className="text-[12px] text-text-muted w-40 shrink-0 truncate">{k}</span>
                    <input value={v} onChange={(e) => { const n = detail.slice(); n[i] = [k, e.target.value]; setDetail(n); }}
                      className="flex-1 min-w-0 border-0 border-b border-transparent focus:border-blue text-[13px] py-1 outline-none bg-transparent" />
                  </div>
                ))}
              </div>
            </div>

            <div className="text-[12px] text-text-muted">
              <b>{docLabels.length}</b> document{docLabels.length === 1 ? "" : "s"} attached: {docLabels.join(", ") || "none on file"}
            </div>

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

// CC / BCC chip field — type an address, Enter or "Add" turns it into a
// removable chip. Autocompletes from the shared address book (listId).
function ChipField({ label, values, onChange, listId }: { label: string; values: string[]; onChange: (v: string[]) => void; listId: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const e = draft.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return;
    if (!values.includes(e)) onChange([...values, e]);
    setDraft("");
  };
  return (
    <div>
      <div className="text-[13px] font-medium text-text-mid mb-1">{label}</div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {values.map((e) => (
            <span key={e} className="inline-flex items-center gap-1 text-[12px] rounded-full bg-[#eef2f7] text-[#334155] pl-2.5 pr-1 py-0.5">
              {e}
              <button type="button" onClick={() => onChange(values.filter((x) => x !== e))} className="text-[14px] leading-none text-text-muted hover:text-text px-0.5" aria-label={`Remove ${e}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={`Add ${label} address`} inputMode="email" list={listId}
          className="flex-1 min-w-0 rounded-input border border-line px-3 py-2 text-[13px] outline-none focus:border-blue" />
        <button type="button" onClick={add} disabled={!EMAIL_RE.test(draft.trim())}
          className="px-3.5 py-2 rounded-lg border border-line text-[13px] font-semibold text-text-mid hover:bg-bg-tint disabled:opacity-50">Add</button>
      </div>
    </div>
  );
}
