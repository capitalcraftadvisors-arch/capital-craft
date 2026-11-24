"use client";

// gozerobils Leads — /admin/gozerobils (main admin only).
//
// Solar enquiries from the gozerobils.com form (gozerobils_leads, migration
// 0123), saved by POST /api/gozerobils/leads, worked by phone (0132):
//   All leads — the list; a lead opens with its details, status, next
//               follow-up, notes and its calls
//   My Day    — follow-ups overdue / due today and the new leads not called yet,
//               each with Call, WhatsApp and Log call
//   Calls     — every call logged, newest first (read when the tab opens)
//   Traffic   — the website's visits (gzb_events, 0134): the last 14 days, one
//               line a day (read when the tab opens); a day opens its visits
// A logged call (outcome, note, next follow-up) updates its lead in the
// database (trigger) and here in place — the list is one query on open, cached
// like the other lists; nothing is fetched again.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar, { ACCENTS, SectionMark, themeStyle } from "@/components/AdminSidebar";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import DateField from "@/components/ui/DateField";
import Modal, { OVERLAY } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { getCached, setCached, invalidate } from "@/lib/list-cache";
import { fmtDate, fmtDateTime, fmtTime, localIsoDate } from "@/lib/dates";
import { notify } from "@/lib/notify";
import { waUrl } from "@/lib/wa-link";
import { LEAD_STATUS_OPTIONS, LEAD_STATUS_PILL } from "@/lib/lead-status";

type Lead = {
  id: string; created_at: string;
  name: string | null; mobile: string;
  pincode: string | null; city: string | null; state: string | null;
  monthly_bill: string | null; looking_for: string | null; timeline: string | null;
  utm_source: string | null; utm_campaign: string | null;
  status: string; notes: string | null;
  follow_up_at: string | null; last_call_at: string | null; last_outcome: string | null; call_count: number;
};
type Call = { id: string; lead_id: string; called_at: string; outcome: Outcome; note: string | null; next_follow_up: string | null; lead?: { name: string | null; mobile: string } | null };

const OUTCOMES = ["connected", "interested", "call_back", "not_interested", "no_answer", "busy", "switched_off", "wrong_number"] as const;
type Outcome = (typeof OUTCOMES)[number];
const OUTCOME_LABEL: Record<Outcome, string> = {
  connected: "Connected", interested: "Interested", call_back: "Call back", not_interested: "Not interested",
  no_answer: "No answer", busy: "Busy", switched_off: "Switched off", wrong_number: "Wrong number",
};
// The next follow-up a call suggests (days from today; null = none) and the status it suggests.
const NEXT_IN: Record<Outcome, number | null> = {
  connected: 3, interested: 2, call_back: 1, not_interested: null, no_answer: 1, busy: 1, switched_off: 1, wrong_number: null,
};
const CLOSES: Outcome[] = ["not_interested", "wrong_number"];
const OPEN = (s: string) => s !== "converted" && s !== "closed";

const COLS = "id, created_at, name, mobile, pincode, city, state, monthly_bill, looking_for, timeline, utm_source, utm_campaign, status, notes, " +
  "follow_up_at, last_call_at, last_outcome, call_count";
const CK = "dash.gzb";
const th = "px-3 py-3 font-medium text-[12px] uppercase tracking-wide";
const inDays = (n: number) => localIsoDate(new Date(Date.now() + n * 86_400_000));
// The form's choice keys as words: "premium_solar_system_with_expert_installation" → "Premium solar system with expert installation".
const words = (v: string | null) => (v ? v.replace(/_+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()) : v);
const tel = (m: string) => `tel:+91${m}`;

type Tab = "leads" | "myday" | "calls" | "traffic";

export default function GozerobilsLeadsPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const allowed = isMainAdmin(getBusiness());
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("myday");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Lead | null>(null);   // the lead window
  const [logFor, setLogFor] = useState<Lead | null>(null); // the Log call window
  const [calls, setCalls] = useState<Call[] | null>(null); // the Calls tab (read when opened)
  const [lastCall, setLastCall] = useState<Call | null>(null); // the call just logged — into an open lead window

  useEffect(() => {
    if (!allowed) { router.replace("/admin"); return; }
    void (async () => {
      const cached = getCached<Lead[]>(CK, 45000);
      if (cached) { setRows(cached); return; }
      const { data, error: e } = await supabase().from("gozerobils_leads").select(COLS).order("created_at", { ascending: false });
      const list = (data ?? []) as unknown as Lead[];
      setError(e ? e.message : null);
      setRows(list);
      if (!e) setCached(CK, list);
    })();
  }, [allowed, router]);

  useEffect(() => {
    if (tab !== "calls" || calls) return;
    void supabase().from("gozerobils_lead_calls")
      .select("id, lead_id, called_at, outcome, note, next_follow_up, lead:gozerobils_leads(name, mobile)")
      .order("called_at", { ascending: false }).limit(200)
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        setCalls(((data ?? []) as unknown as (Call & { lead: Call["lead"] | Call["lead"][] })[])
          .map((c) => ({ ...c, lead: Array.isArray(c.lead) ? c.lead[0] ?? null : c.lead })));
      });
  }, [tab, calls]);

  // One lead changed here — the list, the open window and the cache follow.
  function patch(id: string, p: Partial<Lead>) {
    setRows((rs) => (rs ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)));
    setOpen((o) => (o && o.id === id ? { ...o, ...p } : o));
    invalidate(CK);
  }
  async function update(r: Lead, p: Partial<Lead>) {
    setBusy(r.id);
    const { error: e } = await supabase().from("gozerobils_leads").update(p).eq("id", r.id);
    setBusy(null);
    if (e) { notify.error("Couldn't save: " + e.message); return false; }
    patch(r.id, p);
    return true;
  }
  function logged(r: Lead, c: Call, status: string) {
    patch(r.id, { last_call_at: c.called_at, last_outcome: c.outcome, call_count: r.call_count + 1, follow_up_at: c.next_follow_up, status });
    setCalls((cs) => (cs ? [{ ...c, lead: { name: r.name, mobile: r.mobile } }, ...cs] : cs));
    setLastCall(c);
  }

  const today = localIsoDate(new Date());
  const day = useMemo(() => {
    const open = (rows ?? []).filter((r) => OPEN(r.status));
    const byDate = (a: Lead, b: Lead) => String(a.follow_up_at).localeCompare(String(b.follow_up_at));
    return {
      overdue: open.filter((r) => r.follow_up_at && r.follow_up_at < today).sort(byDate),
      today: open.filter((r) => r.follow_up_at === today),
      fresh: open.filter((r) => r.status === "new" && !r.call_count && !r.follow_up_at),
    };
  }, [rows, today]);
  const dayCount = day.overdue.length + day.today.length + day.fresh.length;

  if (!allowed) return null;

  const needle = q.trim().toLowerCase();
  const filtered = (rows ?? []).filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (!needle) return true;
    return [r.name, r.mobile, r.city, r.pincode].some((v) => (v ?? "").toLowerCase().includes(needle));
  });
  const tabs: [Tab, string, number | null][] = [["myday", "My Day", dayCount], ["leads", "All leads", rows?.length ?? null], ["calls", "Calls", null], ["traffic", "Traffic", null]];

  return (
    <div className="min-h-screen lg:flex" style={themeStyle("gzb")}>
      <AdminSidebar active="gzb" />
      <div className="flex-1 min-w-0">
        <header className="px-4 sm:px-6 py-4 border-b border-line">
          <div className="flex items-center gap-3">
            <SectionMark k="gzb" />
            <h1 className="font-display text-[22px] sm:text-[26px] font-bold" style={{ color: ACCENTS.gzb.color }}>
              {ACCENTS.gzb.label}
            </h1>
          </div>
          <div className="flex gap-1.5 mt-4">
            {tabs.map(([k, label, n]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={["px-4 py-2 rounded-xl text-[13.5px] font-semibold border", tab === k ? "text-white border-transparent" : "bg-white border-line text-cc-ink"].join(" ")}
                style={tab === k ? { background: ACCENTS.gzb.color } : undefined}>
                {label}
                {n != null && n > 0 && (
                  <span className={["ml-1.5 inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-bold",
                    k === "myday" ? "bg-red-600 text-white" : tab === k ? "bg-white/25" : "bg-cc-chip text-cc-muted"].join(" ")}>{n}</span>
                )}
              </button>
            ))}
          </div>
        </header>

        <main className="px-4 sm:px-6 py-4">
          {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}

          {tab === "myday" && (
            !rows ? <p className="text-[13px] text-cc-muted">Loading…</p>
            : dayCount === 0 ? <Card className="p-8 text-center text-[14px] text-cc-muted">Nothing due today.</Card>
            : (
              <div className="flex flex-col gap-5">
                <DaySection title="Overdue" tone="text-red-600" rows={day.overdue} today={today} onOpen={setOpen} onLog={setLogFor} />
                <DaySection title="Today" tone="text-amber-700" rows={day.today} today={today} onOpen={setOpen} onLog={setLogFor} />
                <DaySection title="New, not called yet" tone="text-cc-blue" rows={day.fresh} today={today} onOpen={setOpen} onLog={setLogFor} />
              </div>
            )
          )}

          {tab === "leads" && (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="flex-1 min-w-[220px]">
                  <Input placeholder="Search by name, mobile, city or pincode…" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div className="w-[170px]">
                  <Select placeholder="Status" options={LEAD_STATUS_OPTIONS} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
                </div>
              </div>
              <Card className="overflow-x-auto cc-table-card">
                <table className="w-full text-[14px] cc-table">
                  <thead className="text-left">
                    <tr>
                      <th className={th}>Customer</th>
                      <th className={th}>Monthly bill</th>
                      <th className={th}>Looking for</th>
                      <th className={th}>Source</th>
                      <th className={th + " text-center"}>Received</th>
                      <th className={th}>Last call</th>
                      <th className={th + " text-center"}>Follow-up</th>
                      <th className={th + " text-center"}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={8} className="px-5 py-10 text-center text-cc-muted">{!rows ? "Loading…" : rows.length ? "No leads match." : "No leads yet."}</td></tr>
                    ) : filtered.map((r) => (
                      <tr key={r.id} onClick={() => setOpen(r)} className="border-b border-cc-row-line hover:bg-cc-row-hover align-top cursor-pointer">
                        <td className="px-3 py-3">
                          <p className="text-[15px] font-semibold text-cc-ink">{r.name || "—"}</p>
                          <p className="text-[12px] mt-0.5 text-cc-blue">+91 {r.mobile}</p>
                          <p className="text-[12px] text-cc-muted">{[r.city, r.pincode, r.state].filter(Boolean).join(" · ")}</p>
                        </td>
                        <td className="px-3 py-3 text-[13px] text-cc-ink">{r.monthly_bill || "—"}</td>
                        <td className="px-3 py-3 text-[13px] text-cc-ink max-w-[220px] break-words">{words(r.looking_for) || "—"}</td>
                        <td className="px-3 py-3 text-[13px] text-cc-ink">
                          <div>{r.utm_source || "—"}</div>
                          {r.utm_campaign && <div className="text-[12px] text-cc-muted">{r.utm_campaign}</div>}
                        </td>
                        <td className="px-3 py-3 text-center text-[13px] text-cc-ink whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                        <td className="px-3 py-3 text-[13px] text-cc-ink whitespace-nowrap">
                          {r.last_call_at ? <><div>{OUTCOME_LABEL[r.last_outcome as Outcome] ?? r.last_outcome}</div><div className="text-[12px] text-cc-muted">{fmtDateTime(r.last_call_at)}</div></> : "—"}
                        </td>
                        <td className={["px-3 py-3 text-center text-[13px] whitespace-nowrap", followTone(r, today)].join(" ")}>{r.follow_up_at ? fmtDate(r.follow_up_at) : "—"}</td>
                        <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <select disabled={busy === r.id} value={r.status} onChange={(e) => void update(r, { status: e.target.value })}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border-none cursor-pointer outline-none ${LEAD_STATUS_PILL[r.status] ?? LEAD_STATUS_PILL.new}`}>
                            {LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}

          {tab === "calls" && (
            <Card className="overflow-x-auto cc-table-card">
              <table className="w-full text-[14px] cc-table">
                <thead className="text-left">
                  <tr>
                    <th className={th}>When</th>
                    <th className={th}>Customer</th>
                    <th className={th}>Outcome</th>
                    <th className={th}>Note</th>
                    <th className={th + " text-center"}>Next follow-up</th>
                  </tr>
                </thead>
                <tbody>
                  {!calls || calls.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-10 text-center text-cc-muted">{!calls ? "Loading…" : "No calls yet."}</td></tr>
                  ) : calls.map((c) => {
                    const lead = rows?.find((r) => r.id === c.lead_id);
                    return (
                      <tr key={c.id} onClick={() => lead && setOpen(lead)} className="border-b border-cc-row-line hover:bg-cc-row-hover align-top cursor-pointer">
                        <td className="px-3 py-3 text-[13px] text-cc-ink whitespace-nowrap">{fmtDateTime(c.called_at)}</td>
                        <td className="px-3 py-3">
                          <p className="text-[14px] font-semibold text-cc-ink">{c.lead?.name || "—"}</p>
                          {c.lead?.mobile && <p className="text-[12px] text-cc-muted">+91 {c.lead.mobile}</p>}
                        </td>
                        <td className="px-3 py-3 text-[13px] text-cc-ink whitespace-nowrap">{OUTCOME_LABEL[c.outcome] ?? c.outcome}</td>
                        <td className="px-3 py-3 text-[13px] text-cc-ink">{c.note || "—"}</td>
                        <td className="px-3 py-3 text-center text-[13px] text-cc-ink whitespace-nowrap">{c.next_follow_up ? fmtDate(c.next_follow_up) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}

          {tab === "traffic" && <Traffic />}
        </main>
      </div>

      {open && <LeadWindow lead={open} added={lastCall} busy={busy === open.id} onUpdate={(p) => update(open, p)} onLog={() => setLogFor(open)} onClose={() => setOpen(null)} />}
      {logFor && <LogCall lead={logFor} onLogged={(c, s) => { logged(logFor, c, s); setLogFor(null); }} onClose={() => setLogFor(null)} />}
    </div>
  );
}

type TrafficDay = {
  day: string; visitors: number; visits: number; page_views: number; clicks: number; dead_taps: number; rage_taps: number;
  leads: number; pixel_events: number; capi_ok: number; capi_failed: number;
};
type Visit = {
  visit_id: string; started: string; source: string | null; campaign: string | null; referrer: string | null; device: string | null;
  pages: number; max_scroll: number | null; engaged_seconds: number | null; clicks: number;
  pixel_events: string | null; capi_ok: string | null; capi_failed: string | null; lead: boolean | null;
};
const TRAFFIC_DAYS = 14;
const TK = "dash.gzb.traffic";
const TRAFFIC_TTL = 300_000;
const DAY_COLS: [Exclude<keyof TrafficDay, "day">, string][] = [
  ["visitors", "Visitors"], ["visits", "Visits"], ["page_views", "Page views"], ["clicks", "Clicks"], ["dead_taps", "Dead taps"],
  ["rage_taps", "Rage taps"], ["leads", "Leads"], ["pixel_events", "Pixel events"], ["capi_ok", "CAPI ok"], ["capi_failed", "CAPI failed"],
];
const NO_TRAFFIC = Object.fromEntries(DAY_COLS.map(([k]) => [k, 0])) as Omit<TrafficDay, "day">;
const dayTone = (k: string, n: number) =>
  !n ? "text-[#9bb5aa]" : k === "capi_failed" ? "text-red-600 font-semibold" : k === "leads" ? "text-cc-green font-semibold" : "text-cc-ink";
const host = (u: string | null) => { if (!u) return null; try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const dur = (s: number | null) => (s == null ? "—" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

// The website's traffic: one request when the tab opens (the last 14 days), one when a
// day is opened (its visits). Both kept 5 minutes, so switching tabs reads nothing again.
function Traffic() {
  const [days, setDays] = useState<TrafficDay[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [visits, setVisits] = useState<Record<string, Visit[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = getCached<TrafficDay[]>(TK, TRAFFIC_TTL);
    if (cached) { setDays(cached); return; }
    void supabase().rpc("gzb_traffic_days", { p_days: TRAFFIC_DAYS }).then(({ data, error: e }) => {
      if (e) setError(e.message); else setCached(TK, data ?? []);
      setDays((data ?? []) as TrafficDay[]);
    });
  }, []);

  function openDay(day: string) {
    if (pick === day) { setPick(null); return; }
    setPick(day);
    if (visits[day]) return;
    const key = `${TK}.${day}`;
    const cached = getCached<Visit[]>(key, TRAFFIC_TTL);
    if (cached) { setVisits((v) => ({ ...v, [day]: cached })); return; }
    void supabase().rpc("gzb_traffic_visits", { p_day: day }).then(({ data, error: e }) => {
      if (e) setError(e.message); else setCached(key, data ?? []);
      setVisits((v) => ({ ...v, [day]: (data ?? []) as Visit[] }));
    });
  }

  // Every one of the 14 days, a day with no visits as zeros.
  const byDay = new Map((days ?? []).map((d) => [d.day, d]));
  const list = Array.from({ length: TRAFFIC_DAYS }, (_, i) => inDays(-i)).map((day) => byDay.get(day) ?? { day, ...NO_TRAFFIC });
  const shown = pick ? visits[pick] ?? null : null;
  const td = "px-3 py-3 text-[13px] text-cc-ink";

  return (
    <div className="flex flex-col gap-5">
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <Card className="overflow-x-auto cc-table-card">
        <table className="w-full text-[14px] cc-table">
          <thead className="text-left">
            <tr>
              <th className={th}>Day</th>
              {DAY_COLS.map(([k, l]) => <th key={k} className={th + " text-center"}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {!days ? (
              <tr><td colSpan={DAY_COLS.length + 1} className="px-5 py-10 text-center text-cc-muted">Loading…</td></tr>
            ) : list.map((d) => (
              <tr key={d.day} onClick={() => { if (d.visits > 0) openDay(d.day); }}
                className={["border-b border-cc-row-line", d.visits > 0 ? "cursor-pointer hover:bg-cc-row-hover" : "", pick === d.day ? "bg-[#f0f8f4]" : ""].join(" ")}>
                <td className={td + " font-semibold whitespace-nowrap"}>{fmtDate(d.day)}</td>
                {DAY_COLS.map(([k]) => <td key={k} className={["px-3 py-3 text-center text-[13px]", dayTone(k, d[k])].join(" ")}>{d[k]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {pick && (
        <section>
          <div className="text-[13px] font-semibold mb-2 text-cc-ink">
            {fmtDate(pick)} {shown && <span className="text-cc-muted font-normal">{shown.length}</span>}
          </div>
          <Card className="overflow-x-auto cc-table-card">
            <table className="w-full text-[14px] cc-table">
              <thead className="text-left">
                <tr>
                  <th className={th}>Started</th>
                  <th className={th}>Source</th>
                  <th className={th}>Device</th>
                  <th className={th + " text-center"}>Pages</th>
                  <th className={th + " text-center"}>Scroll</th>
                  <th className={th + " text-center"}>Time</th>
                  <th className={th + " text-center"}>Clicks</th>
                  <th className={th}>Pixel events</th>
                  <th className={th}>CAPI</th>
                  <th className={th + " text-center"}>Lead</th>
                </tr>
              </thead>
              <tbody>
                {!shown || !shown.length ? (
                  <tr><td colSpan={10} className="px-5 py-10 text-center text-cc-muted">{!shown ? "Loading…" : "No visits."}</td></tr>
                ) : shown.map((v) => (
                  <tr key={v.visit_id} className="border-b border-cc-row-line align-top">
                    <td className={td + " whitespace-nowrap"}>{fmtTime(v.started)}</td>
                    <td className={td + " max-w-[200px] break-words"}>
                      <div>{v.source || host(v.referrer) || "—"}</div>
                      {v.campaign && <div className="text-[12px] text-cc-muted">{v.campaign}</div>}
                    </td>
                    <td className={td}>{v.device || "—"}</td>
                    <td className={td + " text-center"}>{v.pages}</td>
                    <td className={td + " text-center"}>{v.max_scroll != null ? `${v.max_scroll}%` : "—"}</td>
                    <td className={td + " text-center whitespace-nowrap"}>{dur(v.engaged_seconds)}</td>
                    <td className={td + " text-center"}>{v.clicks}</td>
                    <td className={td + " max-w-[200px] break-words"}>{v.pixel_events || "—"}</td>
                    <td className={td + " max-w-[200px] break-words"}>
                      {v.capi_ok && <div className="text-cc-green">{v.capi_ok}</div>}
                      {v.capi_failed && <div className="text-red-600 font-semibold">{v.capi_failed}</div>}
                      {!v.capi_ok && !v.capi_failed && "—"}
                    </td>
                    <td className={td + " text-center"}>{v.lead ? <span className="text-cc-green font-semibold">Yes</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </div>
  );
}

const followTone = (r: Lead, today: string) =>
  !r.follow_up_at || !OPEN(r.status) ? "text-cc-ink" : r.follow_up_at < today ? "text-red-600 font-semibold" : r.follow_up_at === today ? "text-amber-700 font-semibold" : "text-cc-ink";

function CallActions({ lead, onLog }: { lead: Lead; onLog: (l: Lead) => void }) {
  const btn = "px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border";
  return (
    <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <a href={tel(lead.mobile)} className={btn + " border-cc-green text-cc-green hover:bg-cc-green/[0.06]"}>Call</a>
      <a href={waUrl(lead.mobile, "")} target="_blank" rel="noreferrer" className={btn + " border-whatsapp text-whatsapp hover:bg-whatsapp/[0.06]"}>WhatsApp</a>
      <button type="button" onClick={() => onLog(lead)} className={btn + " border-transparent text-white"} style={{ background: ACCENTS.gzb.color }}>Log call</button>
    </div>
  );
}

function DaySection({ title, tone, rows, today, onOpen, onLog }: {
  title: string; tone: string; rows: Lead[]; today: string; onOpen: (l: Lead) => void; onLog: (l: Lead) => void;
}) {
  if (!rows.length) return null;
  return (
    <section>
      <div className={`text-[13px] font-semibold mb-2 ${tone}`}>{title} <span className="text-cc-muted font-normal">{rows.length}</span></div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <Card key={r.id} className="p-3.5 cursor-pointer hover:bg-cc-row-hover">
            <div onClick={() => onOpen(r)} className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-cc-ink">{r.name || "—"} <span className="text-[13px] font-normal text-cc-blue">+91 {r.mobile}</span></p>
                <p className="text-[12.5px] text-cc-muted">
                  {[r.city, r.monthly_bill && `Bill ${r.monthly_bill}`, words(r.looking_for)].filter(Boolean).join(" · ") || "—"}
                </p>
                {(r.last_call_at || r.follow_up_at) && (
                  <p className="text-[12.5px] text-cc-ink mt-0.5">
                    {r.last_call_at && <>Last: {OUTCOME_LABEL[r.last_outcome as Outcome] ?? r.last_outcome}, {fmtDate(r.last_call_at)}</>}
                    {r.last_call_at && r.follow_up_at && " · "}
                    {r.follow_up_at && <span className={followTone(r, today)}>Follow-up {fmtDate(r.follow_up_at)}</span>}
                  </p>
                )}
              </div>
              <CallActions lead={r} onLog={onLog} />
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

// A lead: its details, status, next follow-up, notes and calls (read when it opens).
function LeadWindow({ lead, added, busy, onUpdate, onLog, onClose }: {
  lead: Lead; added: Call | null; busy: boolean; onUpdate: (p: Partial<Lead>) => Promise<boolean>; onLog: () => void; onClose: () => void;
}) {
  const [notes, setNotes] = useState(lead.notes ?? "");
  // Notes save on blur and when the window closes (a press on the overlay closes
  // it before the box blurs); the value being saved is never sent twice.
  const savingNotes = useRef<string | null>(null);
  function saveNotes() {
    const v = notes.trim();
    if (v === (lead.notes ?? "").trim() || v === savingNotes.current) return;
    savingNotes.current = v;
    void onUpdate({ notes: v || null }).finally(() => { savingNotes.current = null; });
  }
  const close = () => { saveNotes(); onClose(); };
  const [calls, setCalls] = useState<Call[] | null>(null);
  useEffect(() => {
    void supabase().from("gozerobils_lead_calls").select("id, lead_id, called_at, outcome, note, next_follow_up")
      .eq("lead_id", lead.id).order("called_at", { ascending: false })
      .then(({ data }) => setCalls((data ?? []) as Call[]));
  }, [lead.id]);
  // A call logged while this window is open joins its list (no read again).
  useEffect(() => {
    if (added && added.lead_id === lead.id) setCalls((cs) => (cs && !cs.some((x) => x.id === added.id) ? [added, ...cs] : cs));
  }, [added, lead.id]);
  const row = (l: string, v: string | null | undefined) => (
    <div className="min-w-0"><div className="text-[11.5px] text-cc-muted">{l}</div><div className="text-[14px] text-cc-ink break-words">{v || "—"}</div></div>
  );
  return (
    <Modal onClose={close} closeOnBackdrop="mousedown" overlayClassName={OVERLAY.soft} className="bg-white rounded-2xl shadow-xl w-full max-w-[680px] max-h-[92vh] overflow-y-auto p-6" aria-label={lead.name || "Lead"}>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="text-[18px] font-display font-bold text-cc-ink">{lead.name || "—"}</div>
          <div className="text-[13px] text-cc-blue">+91 {lead.mobile}</div>
        </div>
        <CallActions lead={lead} onLog={() => onLog()} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        {row("City", [lead.city, lead.pincode].filter(Boolean).join(" · "))}
        {row("State", lead.state)}
        {row("Monthly bill", lead.monthly_bill)}
        {row("Looking for", words(lead.looking_for))}
        {row("Timeline", words(lead.timeline))}
        {row("Source", [lead.utm_source, lead.utm_campaign].filter(Boolean).join(" · "))}
        {row("Received", fmtDateTime(lead.created_at))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-cc-muted">Status</span>
          <select disabled={busy} value={lead.status} onChange={(e) => void onUpdate({ status: e.target.value })}
            className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none">
            {LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-cc-muted">Next follow-up</span>
          <DateField value={lead.follow_up_at ?? ""} disabled={busy} onChange={(v) => void onUpdate({ follow_up_at: v || null })}
            className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[12px] font-medium text-cc-muted">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            onBlur={saveNotes}
            className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none resize-none" />
        </label>
      </div>
      <div className="text-[12px] font-medium text-cc-muted mb-1.5">Calls</div>
      {!calls ? <p className="text-[13px] text-cc-muted">Loading…</p>
        : calls.length === 0 ? <p className="text-[13px] text-cc-muted">No calls yet.</p>
        : (
          <div className="flex flex-col divide-y divide-cc-row-line border border-cc-row-line rounded-xl">
            {calls.map((c) => (
              <div key={c.id} className="px-3 py-2 text-[13px]">
                <div className="flex justify-between gap-3">
                  <span className="font-semibold text-cc-ink">{OUTCOME_LABEL[c.outcome] ?? c.outcome}</span>
                  <span className="text-cc-muted whitespace-nowrap">{fmtDateTime(c.called_at)}</span>
                </div>
                {c.note && <div className="text-cc-ink mt-0.5">{c.note}</div>}
                {c.next_follow_up && <div className="text-[12px] text-cc-muted">Follow-up {fmtDate(c.next_follow_up)}</div>}
              </div>
            ))}
          </div>
        )}
      <div className="flex justify-end mt-5">
        <button type="button" onClick={close} className="px-4 py-2.5 rounded-xl text-[13.5px] font-semibold text-cc-muted hover:bg-cc-row-hover">Close</button>
      </div>
    </Modal>
  );
}

// Log a call: the outcome, a note, the next follow-up (suggested by the outcome) and the status.
function LogCall({ lead, onLogged, onClose }: { lead: Lead; onLogged: (c: Call, status: string) => void; onClose: () => void }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState(lead.status === "new" ? "contacted" : lead.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = (o: Outcome) => {
    setOutcome(o);
    const n = NEXT_IN[o];
    setNext(n == null ? "" : inDays(n));
    if (CLOSES.includes(o)) setStatus("closed");
    else if (status === "closed") setStatus("contacted");
  };
  const QUICK: [string, number][] = [["Tomorrow", 1], ["3 days", 3], ["1 week", 7]];

  async function save() {
    if (!outcome) { setError("Choose how the call went."); return; }
    setBusy(true); setError(null);
    const { data, error: e } = await supabase().from("gozerobils_lead_calls")
      .insert({ lead_id: lead.id, outcome, note: note.trim() || null, next_follow_up: next || null })
      .select("id, lead_id, called_at, outcome, note, next_follow_up").single();
    if (e || !data) { setBusy(false); setError(e?.message || "Couldn't save the call."); return; }
    // The database already moved a New lead to Contacted; any other status is one more write.
    const after = lead.status === "new" ? "contacted" : lead.status;
    if (status !== after) {
      const { error: se } = await supabase().from("gozerobils_leads").update({ status }).eq("id", lead.id);
      if (se) { setBusy(false); setError(se.message); return; }
    }
    onLogged(data as Call, status);
  }

  return (
    <Modal onClose={onClose} busy={busy} closeOnBackdrop="mousedown" overlayClassName={OVERLAY.softTop} className="bg-white rounded-2xl shadow-xl w-full max-w-[520px] max-h-[92vh] overflow-y-auto p-6" aria-label="Log call">
      <div className="text-[16px] font-display font-bold text-cc-ink">Log call</div>
      <div className="text-[13px] text-cc-muted mb-4">{lead.name || "—"} · +91 {lead.mobile}</div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {OUTCOMES.map((o) => (
          <button key={o} type="button" onClick={() => pick(o)} disabled={busy}
            className={["px-3 py-1.5 rounded-full text-[12.5px] font-semibold border", outcome === o ? "text-white border-transparent" : "bg-white border-line text-cc-ink"].join(" ")}
            style={outcome === o ? { background: ACCENTS.gzb.color } : undefined}>
            {OUTCOME_LABEL[o]}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 mb-3">
        <span className="text-[12px] font-medium text-cc-muted">Note</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} disabled={busy}
          className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none resize-none" />
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-cc-muted">Next follow-up</span>
          <DateField value={next} onChange={setNext} disabled={busy} min={localIsoDate(new Date())}
            className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none" />
          <div className="flex gap-1.5 mt-1">
            {QUICK.map(([l, n]) => (
              <button key={l} type="button" onClick={() => setNext(inDays(n))} disabled={busy}
                className="px-2 py-1 rounded-lg text-[11.5px] font-semibold border border-line text-cc-ink hover:bg-cc-row-hover">{l}</button>
            ))}
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-cc-muted">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={busy}
            className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none">
            {LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl text-[13.5px] font-semibold text-cc-muted hover:bg-cc-row-hover">Cancel</button>
        <button type="button" onClick={() => void save()} disabled={busy}
          className="px-5 py-2.5 rounded-xl text-white text-[13.5px] font-semibold disabled:opacity-60" style={{ background: ACCENTS.gzb.color }}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
