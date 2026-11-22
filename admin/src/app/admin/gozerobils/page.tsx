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
// A logged call (outcome, note, next follow-up) updates its lead in the
// database (trigger) and here in place — the list is one query on open, cached
// like the other lists; nothing is fetched again.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar, { ACCENTS, SectionMark, themeStyle } from "@/components/AdminSidebar";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import DateField from "@/components/ui/DateField";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { getCached, setCached, invalidate } from "@/lib/list-cache";
import { fmtDate, fmtDateTime, localIsoDate } from "@/lib/dates";
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

type Tab = "leads" | "myday" | "calls";

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
    if (e) { alert("Couldn't save: " + e.message); return false; }
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
  const tabs: [Tab, string, number | null][] = [["myday", "My Day", dayCount], ["leads", "All leads", rows?.length ?? null], ["calls", "Calls", null]];

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
                className={["px-4 py-2 rounded-xl text-[13.5px] font-semibold border", tab === k ? "text-white border-transparent" : "bg-white border-line text-[#0f3d2e]"].join(" ")}
                style={tab === k ? { background: ACCENTS.gzb.color } : undefined}>
                {label}
                {n != null && n > 0 && (
                  <span className={["ml-1.5 inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-bold",
                    k === "myday" ? "bg-[#dc2626] text-white" : tab === k ? "bg-white/25" : "bg-[#eef1f0] text-[#5a8a76]"].join(" ")}>{n}</span>
                )}
              </button>
            ))}
          </div>
        </header>

        <main className="px-4 sm:px-6 py-4">
          {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}

          {tab === "myday" && (
            !rows ? <p className="text-[13px] text-[#5a8a76]">Loading…</p>
            : dayCount === 0 ? <Card className="p-8 text-center text-[14px] text-[#5a8a76]">Nothing due today.</Card>
            : (
              <div className="flex flex-col gap-5">
                <DaySection title="Overdue" tone="text-[#dc2626]" rows={day.overdue} today={today} onOpen={setOpen} onLog={setLogFor} />
                <DaySection title="Today" tone="text-[#b45309]" rows={day.today} today={today} onOpen={setOpen} onLog={setLogFor} />
                <DaySection title="New, not called yet" tone="text-[#185fa5]" rows={day.fresh} today={today} onOpen={setOpen} onLog={setLogFor} />
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
                      <tr><td colSpan={8} className="px-5 py-10 text-center text-[#5a8a76]">{!rows ? "Loading…" : rows.length ? "No leads match." : "No leads yet."}</td></tr>
                    ) : filtered.map((r) => (
                      <tr key={r.id} onClick={() => setOpen(r)} className="border-b border-[#eaf3ee] hover:bg-[#f7fcfa] align-top cursor-pointer">
                        <td className="px-3 py-3">
                          <p className="text-[15px] font-semibold text-[#0f3d2e]">{r.name || "—"}</p>
                          <p className="text-[12px] mt-0.5 text-[#185fa5]">+91 {r.mobile}</p>
                          <p className="text-[12px] text-[#5a8a76]">{[r.city, r.pincode, r.state].filter(Boolean).join(" · ")}</p>
                        </td>
                        <td className="px-3 py-3 text-[13px] text-[#0f3d2e]">{r.monthly_bill || "—"}</td>
                        <td className="px-3 py-3 text-[13px] text-[#0f3d2e] max-w-[220px] break-words">{words(r.looking_for) || "—"}</td>
                        <td className="px-3 py-3 text-[13px] text-[#0f3d2e]">
                          <div>{r.utm_source || "—"}</div>
                          {r.utm_campaign && <div className="text-[12px] text-[#5a8a76]">{r.utm_campaign}</div>}
                        </td>
                        <td className="px-3 py-3 text-center text-[13px] text-[#0f3d2e] whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                        <td className="px-3 py-3 text-[13px] text-[#0f3d2e] whitespace-nowrap">
                          {r.last_call_at ? <><div>{OUTCOME_LABEL[r.last_outcome as Outcome] ?? r.last_outcome}</div><div className="text-[12px] text-[#5a8a76]">{fmtDateTime(r.last_call_at)}</div></> : "—"}
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
                    <tr><td colSpan={5} className="px-5 py-10 text-center text-[#5a8a76]">{!calls ? "Loading…" : "No calls yet."}</td></tr>
                  ) : calls.map((c) => {
                    const lead = rows?.find((r) => r.id === c.lead_id);
                    return (
                      <tr key={c.id} onClick={() => lead && setOpen(lead)} className="border-b border-[#eaf3ee] hover:bg-[#f7fcfa] align-top cursor-pointer">
                        <td className="px-3 py-3 text-[13px] text-[#0f3d2e] whitespace-nowrap">{fmtDateTime(c.called_at)}</td>
                        <td className="px-3 py-3">
                          <p className="text-[14px] font-semibold text-[#0f3d2e]">{c.lead?.name || "—"}</p>
                          {c.lead?.mobile && <p className="text-[12px] text-[#5a8a76]">+91 {c.lead.mobile}</p>}
                        </td>
                        <td className="px-3 py-3 text-[13px] text-[#0f3d2e] whitespace-nowrap">{OUTCOME_LABEL[c.outcome] ?? c.outcome}</td>
                        <td className="px-3 py-3 text-[13px] text-[#0f3d2e]">{c.note || "—"}</td>
                        <td className="px-3 py-3 text-center text-[13px] text-[#0f3d2e] whitespace-nowrap">{c.next_follow_up ? fmtDate(c.next_follow_up) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </main>
      </div>

      {open && <LeadWindow lead={open} added={lastCall} busy={busy === open.id} onUpdate={(p) => update(open, p)} onLog={() => setLogFor(open)} onClose={() => setOpen(null)} />}
      {logFor && <LogCall lead={logFor} onLogged={(c, s) => { logged(logFor, c, s); setLogFor(null); }} onClose={() => setLogFor(null)} />}
    </div>
  );
}

const followTone = (r: Lead, today: string) =>
  !r.follow_up_at || !OPEN(r.status) ? "text-[#0f3d2e]" : r.follow_up_at < today ? "text-[#dc2626] font-semibold" : r.follow_up_at === today ? "text-[#b45309] font-semibold" : "text-[#0f3d2e]";

function CallActions({ lead, onLog }: { lead: Lead; onLog: (l: Lead) => void }) {
  const btn = "px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border";
  return (
    <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <a href={tel(lead.mobile)} className={btn + " border-[#178a5c] text-[#178a5c] hover:bg-[#178a5c]/[0.06]"}>Call</a>
      <a href={waUrl(lead.mobile, "")} target="_blank" rel="noreferrer" className={btn + " border-[#128C7E] text-[#128C7E] hover:bg-[#128C7E]/[0.06]"}>WhatsApp</a>
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
      <div className={`text-[13px] font-semibold mb-2 ${tone}`}>{title} <span className="text-[#5a8a76] font-normal">{rows.length}</span></div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <Card key={r.id} className="p-3.5 cursor-pointer hover:bg-[#f7fcfa]">
            <div onClick={() => onOpen(r)} className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[#0f3d2e]">{r.name || "—"} <span className="text-[13px] font-normal text-[#185fa5]">+91 {r.mobile}</span></p>
                <p className="text-[12.5px] text-[#5a8a76]">
                  {[r.city, r.monthly_bill && `Bill ${r.monthly_bill}`, words(r.looking_for)].filter(Boolean).join(" · ") || "—"}
                </p>
                {(r.last_call_at || r.follow_up_at) && (
                  <p className="text-[12.5px] text-[#0f3d2e] mt-0.5">
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
    <div className="min-w-0"><div className="text-[11.5px] text-[#5a8a76]">{l}</div><div className="text-[14px] text-[#0f3d2e] break-words">{v || "—"}</div></div>
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/30 grid place-items-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[680px] max-h-[92vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <div className="text-[18px] font-display font-bold text-[#0f3d2e]">{lead.name || "—"}</div>
            <div className="text-[13px] text-[#185fa5]">+91 {lead.mobile}</div>
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
            <span className="text-[12px] font-medium text-[#5a8a76]">Status</span>
            <select disabled={busy} value={lead.status} onChange={(e) => void onUpdate({ status: e.target.value })}
              className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none">
              {LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[#5a8a76]">Next follow-up</span>
            <DateField value={lead.follow_up_at ?? ""} disabled={busy} onChange={(v) => void onUpdate({ follow_up_at: v || null })}
              className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none" />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[12px] font-medium text-[#5a8a76]">Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              onBlur={() => { if (notes.trim() !== (lead.notes ?? "").trim()) void onUpdate({ notes: notes.trim() || null }); }}
              className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none resize-none" />
          </label>
        </div>
        <div className="text-[12px] font-medium text-[#5a8a76] mb-1.5">Calls</div>
        {!calls ? <p className="text-[13px] text-[#5a8a76]">Loading…</p>
          : calls.length === 0 ? <p className="text-[13px] text-[#5a8a76]">No calls yet.</p>
          : (
            <div className="flex flex-col divide-y divide-[#eaf3ee] border border-[#eaf3ee] rounded-xl">
              {calls.map((c) => (
                <div key={c.id} className="px-3 py-2 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold text-[#0f3d2e]">{OUTCOME_LABEL[c.outcome] ?? c.outcome}</span>
                    <span className="text-[#5a8a76] whitespace-nowrap">{fmtDateTime(c.called_at)}</span>
                  </div>
                  {c.note && <div className="text-[#0f3d2e] mt-0.5">{c.note}</div>}
                  {c.next_follow_up && <div className="text-[12px] text-[#5a8a76]">Follow-up {fmtDate(c.next_follow_up)}</div>}
                </div>
              ))}
            </div>
          )}
        <div className="flex justify-end mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-[13.5px] font-semibold text-[#5a8a76] hover:bg-[#f7fcfa]">Close</button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-[60] bg-black/30 grid place-items-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[520px] max-h-[92vh] overflow-y-auto p-6">
        <div className="text-[16px] font-display font-bold text-[#0f3d2e]">Log call</div>
        <div className="text-[13px] text-[#5a8a76] mb-4">{lead.name || "—"} · +91 {lead.mobile}</div>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {OUTCOMES.map((o) => (
            <button key={o} type="button" onClick={() => pick(o)} disabled={busy}
              className={["px-3 py-1.5 rounded-full text-[12.5px] font-semibold border", outcome === o ? "text-white border-transparent" : "bg-white border-line text-[#0f3d2e]"].join(" ")}
              style={outcome === o ? { background: ACCENTS.gzb.color } : undefined}>
              {OUTCOME_LABEL[o]}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 mb-3">
          <span className="text-[12px] font-medium text-[#5a8a76]">Note</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} disabled={busy}
            className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none resize-none" />
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[#5a8a76]">Next follow-up</span>
            <DateField value={next} onChange={setNext} disabled={busy} min={localIsoDate(new Date())}
              className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none" />
            <div className="flex gap-1.5 mt-1">
              {QUICK.map(([l, n]) => (
                <button key={l} type="button" onClick={() => setNext(inDays(n))} disabled={busy}
                  className="px-2 py-1 rounded-lg text-[11.5px] font-semibold border border-line text-[#0f3d2e] hover:bg-[#f7fcfa]">{l}</button>
              ))}
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[#5a8a76]">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={busy}
              className="border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none">
              {LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl text-[13.5px] font-semibold text-[#5a8a76] hover:bg-[#f7fcfa]">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy}
            className="px-5 py-2.5 rounded-xl text-white text-[13.5px] font-semibold disabled:opacity-60" style={{ background: ACCENTS.gzb.color }}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
