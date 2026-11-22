"use client";

// /p/<token> — the customer's solar proposal (Partner Portal v2, epc_proposals
// 0129). PUBLIC: no login, no portal frame; the customer opens it from WhatsApp
// on a phone. Shows the EPC, the system, the price (and after subsidy), the
// validity and the items, opens the quotation PDF, and takes the acceptance —
// the customer types their name and taps Accept (no OTP). Past its validity it
// can still be read, not accepted. One read on open (/api/proposal/<token>).

import { useEffect, useState, type ReactNode } from "react";
import { NAVY } from "@/components/partner/PartnerShell";
import { input } from "@/components/quotation/form-kit";
import { fmtDate, localIsoDate } from "@/lib/dates";
import { fmtRupees } from "@/lib/money";
import { PROPOSAL_TOKEN_RE, type PublicProposal } from "@/lib/proposals";

export default function ProposalPage({ params }: { params: { token: string } }) {
  const [p, setP] = useState<PublicProposal | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justNow, setJustNow] = useState(false);

  useEffect(() => {
    if (!PROPOSAL_TOKEN_RE.test(params.token)) { setFailed("This proposal is not available."); return; }
    fetch(`/api/proposal/${params.token}`)
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't open this proposal.");
        setP(j as PublicProposal);
      })
      .catch((e) => setFailed((e as Error).message));
  }, [params.token]);

  useEffect(() => {
    if (p?.snapshot.org.name) document.title = `Solar proposal · ${p.snapshot.org.name}`;
  }, [p]);

  async function accept() {
    const n = name.replace(/\s+/g, " ").trim();
    if (!n || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/proposal/${params.token}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't accept the proposal. Please try again.");
      setP((cur) => (cur ? { ...cur, accepted_at: j.accepted_at ?? new Date().toISOString(), accepted_name: j.accepted_name ?? n } : cur));
      setJustNow(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (failed) return <Frame><p className="mt-24 text-center text-[15px] text-text-mid">{failed}</p></Frame>;
  if (!p) return <Frame><p className="mt-24 text-center text-[14px] text-text-muted">Loading…</p></Frame>;

  const s = p.snapshot;
  const org = s.org;
  const expired = !p.accepted_at && !!s.valid_till && s.valid_till < localIsoDate(new Date());
  const kw = s.kw ? +Number(s.kw).toFixed(2) : null;
  const initial = (org.name || "S").trim().charAt(0).toUpperCase();

  return (
    <Frame>
      {/* The EPC */}
      <header className="flex items-center gap-3 pt-2 pb-5">
        <span className="h-11 w-11 shrink-0 rounded-full grid place-items-center text-white text-[18px] font-bold" style={{ background: NAVY }}>{initial}</span>
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-text truncate">{org.name}</div>
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[13px] text-text-muted">
            {org.phone && <a href={`tel:${org.phone.replace(/[^\d+]/g, "")}`} className="hover:text-text">{org.phone}</a>}
            {org.email && <a href={`mailto:${org.email}`} className="hover:text-text truncate">{org.email}</a>}
          </div>
        </div>
      </header>

      {/* The proposal */}
      <section className="rounded-[22px] p-6 text-white shadow-lg" style={{ background: `linear-gradient(155deg, ${NAVY} 0%, #1e3a8a 100%)` }}>
        <div className="text-[12.5px] text-white/65">{s.quote_no} · {fmtDate(s.quote_date)}</div>
        <h1 className="mt-1.5 text-[22px] leading-snug font-bold">Solar proposal for {s.customer_name}</h1>
        {kw != null && (
          <div className="mt-6 flex items-end gap-1.5">
            <span className="font-display text-[46px] leading-none font-bold tracking-tight">{kw}</span>
            <span className="pb-1 text-[17px] font-semibold text-white/80">kW</span>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-[18px] bg-white border border-line px-5 py-2 shadow-sm">
        <Row l="Total price" v={fmtRupees(s.total)} />
        {s.net != null && <Row l="After subsidy" v={fmtRupees(s.net)} strong />}
        {s.valid_till && <Row l="Valid till" v={fmtDate(s.valid_till)} warn={expired} />}
      </section>

      {s.lines.length > 0 && (
        <section className="mt-4 rounded-[18px] bg-white border border-line px-5 py-3 shadow-sm">
          <h2 className="text-[13px] font-semibold text-text-mid py-1.5">Items</h2>
          <ul>
            {s.lines.map((it, i) => (
              <li key={i} className="flex items-start justify-between gap-4 py-2.5 border-t border-line-soft first:border-t-0">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-text">{it.description}</div>
                  {it.make && <div className="text-[12.5px] text-text-muted mt-0.5">{it.make}</div>}
                </div>
                {it.qty && <div className="shrink-0 text-[13.5px] text-text-mid whitespace-nowrap">{it.qty}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.pdf && (
        <a href={p.pdf} target="_blank" rel="noopener noreferrer"
          className="mt-4 flex items-center justify-center gap-2 w-full rounded-[14px] border border-line bg-white py-3.5 text-[15px] font-semibold shadow-sm"
          style={{ color: NAVY }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
          View quotation
        </a>
      )}

      {/* Acceptance */}
      <section className="mt-4 mb-10 rounded-[18px] bg-white border border-line p-5 shadow-sm">
        {p.accepted_at ? (
          <div className="flex items-center gap-3.5">
            <span className="h-11 w-11 shrink-0 rounded-full grid place-items-center bg-[#e6f6ee] text-[#178a5c]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17 19 7" /></svg>
            </span>
            <div className="min-w-0">
              <div className="text-[16px] font-bold text-text">{justNow ? `Thank you, ${p.accepted_name}` : "Accepted"}</div>
              <div className="text-[13.5px] text-text-muted">{justNow ? "" : `${p.accepted_name} · `}{fmtDate(p.accepted_at)}</div>
            </div>
          </div>
        ) : (
          <>
            <input className={input + " !text-[16px] !py-3"} value={name} placeholder="Your full name" autoComplete="name" disabled={expired || busy}
              onChange={(e) => { setName(e.target.value.slice(0, 120)); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") void accept(); }} />
            {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
            {expired && <p className="mt-2 text-[13px] text-[#b45309]">This proposal has expired.</p>}
            <button type="button" onClick={() => void accept()} disabled={expired || busy || !name.trim()}
              className="mt-3 w-full rounded-[14px] py-3.5 text-[15px] font-semibold text-white disabled:opacity-50" style={{ background: NAVY }}>
              {busy ? "Accepting…" : "Accept proposal"}
            </button>
          </>
        )}
      </section>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f4f6fb]">
      <div className="mx-auto w-full max-w-[480px] px-4 py-5">{children}</div>
    </main>
  );
}

function Row({ l, v, strong, warn }: { l: string; v: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-t border-line-soft first:border-t-0">
      <span className="text-[14px] text-text-mid">{l}</span>
      <span className={["whitespace-nowrap", strong ? "text-[18px] font-bold text-[#178a5c]" : "text-[15px] font-semibold text-text", warn ? "!text-[#b45309]" : ""].join(" ")}>{v}</span>
    </div>
  );
}
