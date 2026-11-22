"use client";

// Invoices — the company's GST invoices (epc_invoices, 0129; Partner Portal v2,
// paid — Invoices subscription): filter by status, search, download the PDF,
// cancel (Owner / Admin, with a reason) and re-issue a cancelled one (a new
// number). Issued from a project (Installation done or later). Viewers read and
// download; Sales see the invoices of their own projects; never Site staff.
// The demo EPC only for now (portalV2).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NAVY } from "@/components/partner/PartnerShell";
import { input } from "@/components/quotation/form-kit";
import { InvoiceForm, CancelInvoice, PaidButton } from "@/components/partner/ProjectInvoices";
import { getBusiness } from "@/lib/auth";
import { canManageOrg, canWork, isSiteStaff, portalV2 } from "@/lib/epc-roles";
import { fetchSubscription, hasFeature } from "@/lib/subscription";
import { fmtDate } from "@/lib/dates";
import { fmtRupees } from "@/lib/money";
import {
  fetchInvoices, fetchBillTo, canReissue, downloadInvoicePdf,
  INVOICE_STATUSES, INVOICE_STATUS_LABEL, INVOICE_STATUS_PILL, type BillTo, type InvoiceRow, type InvoiceStatus,
} from "@/lib/invoices";

type Filter = "all" | InvoiceStatus;

export default function InvoicesPage() {
  const router = useRouter();
  const me = getBusiness();
  const allowed = portalV2(me) && !isSiteStaff(me);
  const work = canWork(me), manage = canManageOrg(me);
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [on, setOn] = useState(false); // the Invoices subscription (re-issue)
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<InvoiceRow | null>(null);
  const [reissuing, setReissuing] = useState<{ invoice: InvoiceRow; start: BillTo } | null>(null);

  useEffect(() => { if (!allowed) router.replace("/dashboard" as any); }, [allowed, router]);
  useEffect(() => {
    if (!allowed) return;
    fetchInvoices().then(setRows, () => setFailed(true));
    if (work) fetchSubscription().then((s) => setOn(hasFeature(s, "invoices")), () => {});
  }, [allowed, work]);

  const count = (f: Filter) => (rows ?? []).filter((r) => f === "all" || r.status === f).length;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (filter === "all" || r.status === filter)
      && (!s || [r.invoice_no, r.customer_name].some((v) => String(v ?? "").toLowerCase().includes(s))));
  }, [rows, filter, q]);
  const put = (r: InvoiceRow) => setRows((all) => (all?.some((x) => x.id === r.id) ? all.map((x) => (x.id === r.id ? r : x)) : [r, ...(all ?? [])]));

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } catch (e) { alert((e as Error).message || "Something went wrong."); } finally { setBusy(null); }
  }

  if (!allowed) return null;
  return (
    <div className="max-w-[1150px]">
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex gap-1.5 flex-wrap">
          {(["all", ...INVOICE_STATUSES] as Filter[]).map((k) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={["px-3.5 py-1.5 rounded-full text-[13px] font-semibold border", filter === k ? "text-white border-transparent" : "bg-white border-line text-text-mid"].join(" ")}
              style={filter === k ? { background: NAVY } : undefined}>
              {k === "all" ? "All" : INVOICE_STATUS_LABEL[k]} <span className="opacity-70">{count(k)}</span>
            </button>
          ))}
        </div>
        <input className={input + " max-w-[260px] ml-auto"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, customer" />
      </div>

      {failed ? (
        <p className="text-[13px] text-red-600">Couldn&apos;t load your invoices. Please refresh.</p>
      ) : !rows ? (
        <p className="text-[13px] text-text-muted">Loading…</p>
      ) : (
        <div className="bg-white rounded-2xl border border-line overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[760px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-wide text-text-muted border-b border-line">
                <th className="px-4 py-3 font-semibold">Invoice</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold text-right">Size</th>
                <th className="px-4 py-3 font-semibold text-right">Total</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/dashboard/projects?open=${r.project_id}` as any)} className="border-b border-line last:border-0 hover:bg-bg-soft cursor-pointer">
                  <td className="px-4 py-3 font-semibold text-[#1e3a8a] whitespace-nowrap">{r.invoice_no}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDate(r.invoice_date)}</td>
                  <td className="px-4 py-3 font-medium text-text">{r.customer_name}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{r.kw ? `${+Number(r.kw).toFixed(2)} kW` : "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{fmtRupees(r.total)}</td>
                  <td className="px-4 py-3">
                    <span title={r.cancel_reason ?? undefined} className={`px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap ${INVOICE_STATUS_PILL[r.status]}`}>{INVOICE_STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-4">
                      {manage && r.status === "issued" && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setCancelling(r); }} className="text-[13px] font-semibold text-red-600 hover:underline">Cancel</button>
                      )}
                      {work && canReissue(r, rows) && (
                        <PaidButton on={on} busy={busy === `re:${r.id}`} label="Re-issue"
                          onClick={() => void act(`re:${r.id}`, async () => setReissuing({ invoice: r, start: await fetchBillTo(r.id) }))} />
                      )}
                      <button type="button" onClick={(e) => { e.stopPropagation(); void act(`pdf:${r.id}`, () => downloadInvoicePdf(r.id)); }} disabled={busy === `pdf:${r.id}`}
                        className="text-[13px] font-semibold text-[#1e3a8a] hover:underline disabled:opacity-60">
                        {busy === `pdf:${r.id}` ? "Preparing…" : "PDF"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-text-muted">No invoices.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {cancelling && <CancelInvoice invoice={cancelling} onDone={(r) => { put(r); setCancelling(null); }} onClose={() => setCancelling(null)} />}
      {reissuing && (
        <div className="fixed inset-0 z-50 bg-black/30 grid place-items-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setReissuing(null); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[680px] max-h-[92vh] overflow-y-auto">
            <InvoiceForm className="p-6" projectId={reissuing.invoice.project_id} kw={reissuing.invoice.kw} start={reissuing.start} replaces={reissuing.invoice}
              onIssued={(r) => { put(r); setReissuing(null); }} onClose={() => setReissuing(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
