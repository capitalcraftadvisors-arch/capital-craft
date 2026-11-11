"use client";

// Quotations — every quotation the company made, newest first, in Residential /
// Commercial tabs: search, status filter, open (edit), download. "New quotation"
// asks for the template — Simple (standard) or the company's Custom one.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NAVY } from "@/components/partner/PartnerShell";
import NewQuoteChooser from "@/components/partner/NewQuoteChooser";
import CustomTemplateBanner from "@/components/partner/CustomTemplateBanner";
import { input } from "@/components/quotation/form-kit";
import { fetchQuotes, downloadQuotePdf, QUOTE_STATUSES, QUOTE_STATUS_LABEL, QUOTE_STATUS_PILL, type QuoteRow, type QuoteStatus } from "@/lib/quotes";
import { fetchQuoteTemplate, type QuoteTemplate } from "@/lib/quotation-template";
import { fmtDate } from "@/lib/dates";
import { fmtRupees } from "@/lib/money";
import { getBusiness } from "@/lib/auth";
import { canWork } from "@/lib/epc-roles";

type Segment = "residential" | "commercial";
const SEGMENTS: [Segment, string][] = [["residential", "Residential"], ["commercial", "Commercial"]];

export default function QuotesList() {
  const router = useRouter();
  const me = getBusiness();
  const work = canWork(me);
  const ownerName = (me?.contact_name || "").trim() || "—"; // a quotation with no staff member = the owner's
  const [rows, setRows] = useState<QuoteRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [segment, setSegment] = useState<Segment>("residential");
  const [status, setStatus] = useState<QuoteStatus | "all">("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [tpl, setTpl] = useState<QuoteTemplate | null | undefined>(undefined); // the custom template (cached read)
  const [choose, setChoose] = useState(false);

  useEffect(() => { fetchQuotes().then(setRows, () => setFailed(true)); }, []);
  useEffect(() => { fetchQuoteTemplate().then(setTpl, () => setTpl(null)); }, []);

  const inSegment = useMemo(() => (rows ?? []).filter((r) => r.segment === segment), [rows, segment]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return inSegment.filter((r) => (status === "all" || r.status === status)
      && (!s || [r.quote_no, r.customer_name, r.customer_mobile].some((v) => String(v ?? "").toLowerCase().includes(s))));
  }, [inSegment, status, q]);
  const count = (k: QuoteStatus | "all") => inSegment.filter((r) => k === "all" || r.status === k).length;

  async function download(id: string) {
    setBusy(id);
    try { await downloadQuotePdf(id); } catch (e) { alert((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="max-w-[1150px]">
      <CustomTemplateBanner tpl={tpl} />

      {/* Residential / Commercial */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="inline-flex p-1 rounded-xl bg-white border border-line">
          {SEGMENTS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setSegment(k); setStatus("all"); }}
              className={["px-5 py-2 rounded-lg text-[14px] font-semibold", segment === k ? "text-white" : "text-text-mid hover:text-text"].join(" ")}
              style={segment === k ? { background: NAVY } : undefined}>
              {label} <span className="opacity-70">{(rows ?? []).filter((r) => r.segment === k).length}</span>
            </button>
          ))}
        </div>
        {work && (
          <button type="button" onClick={() => setChoose(true)}
            className="ml-auto px-4 py-2.5 rounded-xl text-white text-[13.5px] font-semibold" style={{ background: NAVY }}>
            + New quotation
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex gap-1.5 flex-wrap">
          {(["all", ...QUOTE_STATUSES] as const).map((k) => (
            <button key={k} type="button" onClick={() => setStatus(k)}
              className={["px-3.5 py-1.5 rounded-full text-[13px] font-semibold border", status === k ? "text-white border-transparent" : "bg-white border-line text-text-mid"].join(" ")}
              style={status === k ? { background: NAVY } : undefined}>
              {k === "all" ? "All" : QUOTE_STATUS_LABEL[k]} <span className="opacity-70">{count(k)}</span>
            </button>
          ))}
        </div>
        <input className={input + " max-w-[260px] ml-auto"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, customer, mobile" />
      </div>

      {choose && <NewQuoteChooser segment={segment} tpl={tpl ?? null} onClose={() => setChoose(false)} />}

      {failed ? (
        <p className="text-[13px] text-red-600">Couldn&apos;t load your quotations. Please refresh.</p>
      ) : !rows ? (
        <p className="text-[13px] text-text-muted">Loading…</p>
      ) : (
        <div className="bg-white rounded-2xl border border-line overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[760px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-wide text-text-muted border-b border-line">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Quotation</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold text-right">Size</th>
                <th className="px-4 py-3 font-semibold text-right">Amount</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">By</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/dashboard/quotes/${r.id}` as any)} className="border-b border-line last:border-0 hover:bg-bg-soft cursor-pointer">
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDate(r.quote_date)}</td>
                  <td className="px-4 py-3 font-semibold text-[#1e3a8a] whitespace-nowrap">{r.quote_no}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-text">{r.customer_name || "—"}</div>
                    {r.customer_mobile && <div className="text-[12px] text-text-muted">+91 {r.customer_mobile}</div>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{r.kw ? `${+Number(r.kw).toFixed(2)} kW` : "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{fmtRupees(r.total)}</td>
                  <td className="px-4 py-3"><span className={`px-2.5 py-1 rounded-full text-[12px] font-semibold ${QUOTE_STATUS_PILL[r.status]}`}>{QUOTE_STATUS_LABEL[r.status]}</span></td>
                  <td className="px-4 py-3 text-text-mid whitespace-nowrap">{r.created_by?.name || ownerName}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={(e) => { e.stopPropagation(); void download(r.id); }} disabled={busy === r.id}
                      className="text-[13px] font-semibold text-[#1e3a8a] hover:underline disabled:opacity-60 whitespace-nowrap">
                      {busy === r.id ? "Preparing…" : "PDF"}
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[13px] text-text-muted">No quotations.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
