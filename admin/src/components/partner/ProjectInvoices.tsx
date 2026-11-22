"use client";

// A project's GST invoices inside the project editor (Partner Portal v2, paid —
// Invoices subscription; epc_invoices, 0129). Shown from Installation done on,
// never to Site staff: the project's invoices (PDF; Owner / Admin cancel with a
// reason; a cancelled one can be re-issued) and "Create invoice" for Owner /
// Admin / Sales — customer prefilled from the project (a loan project: its site
// address), amount = the project cost, the GST split shown live. Without the
// subscription the buttons stay visible with a lock. Also exports the invoice
// form, the cancel dialog and the paid button for /dashboard/invoices.

import { useEffect, useRef, useState } from "react";
import { NAVY } from "@/components/partner/PartnerShell";
import { input, Field } from "@/components/quotation/form-kit";
import DateField from "@/components/ui/DateField";
import { getBusiness } from "@/lib/auth";
import { canManageOrg, isSiteStaff, portalV2 } from "@/lib/epc-roles";
import { fetchSubscription, hasFeature, SUBSCRIPTION_MSG } from "@/lib/subscription";
import { fetchKyc, fetchOrgSettings } from "@/lib/org-settings";
import { INDIA_STATES, stateOfGstin } from "@/lib/india-states";
import { localIsoDate, fmtDate } from "@/lib/dates";
import { amountInput, fmtRupees } from "@/lib/money";
import { invoiceFigures } from "@/lib/invoice-calc";
import { PROJECT_STAGES, type ProjectRow } from "@/lib/projects";
import {
  fetchProjectInvoices, fetchBillTo, fetchSiteAddress, issueInvoice, cancelInvoice, canReissue, downloadInvoicePdf,
  INVOICE_STATUS_LABEL, INVOICE_STATUS_PILL, type BillTo, type InvoiceRow,
} from "@/lib/invoices";

/** A paid-feature action: a link-style button, or a lock with SUBSCRIPTION_MSG without the subscription. */
export function PaidButton({ on, busy, label, onClick, className = "" }: { on: boolean; busy?: boolean; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); if (on) onClick(); }} disabled={!on || busy}
      title={on ? undefined : SUBSCRIPTION_MSG}
      className={["inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap disabled:opacity-60",
        on ? "text-[#1e3a8a] hover:underline" : "text-text-muted cursor-not-allowed", className].join(" ")}>
      {!on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>}
      {label}
    </button>
  );
}

// The EPC's own state (its GSTIN's) — CGST + SGST vs IGST. Both reads are cached for the session.
const epcStateOf = () => Promise.all([fetchOrgSettings(), fetchKyc()])
  .then(([org, kyc]) => stateOfGstin(kyc.gstin_number) || org.state || "", () => "");
const knownState = (s: string | null | undefined) => INDIA_STATES.find((x) => x.toLowerCase() === String(s ?? "").trim().toLowerCase()) ?? "";

type Draft = { customer_name: string; customer_address: string; customer_gstin: string; customer_state: string; amount: string; invoice_date: string };

/** A new invoice, or a cancelled one issued again (replaces). */
export function InvoiceForm({ projectId, kw, start, applicationId, replaces, onIssued, onClose, className = "rounded-2xl border border-line p-4 sm:p-5" }: {
  projectId: string; kw: number | null; start: Partial<BillTo>;
  applicationId?: string | null;   // a loan project: its site address fills the address
  replaces?: InvoiceRow | null;
  onIssued: (r: InvoiceRow) => void; onClose: () => void;
  className?: string;
}) {
  const today = localIsoDate(new Date());
  const [d, setD] = useState<Draft>(() => ({
    customer_name: start.customer_name ?? "", customer_address: start.customer_address ?? "",
    customer_gstin: start.customer_gstin ?? "", customer_state: knownState(start.customer_state),
    amount: start.amount ? String(start.amount) : "", invoice_date: today,
  }));
  const [epcState, setEpcState] = useState<string | null>(null); // null until read
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touched = useRef<Set<keyof Draft>>(new Set());
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { touched.current.add(k); setD((x) => ({ ...x, [k]: v })); };
  // Fill in what wasn't typed yet: a loan project's site address and state, else the EPC's own state.
  useEffect(() => {
    void Promise.all([epcStateOf(), applicationId ? fetchSiteAddress(applicationId).catch(() => null) : null]).then(([own, site]) => {
      setEpcState(own);
      const patch: Partial<Draft> = { customer_address: site?.address, customer_state: knownState(site?.state) || (start.customer_state ? "" : own) };
      setD((x) => ({ ...x, ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => v && !touched.current.has(k as keyof Draft))) }));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fig = invoiceFigures(Number(d.amount) || 0, d.customer_state, epcState, kw);

  async function issue() {
    if (!d.invoice_date) { setError("Enter the invoice date."); return; }
    setBusy(true); setError(null);
    try {
      onIssued(await issueInvoice({
        project_id: projectId, kw, invoice_date: d.invoice_date, customer_name: d.customer_name, customer_address: d.customer_address,
        customer_gstin: d.customer_gstin, customer_state: d.customer_state, amount: Number(d.amount) || 0, epcState: epcState ?? "",
        replaces_id: replaces?.id ?? null,
      }));
    } catch (e) { setError((e as Error).message || "Couldn't issue the invoice."); setBusy(false); }
  }

  const th = "px-2.5 py-2 font-semibold", td = "px-2.5 py-2 whitespace-nowrap";
  return (
    <div className={className}>
      {replaces && <div className="text-[16px] font-display font-bold text-[#0f3d2e] mb-4">Re-issue {replaces.invoice_no}</div>}
      <fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3">
        <Field l="Customer name" req><input className={input} value={d.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></Field>
        <Field l="GSTIN">
          <input className={input} value={d.customer_gstin} onChange={(e) => {
            const g = e.target.value.toUpperCase().replace(/\s/g, "").slice(0, 15);
            set("customer_gstin", g);
            if (g.length >= 2 && stateOfGstin(g)) set("customer_state", stateOfGstin(g));
          }} />
        </Field>
        <div className="sm:col-span-2">
          <Field l="Address"><textarea className={input + " min-h-[60px]"} value={d.customer_address} onChange={(e) => set("customer_address", e.target.value)} /></Field>
        </div>
        <Field l="State">
          <select className={input} value={d.customer_state} onChange={(e) => set("customer_state", e.target.value)}>
            <option value="">—</option>
            {INDIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field l="Invoice date" req><DateField value={d.invoice_date} onChange={(v) => set("invoice_date", v)} max={today} className={input} /></Field>
        <Field l="Amount ₹ (incl. GST)" req><input className={input} inputMode="decimal" value={d.amount} onChange={(e) => set("amount", amountInput(e.target.value))} /></Field>
      </fieldset>

      {/* The GST split, live */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-[13px] min-w-[520px]">
          <thead>
            <tr className="text-left text-[11.5px] uppercase tracking-wide text-text-muted border-b border-line">
              <th className={th}>HSN/SAC</th>
              <th className={th + " text-right"}>Taxable</th>
              <th className={th + " text-right"}>GST</th>
              {fig.intra ? <><th className={th + " text-right"}>CGST</th><th className={th + " text-right"}>SGST</th></> : <th className={th + " text-right"}>IGST</th>}
              <th className={th + " text-right"}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {fig.lines.map((l) => (
              <tr key={l.hsn} className="border-b border-line">
                <td className={td}>{l.hsn}</td>
                <td className={td + " text-right"}>{fmtRupees(l.taxable)}</td>
                <td className={td + " text-right"}>{l.rate}%</td>
                {fig.intra ? <><td className={td + " text-right"}>{fmtRupees(l.cgst)}</td><td className={td + " text-right"}>{fmtRupees(l.sgst)}</td></> : <td className={td + " text-right"}>{fmtRupees(l.igst)}</td>}
                <td className={td + " text-right"}>{fmtRupees(l.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td}>Total</td>
              <td className={td + " text-right"}>{fmtRupees(fig.taxable)}</td>
              <td className={td} />
              {fig.intra ? <><td className={td + " text-right"}>{fmtRupees(fig.cgst)}</td><td className={td + " text-right"}>{fmtRupees(fig.sgst)}</td></> : <td className={td + " text-right"}>{fmtRupees(fig.igst)}</td>}
              <td className={td + " text-right"}>{fmtRupees(fig.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}
      <div className="flex items-center gap-2 mt-4">
        <button type="button" onClick={onClose} disabled={busy} className="ml-auto px-4 py-2 rounded-xl text-[13.5px] font-semibold text-text-mid hover:bg-bg-soft">Cancel</button>
        <button type="button" onClick={() => void issue()} disabled={busy || epcState === null} className="px-5 py-2 rounded-xl text-white text-[13.5px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
          {busy ? "Issuing…" : replaces ? "Re-issue" : "Issue invoice"}
        </button>
      </div>
    </div>
  );
}

/** Owner / Admin: cancel an issued invoice, with the reason (it stays, marked cancelled). */
export function CancelInvoice({ invoice, onDone, onClose }: { invoice: InvoiceRow; onDone: (r: InvoiceRow) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (!reason.trim()) { setError("Enter the reason."); return; }
    setBusy(true); setError(null);
    try { onDone(await cancelInvoice(invoice, reason)); }
    catch (e) { setError((e as Error).message || "Couldn't cancel the invoice."); setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-[60] bg-black/30 grid place-items-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[440px] p-6">
        <div className="text-[16px] font-display font-bold text-[#0f3d2e] mb-4">Cancel {invoice.invoice_no}</div>
        <Field l="Reason" req><textarea className={input + " min-h-[80px]"} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}
        <div className="flex items-center gap-2 mt-5">
          <button type="button" onClick={onClose} disabled={busy} className="ml-auto px-4 py-2.5 rounded-xl text-[13.5px] font-semibold text-text-mid hover:bg-bg-soft">Close</button>
          <button type="button" onClick={() => void go()} disabled={busy} className="px-5 py-2.5 rounded-xl text-white text-[13.5px] font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-60">
            {busy ? "Cancelling…" : "Cancel invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectInvoices({ project, canIssue }: { project: ProjectRow; canIssue: boolean }) {
  const me = getBusiness();
  const installed = PROJECT_STAGES.indexOf(project.stage) >= PROJECT_STAGES.indexOf("installation_done");
  const show = portalV2(me) && !isSiteStaff(me) && installed; // invoices exist only from Installation done
  const manage = canManageOrg(me);
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [on, setOn] = useState(false);
  const [form, setForm] = useState<{ start: Partial<BillTo>; replaces: InvoiceRow | null } | null>(null);
  const [cancelling, setCancelling] = useState<InvoiceRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    fetchProjectInvoices(project.id).then(setRows, (e) => { setRows([]); setError((e as Error).message); });
    if (canIssue) fetchSubscription().then((s) => setOn(hasFeature(s, "invoices")), () => {});
  }, [show, project.id, canIssue]);
  if (!show) return null;

  const put = (r: InvoiceRow) => setRows((all) => (all?.some((x) => x.id === r.id) ? all.map((x) => (x.id === r.id ? r : x)) : [r, ...(all ?? [])]));
  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message || "Something went wrong."); } finally { setBusy(null); }
  }
  const create = () => setForm({ replaces: null, start: { customer_name: project.customer_name, customer_address: project.city ?? "", amount: project.project_cost ?? 0 } });
  const reissue = (r: InvoiceRow) => act(`re:${r.id}`, async () => setForm({ replaces: r, start: await fetchBillTo(r.id) }));

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[12.5px] font-medium text-text-mid">Invoices</div>
        {canIssue && !form && <PaidButton on={on} label="+ Create invoice" onClick={create} />}
      </div>
      {rows && rows.length > 0 && (
        <div className="rounded-xl border border-line divide-y divide-line">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 flex-wrap px-3.5 py-2.5 text-[13px]">
              <span className="font-semibold text-[#1e3a8a] whitespace-nowrap">{r.invoice_no}</span>
              <span className="text-text-muted whitespace-nowrap">{fmtDate(r.invoice_date)}</span>
              <span className="ml-auto font-semibold whitespace-nowrap">{fmtRupees(r.total)}</span>
              <span title={r.cancel_reason ?? undefined} className={`px-2.5 py-0.5 rounded-full text-[12px] font-semibold ${INVOICE_STATUS_PILL[r.status]}`}>{INVOICE_STATUS_LABEL[r.status]}</span>
              <button type="button" onClick={() => void act(`pdf:${r.id}`, () => downloadInvoicePdf(r.id))} disabled={busy === `pdf:${r.id}`}
                className="text-[13px] font-semibold text-[#1e3a8a] hover:underline disabled:opacity-60">{busy === `pdf:${r.id}` ? "Preparing…" : "PDF"}</button>
              {manage && r.status === "issued" && (
                <button type="button" onClick={() => setCancelling(r)} className="text-[13px] font-semibold text-red-600 hover:underline">Cancel</button>
              )}
              {canIssue && !form && canReissue(r, rows) && <PaidButton on={on} busy={busy === `re:${r.id}`} label="Re-issue" onClick={() => void reissue(r)} />}
            </div>
          ))}
        </div>
      )}
      {form && (
        <div className={rows?.length ? "mt-3" : ""}>
          <InvoiceForm projectId={project.id} kw={project.kw} start={form.start} replaces={form.replaces}
            applicationId={form.replaces ? null : project.application_id}
            onIssued={(r) => { put(r); setForm(null); }} onClose={() => setForm(null)} />
        </div>
      )}
      {error && <p className="text-[13px] text-red-600 mt-2">{error}</p>}
      {cancelling && <CancelInvoice invoice={cancelling} onDone={(r) => { put(r); setCancelling(null); }} onClose={() => setCancelling(null)} />}
    </div>
  );
}
