"use client";

// A project's money inside the project editor (Partner Portal v2): project cost,
// received (a loan project: its lender's money too), the customer's balance due,
// when the next payment is due, every payment (from the customer or the lender)
// and a one-tap WhatsApp reminder of the customer's balance (paid) — the same
// figures as the dashboard (lib/project-payments projectMoney, 0139).
// Owner / Admin / Sales add and delete payments and set the due date; Viewers
// only see; Site staff never. The payments are one read when the project opens.

import { useEffect, useState } from "react";
import { NAVY } from "@/components/partner/PartnerShell";
import WhatsAppButton from "@/components/partner/WhatsAppButton";
import DateField from "@/components/ui/DateField";
import { input, Field, Toggle } from "@/components/quotation/form-kit";
import { getBusiness } from "@/lib/auth";
import { askConfirm } from "@/lib/confirm";
import { isSiteStaff, portalV2 } from "@/lib/epc-roles";
import { fetchWhatsAppOn } from "@/lib/subscription";
import { fmtDate, localIsoDate } from "@/lib/dates";
import { amountInput, fmtRupees } from "@/lib/money";
import type { ProjectRow } from "@/lib/projects";
import {
  fetchPayments, fetchLenderMoney, projectMoney, addPayment, deletePayment, setDueDate, remindPayment, newestFirst,
  PAY_SOURCES, PAY_SOURCE_LABEL, PAY_MODES, PAY_MODE_LABEL, type LenderMoney, type Payment, type PaySource, type PayMode,
} from "@/lib/project-payments";

type Draft = { paid_on: string; amount: string; source: PaySource; mode: PayMode | ""; reference: string; notes: string };
const blank = (p: ProjectRow): Draft => ({
  paid_on: localIsoDate(new Date()), amount: "", source: p.payment_mode === "loan" ? "lender" : "customer", mode: "", reference: "", notes: "",
});

export default function ProjectMoney({ project, canEdit, onChanged }: { project: ProjectRow; canEdit: boolean; onChanged: (r: ProjectRow) => void }) {
  const me = getBusiness();
  const show = portalV2(me) && !isSiteStaff(me);
  const [pays, setPays] = useState<Payment[] | null>(null);
  const [lender, setLender] = useState<LenderMoney | null>(null);
  const [failed, setFailed] = useState(false);
  const [wa, setWa] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dueOn, setDueOn] = useState(project.payment_due_on ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    let live = true;
    setPays(null); setLender(null); setFailed(false); setDraft(null); setError(null);
    // A project from a loan: its lender money too (in parallel; a failure just leaves it out).
    const loan = project.application_id && project.payment_mode !== "cash" ? fetchLenderMoney(project.application_id).catch(() => null) : Promise.resolve(null);
    Promise.all([fetchPayments(project.id), loan]).then(([r, l]) => { if (live) { setPays(r); setLender(l); } }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [show, project.id, project.application_id, project.payment_mode]);
  useEffect(() => setDueOn(project.payment_due_on ?? ""), [project.payment_due_on]);

  const money = pays ? projectMoney(project.project_cost, pays, lender) : null;
  const got = money?.received ?? null;
  const bal = money?.customerDue ?? null;
  const canRemind = !!project.mobile && (bal ?? 0) > 0;
  // WhatsApp (paid) — a cached read, only when there is something to remind.
  useEffect(() => { if (show && canRemind) fetchWhatsAppOn().then(setWa, () => {}); }, [show, canRemind]);

  if (!show) return null;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message || "Something went wrong."); } finally { setBusy(null); }
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = () => run("add", async () => {
    if (!draft) return;
    const p = await addPayment(project.id, {
      paid_on: draft.paid_on, amount: Number(draft.amount), source: draft.source, mode: draft.mode || null,
      reference: draft.reference, notes: draft.notes,
    });
    setPays((all) => [p, ...(all ?? [])].sort(newestFirst));
    setDraft(null);
  });

  const remove = async (p: Payment) => {
    if (!(await askConfirm(`Delete the payment of ${fmtRupees(p.amount)} on ${fmtDate(p.paid_on)}? This can't be undone.`, { danger: true }))) return;
    void run(`del:${p.id}`, async () => {
      await deletePayment(p.id);
      setPays((all) => (all ?? []).filter((x) => x.id !== p.id));
    });
  };

  const changeDue = (iso: string) => {
    const before = project.payment_due_on ?? "";
    if (iso === before) return;
    setDueOn(iso);
    void run("due", async () => {
      try { onChanged(await setDueDate(project, iso || null)); } catch (e) { setDueOn(before); throw e; }
    });
  };

  const remind = () => run("wa", () => remindPayment({ customer: project.customer_name, mobile: project.mobile, balance: bal ?? 0 }));

  const pending = !pays && !failed;
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[12.5px] font-medium text-text-mid">Payments</div>
        {canEdit && pays && !draft && (
          <button type="button" onClick={() => setDraft(blank(project))} className="text-[13px] font-semibold text-navy hover:underline">+ Add payment</button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile l="Project cost">{fmtRupees(project.project_cost)}</Tile>
        <Tile l="Received">
          {pending ? "…" : fmtRupees(got)}
          {money && money.fromLender > 0 && <div className="text-[11.5px] font-normal text-text-muted">{fmtRupees(money.fromLender)} from lender</div>}
        </Tile>
        <Tile l="Balance due">
          <div className={bal != null && bal > 0 ? "text-red-600" : undefined}>{pending ? "…" : fmtRupees(bal)}</div>
          {canRemind && <WhatsAppButton on={wa} busy={busy === "wa"} onClick={() => void remind()} label="Send reminder" className="mt-1" />}
        </Tile>
        <Tile l="Next payment due">
          {canEdit
            ? <DateField value={dueOn} onChange={changeDue} disabled={busy === "due"} className={input} ariaLabel="Next payment due" />
            : fmtDate(project.payment_due_on)}
        </Tile>
      </div>

      {draft && (
        <div className="mt-3 border border-line rounded-xl p-3.5">
          <fieldset disabled={busy === "add"} className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-3 flex gap-2 flex-wrap">
              {PAY_SOURCES.map((s) => <Toggle key={s} label={PAY_SOURCE_LABEL[s]} on={draft.source === s} onClick={() => set("source", s)} />)}
            </div>
            <Field l="Date" req>
              <DateField value={draft.paid_on} max={localIsoDate(new Date())} onChange={(v) => set("paid_on", v)} className={input} ariaLabel="Payment date" />
            </Field>
            <Field l="Amount ₹" req>
              <input className={input} inputMode="decimal" value={draft.amount} onChange={(e) => set("amount", amountInput(e.target.value))} autoFocus />
            </Field>
            <Field l="Mode">
              <select className={input} value={draft.mode} onChange={(e) => set("mode", e.target.value as PayMode | "")}>
                <option value="">—</option>
                {PAY_MODES.map((m) => <option key={m} value={m}>{PAY_MODE_LABEL[m]}</option>)}
              </select>
            </Field>
            <Field l="Reference"><input className={input} value={draft.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
            <div className="sm:col-span-2">
              <Field l="Notes"><input className={input} value={draft.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
            </div>
          </fieldset>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => { setDraft(null); setError(null); }} disabled={busy === "add"}
              className="px-3.5 py-2 rounded-xl text-[13px] font-semibold text-text-mid hover:bg-bg-soft disabled:opacity-60">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={busy === "add"}
              className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
              {busy === "add" ? "Saving…" : "Add payment"}
            </button>
          </div>
        </div>
      )}

      {failed ? (
        <p className="text-[13px] text-red-600 mt-3">Couldn&apos;t load the payments.</p>
      ) : pays && pays.length > 0 && (
        <div className="mt-3 border border-line rounded-xl divide-y divide-line">
          {pays.map((p) => (
            <div key={p.id} className="flex items-start gap-3 px-3.5 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-text">{fmtRupees(p.amount)}</div>
                <div className="text-[12px] text-text-muted break-words">
                  {[PAY_SOURCE_LABEL[p.source], p.mode && PAY_MODE_LABEL[p.mode], p.reference, p.notes].filter(Boolean).join(" · ")}
                </div>
              </div>
              <span className="text-text-mid whitespace-nowrap">{fmtDate(p.paid_on)}</span>
              {canEdit && (
                <button type="button" onClick={() => void remove(p)} disabled={!!busy} aria-label="Delete payment"
                  className="w-6 h-6 -mr-1 rounded-full text-red-600 text-[14px] font-bold grid place-items-center hover:bg-red-50 disabled:opacity-60">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-[13px] text-red-600 mt-2">{error}</p>}
    </div>
  );
}

function Tile({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line px-3.5 py-2.5 min-w-0">
      <div className="text-[11.5px] text-text-muted">{l}</div>
      <div className="text-[15px] font-semibold text-text mt-0.5">{children}</div>
    </div>
  );
}
