"use client";

// The Partner Portal v2 dashboard — the demo EPC only (portalV2), Site staff never
// (they go straight to their projects). Top to bottom: the period + Add lead / New
// quotation / Apply for loan; the business summary; the sales pipeline beside cash
// vs loan; what needs attention beside today's follow-ups; lead owners (Owner /
// Manager); customer payments due (WhatsApp reminder, paid) beside insurance due;
// the loan summary beside the relationship managers. One read per period
// (lib/dashboard-v2 → epc_dashboard, 0130) that the database scopes to the
// signed-in person's role. Every tile and row opens its list.
// Also home to the portal's dependency-free Donut (the classic home uses it too).

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { NAVY_ACCENT } from "@/components/partner/PartnerShell";
import WhatsAppButton from "@/components/partner/WhatsAppButton";
import InsuranceDue from "@/components/partner/InsuranceDue";
import { getBusiness, loanAccess, insuranceAccess } from "@/lib/auth";
import { canManageOrg, canWork, hasModule } from "@/lib/epc-roles";
import { fetchSubscription, hasFeature } from "@/lib/subscription";
import { remindPayment } from "@/lib/project-payments";
import { notify } from "@/lib/notify";
import { fmtDate, localIsoDate } from "@/lib/dates";
import { fmtRupees, inrPlain, rupeesShort } from "@/lib/money";
import { LEAD_STATUS_LABEL } from "@/lib/leads";
import { PAYMENT_LABEL, PAYMENT_MODES, type PaymentMode } from "@/lib/projects";
import {
  fetchDashboard, DASH_PERIODS, type Dashboard, type DashPeriod, type AttentionItem, type AttentionKind, type PaymentDueRow,
} from "@/lib/dashboard-v2";

/** The dashboard's Loans section filters (its chips). */
export type LoanFilter = "all" | "under_review" | "updated" | "approved" | "rejected" | "tranche_pending";
export type Rm = { name: string; phone: string };

const PERIOD_KEY = () => `cc_dash_period:${getBusiness()?.id ?? ""}`;
function savedPeriod(): DashPeriod {
  try {
    const v = localStorage.getItem(PERIOD_KEY()) as DashPeriod | null;
    return v && DASH_PERIODS.some((p) => p.key === v) ? v : "month";
  } catch { return "month"; }
}

const KIND_DOT: Record<AttentionKind, string> = {
  loan: "#dc2626", payment: "#b45309", followup: "#dc2626", insurance: "#b45309", not_insured: "#5b3fc4", stuck: "#1e3a8a",
};
const MODE_COLOR: Record<PaymentMode, string> = { cash: "#178a5c", loan: "#1e3a8a", part_loan: "#f0b429" };
const kwText = (kw: number) => `${inrPlain(Number(kw) || 0)} kW`;

const ARROW = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;

function Card({ title, onTitle, id, className = "", children }: { title: string; onTitle?: () => void; id?: string; className?: string; children: ReactNode }) {
  return (
    <div id={id} className={`bg-white rounded-2xl border border-line p-5 min-w-0 ${className}`}>
      {onTitle
        ? <button type="button" onClick={onTitle} className="flex items-center gap-1.5 text-[13px] font-semibold text-cc-ink mb-3 hover:text-navy">{title}{ARROW}</button>
        : <div className="text-[13px] font-semibold text-cc-ink mb-3">{title}</div>}
      {children}
    </div>
  );
}

export default function DashboardV2({ rms, onQuotation, onLoans, onInsurance, onRenew, renewing, onOpenMessage }: {
  rms: Rm[];
  onQuotation: () => void;               // the company's quotation builder
  onLoans: (f: LoanFilter) => void;      // the dashboard's Loans section, filtered
  onInsurance: (due: boolean) => void;   // the Insurance section (due = Due for renewal)
  onRenew: () => void; renewing: boolean; // a new insurance application
  onOpenMessage: (loanId: string) => void; // CC's message on a loan
}) {
  const router = useRouter();
  const go = (href: string) => router.push(href);
  const me = getBusiness();
  const work = canWork(me), manage = canManageOrg(me);
  const seeLoans = loanAccess(me) && hasModule(me, "loans");
  const seeIns = insuranceAccess(me) && hasModule(me, "insurance");
  const quotes = hasModule(me, "quotes");

  const [period, setPeriod] = useState<DashPeriod>(savedPeriod);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true); setFailed(false);
    fetchDashboard(period)
      .then((d) => { if (live) setData(d); }, () => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [period]);
  function pick(p: DashPeriod) {
    setPeriod(p);
    try { localStorage.setItem(PERIOD_KEY(), p); } catch { /* best effort */ }
  }

  // WhatsApp (paid) — read only when there is a payment to remind about.
  const [wa, setWa] = useState(false);
  const hasDue = !!data?.payments_due.length;
  useEffect(() => { if (hasDue && work) fetchSubscription().then((s) => setWa(hasFeature(s, "whatsapp")), () => {}); }, [hasDue, work]);
  const [reminding, setReminding] = useState<string | null>(null);
  async function remind(p: PaymentDueRow) {
    setReminding(p.id);
    try { await remindPayment({ customer: p.customer, mobile: p.mobile, balance: p.balance }); }
    catch (e) { notify.error((e as Error).message || "Couldn't send the reminder."); }
    finally { setReminding(null); }
  }

  function openItem(a: AttentionItem) {
    if (a.kind === "loan") onOpenMessage(a.id);
    else if (a.kind === "followup") go("/dashboard/leads?f=due");
    else if (a.kind === "insurance") onInsurance(true);
    else go(`/dashboard/projects?open=${a.id}`);
  }
  const toPayments = () => {
    const el = document.getElementById("cc-payments-due");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); else go("/dashboard/projects");
  };

  const today = localIsoDate(new Date());
  const d = data;
  const dash = (v: string) => (d ? v : "…");
  const attention = (d?.attention ?? []).filter((a) => (a.kind === "insurance" || a.kind === "not_insured" ? seeIns : a.kind === "loan" ? seeLoans : true));

  const tiles: { label: string; value: string; tone: string; onClick: () => void }[] = [
    { label: "Total project value", value: dash(rupeesShort(d?.summary.project_value ?? 0)), tone: "text-cc-ink", onClick: () => go("/dashboard/projects") },
    { label: "Projects confirmed", value: dash(String(d?.summary.projects ?? 0)), tone: "text-cc-ink", onClick: () => go("/dashboard/projects") },
    { label: "Capacity", value: dash(kwText(d?.summary.kw ?? 0)), tone: "text-cc-ink", onClick: () => go("/dashboard/projects") },
    { label: "Amount received", value: dash(rupeesShort(d?.summary.received ?? 0)), tone: "text-cc-green", onClick: () => go("/dashboard/projects") },
    { label: "Amount pending", value: dash(rupeesShort(d?.summary.pending ?? 0)), tone: "text-warn-ink", onClick: toPayments },
  ];

  const p = d?.pipeline;
  const funnel: { rows: { label: string; n: number; open: () => void }[]; color: string }[] = [
    { color: NAVY_ACCENT, rows: [
      { label: "Leads", n: p?.leads ?? 0, open: () => go("/dashboard/leads") },
      { label: LEAD_STATUS_LABEL.contacted, n: p?.contacted ?? 0, open: () => go("/dashboard/leads?f=contacted") },
      { label: LEAD_STATUS_LABEL.quoted, n: p?.quoted ?? 0, open: () => go("/dashboard/leads?f=quoted") },
      { label: LEAD_STATUS_LABEL.won, n: p?.won ?? 0, open: () => go("/dashboard/leads?f=won") },
    ] },
    ...(seeLoans ? [{ color: "#178a5c", rows: [
      { label: "Loans filed", n: p?.loans_filed ?? 0, open: () => onLoans("all") },
      { label: "Approved", n: p?.approved ?? 0, open: () => onLoans("approved") },
      { label: "1st tranche", n: p?.first_tranche ?? 0, open: () => onLoans("approved") },
      { label: "2nd tranche pending", n: p?.second_pending ?? 0, open: () => onLoans("tranche_pending") },
    ] }] : []),
  ];

  const segs = PAYMENT_MODES.map((m) => ({ mode: m, label: PAYMENT_LABEL[m], value: d?.split[m].count ?? 0, amount: d?.split[m].value ?? 0, color: MODE_COLOR[m] }));
  const l = d?.loans;
  const loanTiles: { label: string; value: string; f: LoanFilter }[] = [
    { label: "Under review", value: dash(String(l?.under_review ?? 0)), f: "under_review" },
    { label: "Updated", value: dash(String(l?.updated ?? 0)), f: "updated" },
    { label: "Approved", value: dash(String(l?.approved ?? 0)), f: "approved" },
    { label: "Rejected", value: dash(String(l?.rejected ?? 0)), f: "rejected" },
    { label: "Sanctioned", value: dash(rupeesShort(l?.sanctioned ?? 0)), f: "approved" },
    { label: "Disbursed", value: dash(rupeesShort(l?.disbursed ?? 0)), f: "approved" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Start something (left) + the period (right) */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {work && (
            <button type="button" onClick={() => go("/dashboard/leads?new=1")}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-[13.5px] font-semibold shadow-sm hover:brightness-110 active:scale-[0.98] transition"
              style={{ background: NAVY_ACCENT }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              Add lead
            </button>
          )}
          {work && quotes && (
            <button type="button" onClick={onQuotation}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-navy text-navy text-[13.5px] font-semibold hover:bg-navy/[0.06] active:scale-[0.98] transition">
              New quotation
            </button>
          )}
          {work && seeLoans && (
            <button type="button" onClick={() => go("/dashboard/apply/chat")}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-navy text-navy text-[13.5px] font-semibold hover:bg-navy/[0.06] active:scale-[0.98] transition">
              Apply for loan
            </button>
          )}
        </div>
        <div className="relative shrink-0">
          <select value={period} onChange={(e) => pick(e.target.value as DashPeriod)}
            className="appearance-none bg-white border border-line rounded-xl pl-3.5 pr-9 py-2 text-[13px] font-semibold text-cc-ink cursor-pointer hover:border-navy focus:outline-none focus:border-navy">
            {DASH_PERIODS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a8a76" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </div>
      </div>

      {failed && <p className="text-[13px] text-red-600">Couldn&apos;t load your dashboard. Please refresh.</p>}

      <div className={["flex flex-col gap-5 transition-opacity", loading && d ? "opacity-60" : ""].join(" ")}>
        {/* Business summary */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {tiles.map((t) => (
            <button key={t.label} type="button" onClick={t.onClick}
              className="bg-white rounded-2xl border border-line px-4 py-3.5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all duration-150">
              <div className="text-[11.5px] text-text-muted">{t.label}</div>
              <div className={`text-[22px] font-bold mt-0.5 tabular-nums truncate ${t.tone}`}>{t.value}</div>
            </button>
          ))}
        </div>

        {/* Sales pipeline · cash vs loan */}
        <div className="grid lg:grid-cols-3 gap-5">
          <Card title="Sales pipeline" className="lg:col-span-2">
            <div className="flex flex-col gap-4">
              {funnel.map((g, gi) => {
                const max = Math.max(1, ...g.rows.map((r) => r.n));
                return (
                  <div key={gi} className={gi > 0 ? "pt-4 border-t border-line" : ""}>
                    {g.rows.map((r) => (
                      <button key={r.label} type="button" onClick={r.open}
                        className="w-full grid grid-cols-[minmax(0,140px)_1fr_48px] items-center gap-3 py-1.5 text-left rounded-lg hover:bg-navy-mist px-1.5">
                        <span className="text-[13px] text-text-mid truncate">{r.label}</span>
                        <span className="h-2.5 rounded-full bg-grey-chip overflow-hidden">
                          <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${(r.n / max) * 100}%`, background: g.color }} />
                        </span>
                        <span className="text-[14px] font-bold text-cc-ink tabular-nums text-right">{dash(String(r.n))}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Cash vs loan" onTitle={() => go("/dashboard/projects")}>
            <div className="flex flex-col items-center gap-4">
              <Donut segments={segs} size={150} stroke={18} unit="Projects" />
              <div className="w-full flex flex-col gap-2.5">
                {segs.map((s) => (
                  <div key={s.mode} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="text-[13px] text-text-mid flex-1">{s.label}</span>
                    <span className="text-[12px] text-text-muted tabular-nums">{dash(rupeesShort(s.amount))}</span>
                    <span className="text-[14px] font-bold text-cc-ink tabular-nums w-8 text-right">{dash(String(s.value))}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Needs your attention · today's follow-ups */}
        <div className="grid lg:grid-cols-2 gap-5">
          <Card title="Needs your attention">
            {!d ? <div className="text-[13px] text-text-muted">{failed ? "—" : "Loading…"}</div>
              : attention.length === 0 ? <div className="text-[13px] text-text-muted">You&apos;re all caught up.</div>
              : (
                <div className="flex flex-col gap-2">
                  {attention.map((a) => (
                    <button key={`${a.kind}.${a.id}`} type="button" onClick={() => openItem(a)}
                      className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5 hover:bg-navy-mist text-left">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: KIND_DOT[a.kind] }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-semibold text-text truncate">{a.title}</span>
                        <span className="block text-[11.5px] text-text-muted truncate">{a.detail}{a.amount != null ? ` · ${fmtRupees(a.amount)}` : ""}</span>
                      </span>
                      <span className="text-text-muted shrink-0">{ARROW}</span>
                    </button>
                  ))}
                </div>
              )}
          </Card>

          <Card title="Today's follow-ups" onTitle={() => go("/dashboard/leads?f=due")}>
            {!d ? <div className="text-[13px] text-text-muted">{failed ? "—" : "Loading…"}</div>
              : d.followups_today.length === 0 ? <div className="text-[13px] text-text-muted">No follow-ups due.</div>
              : (
                <div className="flex flex-col gap-2">
                  {d.followups_today.map((f) => (
                    <button key={f.id} type="button" onClick={() => go("/dashboard/leads?f=due")}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5 hover:bg-navy-mist text-left">
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold text-text truncate">{f.name}</span>
                        <span className="block text-[11.5px] text-text-muted truncate">
                          {[f.mobile ? `+91 ${f.mobile}` : null, manage ? f.owner : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className={`shrink-0 text-[12px] font-semibold whitespace-nowrap ${f.follow_up_at < today ? "text-red-600" : "text-amber-700"}`}>{fmtDate(f.follow_up_at)}</span>
                    </button>
                  ))}
                </div>
              )}
          </Card>
        </div>

        {/* Lead owners (Owner / Manager) */}
        {manage && !!d?.lead_owners.length && (
          <Card title="Lead owners">
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[13.5px] min-w-[420px]">
                <thead>
                  <tr className="text-left text-[12px] text-text-muted border-b border-line">
                    <th className="px-2 py-2 font-medium">Owner</th>
                    <th className="px-2 py-2 font-medium text-right">Leads</th>
                    <th className="px-2 py-2 font-medium text-right">Won</th>
                    <th className="px-2 py-2 font-medium text-right">Follow-ups due</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lead_owners.map((o) => (
                    <tr key={o.member_id ?? "company"} onClick={() => go(`/dashboard/leads?owner=${o.member_id ?? "company"}`)}
                      className="border-b border-line last:border-0 hover:bg-bg-soft cursor-pointer">
                      <td className="px-2 py-2.5 font-medium text-text">{o.name}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{o.leads}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-cc-green font-semibold">{o.won}</td>
                      <td className={`px-2 py-2.5 text-right tabular-nums ${o.due > 0 ? "text-red-600 font-semibold" : "text-text-mid"}`}>{o.due}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Customer payments due · insurance due */}
        <div className={`grid gap-5 ${seeIns ? "lg:grid-cols-3" : ""}`}>
          <Card title="Customer payments due" id="cc-payments-due" className={`scroll-mt-4 ${seeIns ? "lg:col-span-2" : ""}`}>
            {!d ? <div className="text-[13px] text-text-muted">{failed ? "—" : "Loading…"}</div>
              : d.payments_due.length === 0 ? <div className="text-[13px] text-text-muted">No payments due.</div>
              : (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto -mx-1">
                  <table className="w-full text-[13.5px] min-w-[620px]">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-left text-[12px] text-text-muted border-b border-line">
                        <th className="px-2 py-2 font-medium">Customer</th>
                        <th className="px-2 py-2 font-medium text-right">Project cost</th>
                        <th className="px-2 py-2 font-medium text-right">Received</th>
                        <th className="px-2 py-2 font-medium text-right">Balance</th>
                        <th className="px-2 py-2 font-medium">Due on</th>
                        {work && <th className="px-2 py-2 font-medium">Send reminder</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {d.payments_due.map((r) => (
                        <tr key={r.id} onClick={() => go(`/dashboard/projects?open=${r.id}`)} className="border-b border-line last:border-0 hover:bg-bg-soft cursor-pointer">
                          <td className="px-2 py-2.5">
                            <div className="font-medium text-text">{r.customer}</div>
                            {r.mobile && <div className="text-[11.5px] text-text-muted">+91 {r.mobile}</div>}
                          </td>
                          <td className="px-2 py-2.5 text-right whitespace-nowrap">{fmtRupees(r.cost)}</td>
                          <td className="px-2 py-2.5 text-right whitespace-nowrap text-cc-green">{fmtRupees(r.received)}</td>
                          <td className="px-2 py-2.5 text-right whitespace-nowrap font-semibold text-cc-ink">{fmtRupees(r.balance)}</td>
                          <td className={`px-2 py-2.5 whitespace-nowrap ${r.due_on && r.due_on < today ? "text-red-600 font-semibold" : "text-text-mid"}`}>{fmtDate(r.due_on)}</td>
                          {work && (
                            <td className="px-2 py-2.5">
                              {r.mobile && <WhatsAppButton on={wa} busy={reminding === r.id} onClick={() => void remind(r)} label="Send reminder" />}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>

          {seeIns && (
            <InsuranceDue rows={d?.insurance_due ?? []} loading={!d && !failed}
              onOpen={(id) => go(`/dashboard/insurance/${id}/step-1`)} onAll={() => onInsurance(true)}
              onRenew={work ? onRenew : null} renewing={renewing} />
          )}
        </div>

        {/* Loan summary · relationship managers */}
        <div className="grid lg:grid-cols-3 gap-5">
          {seeLoans && (
            <Card title="Loans" onTitle={() => onLoans("all")} className="lg:col-span-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                {loanTiles.map((t) => (
                  <button key={t.label} type="button" onClick={() => onLoans(t.f)}
                    className="rounded-xl bg-bg-soft px-3.5 py-3 text-left hover:bg-navy-wash transition-colors">
                    <div className="text-[11.5px] text-text-muted">{t.label}</div>
                    <div className="text-[18px] font-bold text-cc-ink mt-0.5 tabular-nums truncate">{t.value}</div>
                  </button>
                ))}
              </div>
            </Card>
          )}

          <Card title="Your relationship managers">
            <div className="flex flex-col gap-3">
              {rms.map((rm) => (
                <a key={rm.phone} href={`tel:+${rm.phone}`} className="flex items-center gap-3 rounded-xl hover:bg-navy-mist -mx-1.5 px-1.5 py-1">
                  <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-[13px] shrink-0" style={{ background: NAVY_ACCENT }}>{rm.name.slice(0, 1)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-text truncate">{rm.name}</div>
                    <div className="text-[11px] text-text-muted">+{rm.phone}</div>
                  </div>
                </a>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Premium dependency-free donut: separated rounded segments, hover to focus a
// slice (others dim + the centre swaps to that slice's count/label).
export function Donut({ segments, size = 176, stroke = 22, unit = "Files" }: {
  segments: { label: string; value: number; color: string }[]; size?: number; stroke?: number; unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const nonZero = segments.filter((s) => s.value > 0).length;
  const gap = nonZero > 1 ? stroke + 6 : 0; // clean separation that survives round caps
  let acc = 0;
  const centre = hover != null && segments[hover] ? { big: String(segments[hover].value), small: segments[hover].label } : { big: String(total), small: unit };
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef1f0" strokeWidth={stroke} />
          {total > 0 && segments.map((s, i) => {
            if (s.value <= 0) return null;
            const frac = s.value / total;
            const len = Math.max(0.01, frac * C - gap);
            const el = (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
                strokeWidth={hover === i ? stroke + 4 : stroke} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} strokeLinecap="round"
                style={{ transition: "stroke-width .15s ease, opacity .15s ease", opacity: hover == null || hover === i ? 1 : 0.35, cursor: "pointer" }}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            );
            acc += frac * C;
            return el;
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-[28px] font-bold text-cc-ink leading-none tabular-nums">{centre.big}</div>
        <div className="text-[11px] text-text-muted mt-1 max-w-[90px] text-center truncate">{centre.small}</div>
      </div>
    </div>
  );
}
