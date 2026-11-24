"use client";

// Leads — the company's prospects and their follow-ups (epc_leads, 0127): filter
// by follow-up due or status, search, add / edit / delete. Sales see only the
// leads they own; Owner / Admin see everyone's and pick each lead's owner.
// Partner Portal v2 (portalV2).
// Sustera Ventures (gozerobils — its quotation template is the gozerobils builder)
// has three tabs (0141): Meta = the gozerobils.com enquiries, read only (CC works
// them in its gozerobils page) with Call / WhatsApp; Cold call / Reference = its own
// leads by where they came from (the lead form asks; a reference names whose).

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NAVY } from "@/components/partner/PartnerShell";
import { input, decimal, digits, Field } from "@/components/quotation/form-kit";
import DateField from "@/components/ui/DateField";
import Modal, { OVERLAY } from "@/components/ui/Modal";
import WhatsAppButton from "@/components/partner/WhatsAppButton";
import { getBusiness, loanAccess } from "@/lib/auth";
import { canManageOrg, canWork, epcRole, hasModule, portalV2 } from "@/lib/epc-roles";
import { fetchEpcName } from "@/lib/epc-name";
import { fetchWhatsAppOn } from "@/lib/subscription";
import { whatsAppLead } from "@/lib/wa-share";
import { fetchProjects, projectFromLead } from "@/lib/projects";
import { fetchQuoteTemplate } from "@/lib/quotation-template";
import { SARVATRA } from "@/lib/quotation-brands";
import { fetchMetaLeads, tel, words, OUTCOME_LABEL, type GzbLead, type Outcome } from "@/lib/gozerobils";
import { LEAD_STATUS_OPTIONS, LEAD_STATUS_PILL as GZB_STATUS_PILL } from "@/lib/lead-status";
import { fetchMembers, type MemberRow } from "@/lib/members";
import { fmtDate, localIsoDate } from "@/lib/dates";
import { fmtRupees } from "@/lib/money";
import { MOBILE_RE } from "@/lib/validators";
import { askConfirm } from "@/lib/confirm";
import {
  fetchLeads, saveLead, deleteLead, leadsChanged, filedElsewhere, isDue,
  LEAD_STATUSES, LEAD_STATUS_LABEL, LEAD_STATUS_PILL, LEAD_SOURCES, LEAD_SOURCE_LABEL, type LeadRow, type LeadStatus, type LeadSource,
} from "@/lib/leads";

type Filter = "all" | "due" | LeadStatus;
type Tab = "meta" | LeadSource;
// A lead saved before the source was asked counts as a cold call.
const sourceOf = (r: Pick<LeadRow, "source">): LeadSource => r.source ?? "cold_call";

export default function LeadsPage() {
  const router = useRouter();
  const me = getBusiness();
  const work = canWork(me), assign = canManageOrg(me), seeOwners = epcRole(me) !== "SALES";
  const ownerName = (me?.contact_name || "").trim() || "Owner"; // a lead with no staff owner = the company's
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<LeadRow | "new" | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);

  const v2 = portalV2(me);
  useEffect(() => { if (!v2) router.replace("/dashboard"); }, [v2, router]);
  // WhatsApp (paid) + the company's name for the message — both cached reads.
  const [wa, setWa] = useState(false);
  const [org, setOrg] = useState("");
  useEffect(() => { if (v2) { fetchWhatsAppOn().then(setWa, () => {}); void fetchEpcName().then(setOrg); } }, [v2]);
  const canLoan = loanAccess(me) && hasModule(me, "loans");
  useEffect(() => { fetchLeads().then(setRows, () => setFailed(true)); }, []);
  // Sustera (the gozerobils company): the Meta / Cold call / Reference tabs — its
  // template is a cached read the portal already makes.
  const [gzb, setGzb] = useState(false);
  const [tab, setTab] = useState<Tab>("meta");
  useEffect(() => { fetchQuoteTemplate().then((t) => setGzb(t?.storage_path === SARVATRA.key), () => {}); }, []);
  const [meta, setMeta] = useState<GzbLead[] | null>(null);
  const [metaFailed, setMetaFailed] = useState(false);
  useEffect(() => { if (gzb && tab === "meta" && !meta) fetchMetaLeads().then(setMeta, () => setMetaFailed(true)); }, [gzb, tab, meta]);
  const onMeta = gzb && tab === "meta";
  const inTab = (r: LeadRow) => !gzb || tab === "meta" || sourceOf(r) === tab;
  // Opened from a dashboard tile: ?f=due | ?f=<status> filters, ?owner=<member id | company>
  // shows one lead owner's leads, ?new=1 adds a lead.
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    const f = u.get("f") as Filter | null;
    if (f && (f === "due" || (LEAD_STATUSES as string[]).includes(f))) setFilter(f);
    setOwner(u.get("owner"));
    if (u.get("new") === "1" && canWork(getBusiness())) setOpen("new");
    // ?new=1 opens the form once — Back to this page or a refresh doesn't open it again
    // (left alone while a non-v2 login is being sent to /dashboard above).
    if (u.has("new") && portalV2(getBusiness())) { u.delete("new"); const s = u.toString(); window.history.replaceState(null, "", `/dashboard/leads${s ? `?${s}` : ""}`); }
  }, []);
  // Lead owners to pick from (Owner / Admin) — read when the form first opens.
  useEffect(() => {
    if (open && assign && !members.length) fetchMembers().then((m) => setMembers(m.filter((x) => x.active && x.member_role !== "VIEWER" && x.member_role !== "SITE")), () => {});
  }, [open, assign, members.length]);

  const today = localIsoDate(new Date());
  const count = (f: Filter) => (rows ?? []).filter((r) => inTab(r) && (f === "all" ? true : f === "due" ? isDue(r, today) : r.status === f)).length;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (rows ?? []).filter((r) => (!gzb || sourceOf(r) === tab)
      && (filter === "all" || (filter === "due" ? isDue(r, today) : r.status === filter))
      && (!owner || (owner === "company" ? !r.owner_member_id : r.owner_member_id === owner))
      && (!s || [r.name, r.mobile, r.city].some((v) => String(v ?? "").toLowerCase().includes(s))));
    return filter === "due" ? [...list].sort((a, b) => String(a.follow_up_at).localeCompare(String(b.follow_up_at))) : list;
  }, [rows, filter, q, today, owner, gzb, tab]);
  const tabCount = (t: Tab) => (t === "meta" ? meta?.length ?? null : (rows ?? []).filter((r) => sourceOf(r) === t).length);
  const showRef = gzb && tab === "reference";

  function apply(next: LeadRow[]) { setRows(next); leadsChanged(next); }

  return (
    <div className="max-w-[1150px]">
      {gzb && (
        <div className="inline-flex rounded-xl border border-line bg-white p-1 mb-4">
          {(["meta", ...LEAD_SOURCES] as Tab[]).map((t) => {
            const n = tabCount(t);
            return (
              <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t}
                className={["px-4 py-2 rounded-lg text-[13.5px] font-semibold", tab === t ? "text-white" : "text-text-mid hover:bg-bg-soft"].join(" ")}
                style={tab === t ? { background: NAVY } : undefined}>
                {t === "meta" ? "Meta" : LEAD_SOURCE_LABEL[t]}{n != null && <span className="ml-1.5 opacity-70">{n}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        {!onMeta && <div className="flex gap-1.5 flex-wrap">
          {(["all", "due", ...LEAD_STATUSES] as Filter[]).map((k) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={["px-3.5 py-1.5 rounded-full text-[13px] font-semibold border", filter === k ? "text-white border-transparent" : "bg-white border-line text-text-mid"].join(" ")}
              style={filter === k ? { background: NAVY } : undefined}>
              {k === "all" ? "All" : k === "due" ? "Follow-up due" : LEAD_STATUS_LABEL[k]}{" "}
              <span className={k === "due" && count(k) > 0 && filter !== k ? "text-red-600" : "opacity-70"}>{count(k)}</span>
            </button>
          ))}
        </div>}
        {!onMeta && owner && (
          <button type="button" onClick={() => setOwner(null)}
            className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold text-white" style={{ background: NAVY }}>
            {owner === "company" ? ownerName : rows?.find((r) => r.owner_member_id === owner)?.owner?.name ?? "—"} ×
          </button>
        )}
        <input className={input + " max-w-[240px] ml-auto"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile, city" aria-label="Search name, mobile, city" />
        {work && (
          <button type="button" onClick={() => setOpen("new")} className="px-4 py-2.5 rounded-xl text-white text-[13.5px] font-semibold" style={{ background: NAVY }}>
            + Add lead
          </button>
        )}
      </div>

      {onMeta ? (
        <MetaLeads rows={meta} failed={metaFailed} q={q} wa={wa} org={org} today={today} />
      ) : failed ? (
        <p className="text-[13px] text-red-600">Couldn&apos;t load your leads. Please refresh.</p>
      ) : !rows ? (
        <p className="text-[13px] text-text-muted">Loading…</p>
      ) : (
        <div className="bg-white rounded-2xl border border-line overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[760px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-wide text-text-muted border-b border-line">
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">City</th>
                <th className="px-4 py-3 font-semibold text-right">Size</th>
                <th className="px-4 py-3 font-semibold text-right">Project cost</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Follow-up</th>
                {showRef && <th className="px-4 py-3 font-semibold">Reference from</th>}
                {seeOwners && <th className="px-4 py-3 font-semibold">Lead owner</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const tone = !r.follow_up_at || r.status === "won" || r.status === "lost" ? "text-text-mid"
                  : r.follow_up_at < today ? "text-red-600 font-semibold" : r.follow_up_at === today ? "text-amber-700 font-semibold" : "text-text";
                return (
                  <tr key={r.id} onClick={() => setOpen(r)} className="border-b border-line last:border-0 hover:bg-bg-soft cursor-pointer">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text">{r.name}</div>
                      {r.mobile && <div className="text-[12px] text-text-muted">+91 {r.mobile}</div>}
                    </td>
                    <td className="px-4 py-3 text-text-mid">{r.city || "—"}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{r.kw ? `${+Number(r.kw).toFixed(2)} kW` : "—"}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{r.project_cost ? fmtRupees(r.project_cost) : "—"}</td>
                    <td className="px-4 py-3"><span className={`px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap ${LEAD_STATUS_PILL[r.status]}`}>{LEAD_STATUS_LABEL[r.status]}</span></td>
                    <td className={`px-4 py-3 whitespace-nowrap ${tone}`}>{r.follow_up_at ? fmtDate(r.follow_up_at) : "—"}</td>
                    {showRef && <td className="px-4 py-3 text-text-mid">{r.referred_by || "—"}</td>}
                    {seeOwners && <td className="px-4 py-3 text-text-mid whitespace-nowrap">{r.owner?.name || ownerName}</td>}
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={6 + (seeOwners ? 1 : 0) + (showRef ? 1 : 0)} className="px-4 py-10 text-center text-[13px] text-text-muted">No leads.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {open && rows && (
        <LeadEditor lead={open === "new" ? null : open} rows={rows} members={members} ownerName={ownerName}
          source={gzb ? (tab === "meta" ? "cold_call" : tab) : null}
          assign={assign} readOnly={!work} wa={wa} org={org} canLoan={canLoan && work}
          onGo={(href) => router.push(href)}
          onSaved={(r) => { apply(open === "new" ? [r, ...rows] : rows.map((x) => (x.id === r.id ? r : x))); setOpen(null); }}
          onDeleted={(id) => { apply(rows.filter((x) => x.id !== id)); setOpen(null); }}
          onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

type Draft = { name: string; mobile: string; city: string; kw: string; project_cost: string; status: LeadStatus; follow_up_at: string; notes: string; owner_member_id: string;
  source: LeadSource | null; referred_by: string };

// `source`: Sustera asks where the lead came from (a new one starts on the open tab); null = not asked.
function LeadEditor({ lead, rows, members, ownerName, source, assign, readOnly, wa, org, canLoan, onGo, onSaved, onDeleted, onClose }: {
  lead: LeadRow | null; rows: LeadRow[]; members: MemberRow[]; ownerName: string; source: LeadSource | null;
  assign: boolean; readOnly: boolean;
  wa: boolean; org: string; canLoan: boolean; onGo: (href: string) => void;
  onSaved: (r: LeadRow) => void; onDeleted: (id: string) => void; onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(() => ({
    name: lead?.name ?? "", mobile: lead?.mobile ?? "", city: lead?.city ?? "",
    kw: lead?.kw != null ? String(lead.kw) : "", project_cost: lead?.project_cost != null ? String(lead.project_cost) : "",
    status: lead?.status ?? "new", follow_up_at: lead?.follow_up_at ?? "", notes: lead?.notes ?? "",
    owner_member_id: lead ? lead.owner_member_id ?? "" : getBusiness()?.member?.id ?? "", // a new lead: the person adding it
    source: source && lead ? sourceOf(lead) : source, referred_by: lead?.referred_by ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  // A lead owned by someone who isn't in the list (switched off) keeps its owner.
  const owners = lead?.owner_member_id && !members.some((m) => m.id === lead.owner_member_id) && lead.owner
    ? [...members, { id: lead.owner_member_id, name: lead.owner.name } as MemberRow] : members;

  async function save() {
    if (!d.name.trim()) { setError("Enter the customer's name."); return; }
    if (d.mobile && !MOBILE_RE.test(d.mobile)) { setError("Enter a valid 10-digit mobile."); return; }
    if (d.source === "reference" && !d.referred_by.trim()) { setError("Enter whose reference it is."); return; }
    setBusy(true); setError(null);
    try {
      if (d.mobile && d.mobile !== (lead?.mobile ?? "")) {
        const mine = rows.find((r) => r.mobile === d.mobile && r.id !== lead?.id);
        if (mine && !(await askConfirm(`${mine.name} already has this mobile in your leads. Save anyway?`))) return;
        if (await filedElsewhere(d.mobile).catch(() => false)
            && !(await askConfirm("This customer has already applied for a loan through another partner. Save the lead anyway?"))) return;
      }
      onSaved(await saveLead(lead?.id ?? null, {
        name: d.name, mobile: d.mobile || null, city: d.city || null,
        kw: d.kw ? Number(d.kw) : null, project_cost: d.project_cost ? Number(d.project_cost) : null,
        status: d.status, follow_up_at: d.follow_up_at || null, notes: d.notes || null,
        owner_member_id: assign ? d.owner_member_id || null : lead?.owner_member_id ?? null,
        source: d.source ?? lead?.source ?? null, referred_by: d.source ? d.referred_by : lead?.referred_by ?? null,
      }));
    } catch (e) { setError((e as Error).message || "Couldn't save the lead."); }
    finally { setBusy(false); }
  }

  // A won lead becomes a project (once — an existing one opens instead).
  async function toProject() {
    if (!lead) return;
    setBusy(true); setError(null);
    try {
      const have = (await fetchProjects()).find((p) => p.lead_id === lead.id || (!!lead.application_id && p.application_id === lead.application_id));
      onGo(`/dashboard/projects?open=${(have ?? (await projectFromLead(lead))).id}`);
    } catch (e) { setError((e as Error).message || "Couldn't make the project."); setBusy(false); }
  }

  async function remove() {
    if (!lead || !(await askConfirm(`Delete the lead ${lead.name}? This can't be undone.`, { danger: true }))) return;
    setBusy(true); setError(null);
    try { await deleteLead(lead.id); onDeleted(lead.id); }
    catch (e) { setError((e as Error).message || "Couldn't delete the lead."); setBusy(false); }
  }

  return (
    <Modal onClose={onClose} closeOnBackdrop="mousedown" busy={busy} overlayClassName={OVERLAY.soft} className="bg-white rounded-2xl shadow-xl w-full max-w-[640px] max-h-[92vh] overflow-y-auto p-6" aria-labelledby={titleId}>
      <div id={titleId} className="text-[17px] font-display font-bold text-cc-ink mb-4">{lead ? lead.name : "New lead"}</div>
      <fieldset disabled={readOnly || busy} className="grid sm:grid-cols-2 gap-3">
        {d.source && (
          <>
            <Field l="Source" req>
              <div className="flex gap-1.5">
                {LEAD_SOURCES.map((x) => (
                  <button key={x} type="button" onClick={() => set("source", x)} aria-pressed={d.source === x}
                    className={["flex-1 px-3 py-2.5 rounded-xl text-[13.5px] font-semibold border", d.source === x ? "text-white border-transparent" : "bg-white border-line text-text-mid"].join(" ")}
                    style={d.source === x ? { background: NAVY } : undefined}>
                    {LEAD_SOURCE_LABEL[x]}
                  </button>
                ))}
              </div>
            </Field>
            {d.source === "reference"
              ? <Field l="Reference from" req><input className={input} value={d.referred_by} onChange={(e) => set("referred_by", e.target.value)} placeholder="Name" /></Field>
              : <div className="hidden sm:block" />}
          </>
        )}
        <Field l="Customer name" req><input className={input} value={d.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field l="Mobile"><input className={input} inputMode="numeric" value={d.mobile} onChange={(e) => set("mobile", digits(e.target.value).slice(0, 10))} placeholder="10-digit mobile" /></Field>
        <Field l="City"><input className={input} value={d.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field l="System size (kW)"><input className={input} inputMode="decimal" value={d.kw} onChange={(e) => set("kw", decimal(e.target.value))} /></Field>
        <Field l="Project cost ₹"><input className={input} inputMode="decimal" value={d.project_cost} onChange={(e) => set("project_cost", decimal(e.target.value))} /></Field>
        <Field l="Status">
          <select className={input} value={d.status} onChange={(e) => set("status", e.target.value as LeadStatus)}>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field l="Follow-up date"><DateField value={d.follow_up_at} onChange={(v) => set("follow_up_at", v)} className={input} /></Field>
        {assign && (
          <Field l="Lead owner">
            <select className={input} value={d.owner_member_id} onChange={(e) => set("owner_member_id", e.target.value)}>
              <option value="">{ownerName}</option>
              {owners.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field l="Notes"><textarea className={input + " min-h-[80px]"} value={d.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
      </fieldset>
      {lead && (
        <div className="flex items-center gap-4 flex-wrap mt-4 pt-4 border-t border-line text-[13px] font-semibold">
          {lead.mobile && <WhatsAppButton on={wa} onClick={() => whatsAppLead(lead.name, lead.mobile, org)} />}
          {lead.application_id
            ? <button type="button" onClick={() => onGo(`/dashboard/${lead.application_id}`)} className="text-navy hover:underline">Open loan</button>
            : canLoan && <button type="button" onClick={() => onGo(`/dashboard/apply/chat?lead=${lead.id}`)} className="text-navy hover:underline">Apply for loan</button>}
          {!readOnly && lead.status === "won" && (
            <button type="button" onClick={() => void toProject()} disabled={busy} className="text-navy hover:underline disabled:opacity-60">Create project</button>
          )}
        </div>
      )}
      {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}
      <div className="flex items-center gap-2 mt-5">
        {!readOnly && lead && (
          <button type="button" onClick={() => void remove()} disabled={busy} className="px-3 py-2 rounded-xl text-[13.5px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">Delete</button>
        )}
        <button type="button" onClick={onClose} disabled={busy} className="ml-auto px-4 py-2.5 rounded-xl text-[13.5px] font-semibold text-text-mid hover:bg-bg-soft disabled:opacity-60">{readOnly ? "Close" : "Cancel"}</button>
        {!readOnly && (
          <button type="button" onClick={() => void save()} disabled={busy} className="px-5 py-2.5 rounded-xl text-white text-[13.5px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
    </Modal>
  );
}

// Sustera's Meta tab: the gozerobils.com enquiries, read only — CC works them (status,
// follow-ups, calls) in its gozerobils page; here they can be called or WhatsApped.
function MetaLeads({ rows, failed, q, wa, org, today }: {
  rows: GzbLead[] | null; failed: boolean; q: string; wa: boolean; org: string; today: string;
}) {
  const t = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !t || [r.name, r.mobile, r.city, r.pincode].some((v) => String(v ?? "").toLowerCase().includes(t)));
  const statusLabel = (v: string) => LEAD_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;
  if (failed) return <p className="text-[13px] text-red-600">Couldn&apos;t load the Meta leads. Please refresh.</p>;
  if (!rows) return <p className="text-[13px] text-text-muted">Loading…</p>;
  return (
    <div className="bg-white rounded-2xl border border-line overflow-x-auto">
      <table className="w-full text-[13.5px] min-w-[860px]">
        <thead>
          <tr className="text-left text-[12px] uppercase tracking-wide text-text-muted border-b border-line">
            <th className="px-4 py-3 font-semibold">Customer</th>
            <th className="px-4 py-3 font-semibold">City</th>
            <th className="px-4 py-3 font-semibold">Monthly bill</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Follow-up</th>
            <th className="px-4 py-3 font-semibold">Last call</th>
            <th className="px-4 py-3 font-semibold">Received</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3">
                <div className="font-medium text-text">{r.name || "—"}</div>
                <div className="text-[12px] text-text-muted">+91 {r.mobile}</div>
                {r.looking_for && <div className="text-[12px] text-text-muted">{words(r.looking_for)}</div>}
              </td>
              <td className="px-4 py-3 text-text-mid">{[r.city, r.pincode].filter(Boolean).join(" · ") || "—"}</td>
              <td className="px-4 py-3 text-text-mid">{words(r.monthly_bill) || "—"}</td>
              <td className="px-4 py-3"><span className={`px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap ${GZB_STATUS_PILL[r.status] ?? ""}`}>{statusLabel(r.status)}</span></td>
              <td className={`px-4 py-3 whitespace-nowrap ${r.follow_up_at && r.follow_up_at < today ? "text-red-600 font-semibold" : r.follow_up_at === today ? "text-amber-700 font-semibold" : "text-text-mid"}`}>
                {r.follow_up_at ? fmtDate(r.follow_up_at) : "—"}
              </td>
              <td className="px-4 py-3 text-text-mid whitespace-nowrap">
                {r.last_call_at ? <>{OUTCOME_LABEL[r.last_outcome as Outcome] ?? r.last_outcome}<div className="text-[12px] text-text-muted">{fmtDate(r.last_call_at)}</div></> : "—"}
              </td>
              <td className="px-4 py-3 text-text-mid whitespace-nowrap">{fmtDate(r.created_at)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3 justify-end text-[13px] font-semibold whitespace-nowrap">
                  <a href={tel(r.mobile)} className="text-navy hover:underline">Call</a>
                  <WhatsAppButton on={wa} onClick={() => whatsAppLead(r.name || "", r.mobile, org)} />
                </div>
              </td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr><td colSpan={8} className="px-4 py-10 text-center text-[13px] text-text-muted">No leads.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
