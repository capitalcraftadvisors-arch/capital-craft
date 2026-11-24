"use client";

// Projects — the company's confirmed jobs and the stage each is at (epc_projects,
// 0128): filter by stage, search, add / open one. A project shows its stages
// (the loan stage only for loan / part-loan jobs), days in the current stage,
// site photos (Installation done needs 2) and every stage move. Site staff see
// only the projects given to them and change only the stage, photos and notes.
// Partner Portal v2 — the demo EPC only for now (portalV2).

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAVY } from "@/components/partner/PartnerShell";
import ProjectMoney from "@/components/partner/ProjectMoney";
import ProjectDocuments from "@/components/partner/ProjectDocuments";
import ProjectInvoices from "@/components/partner/ProjectInvoices";
import Modal, { OVERLAY } from "@/components/ui/Modal";
import { input, decimal, digits, Field } from "@/components/quotation/form-kit";
import { getBusiness } from "@/lib/auth";
import { canManageOrg, canWork, epcRole, isSiteStaff, portalV2 } from "@/lib/epc-roles";
import { fetchMembers, type MemberRow } from "@/lib/members";
import { fmtDate } from "@/lib/dates";
import { fmtRupees } from "@/lib/money";
import {
  fetchProjects, fetchHistory, saveProject, saveNotes, setStage, deleteProject, fetchPhotos, addPhoto, removePhoto,
  stagesFor, needsPhotos, daysInStage, PROJECT_STAGES, STAGE_LABEL, PAYMENT_MODES, PAYMENT_LABEL, PHOTOS_NEEDED,
  type ProjectRow, type ProjectStage, type PaymentMode, type Photo, type StageMove,
} from "@/lib/projects";

type Filter = "all" | ProjectStage;
const MOBILE_RE = /^[6-9]\d{9}$/;
const STAGE_PILL = (s: ProjectStage) =>
  s === "closed" ? "bg-[#eef1f5] text-[#475569]" : s === "commissioned" ? "bg-[#e6f6ee] text-[#178a5c]"
  : needsPhotos(s) ? "bg-[#efedff] text-[#5b3fc4]" : "bg-[#e8effc] text-[#1e3a8a]";
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export default function ProjectsPage() {
  const router = useRouter();
  const me = getBusiness();
  const v2 = portalV2(me), site = isSiteStaff(me), role = epcRole(me);
  const work = canWork(me), assign = canManageOrg(me);
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<ProjectRow | "new" | null>(null);
  const [crew, setCrew] = useState<MemberRow[]>([]); // Site staff to give a project to

  useEffect(() => { if (!v2) router.replace("/dashboard" as any); }, [v2, router]);
  useEffect(() => {
    fetchProjects().then((r) => {
      setRows(r);
      // ?open=<id> — a project just made from a lead (or a dashboard row); ?stage=<stage> — a dashboard tile.
      const u = new URLSearchParams(window.location.search);
      const id = u.get("open"), stage = u.get("stage") as ProjectStage | null;
      const hit = id && r.find((p) => p.id === id);
      if (hit) setOpen(hit);
      if (stage && PROJECT_STAGES.includes(stage)) setFilter(stage);
    }, () => setFailed(true));
  }, []);
  useEffect(() => {
    if (open && assign && !crew.length) fetchMembers().then((m) => setCrew(m.filter((x) => x.active && x.member_role === "SITE")), () => {});
  }, [open, assign, crew.length]);

  const count = (f: Filter) => (rows ?? []).filter((r) => f === "all" || r.stage === f).length;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (filter === "all" || r.stage === filter)
      && (!s || [r.customer_name, r.mobile, r.city].some((v) => String(v ?? "").toLowerCase().includes(s))));
  }, [rows, filter, q]);
  const seeCrew = !site && role !== "SALES";

  const replace = (r: ProjectRow) => setRows((all) => (all ?? []).map((x) => (x.id === r.id ? r : x)));

  return (
    <div className="max-w-[1150px]">
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex gap-1.5 flex-wrap">
          {(["all", ...PROJECT_STAGES] as Filter[]).map((k) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={["px-3.5 py-1.5 rounded-full text-[13px] font-semibold border", filter === k ? "text-white border-transparent" : "bg-white border-line text-text-mid"].join(" ")}
              style={filter === k ? { background: NAVY } : undefined}>
              {k === "all" ? "All" : STAGE_LABEL[k]} <span className="opacity-70">{count(k)}</span>
            </button>
          ))}
        </div>
        <input className={input + " max-w-[240px] ml-auto"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile, city" />
        {work && (
          <button type="button" onClick={() => setOpen("new")} className="px-4 py-2.5 rounded-xl text-white text-[13.5px] font-semibold" style={{ background: NAVY }}>
            + New project
          </button>
        )}
      </div>

      {failed ? (
        <p className="text-[13px] text-red-600">Couldn&apos;t load your projects. Please refresh.</p>
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
                {!site && <th className="px-4 py-3 font-semibold text-right">Project cost</th>}
                <th className="px-4 py-3 font-semibold">Payment</th>
                <th className="px-4 py-3 font-semibold">Stage</th>
                <th className="px-4 py-3 font-semibold">In stage</th>
                {seeCrew && <th className="px-4 py-3 font-semibold">Site staff</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r)} className="border-b border-line last:border-0 hover:bg-bg-soft cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text">{r.customer_name}</div>
                    {r.mobile && <div className="text-[12px] text-text-muted">+91 {r.mobile}</div>}
                  </td>
                  <td className="px-4 py-3 text-text-mid">{r.city || "—"}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{r.kw ? `${+Number(r.kw).toFixed(2)} kW` : "—"}</td>
                  {!site && <td className="px-4 py-3 text-right whitespace-nowrap">{r.project_cost ? fmtRupees(r.project_cost) : "—"}</td>}
                  <td className="px-4 py-3 text-text-mid whitespace-nowrap">{PAYMENT_LABEL[r.payment_mode]}</td>
                  <td className="px-4 py-3"><span className={`px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap ${STAGE_PILL(r.stage)}`}>{STAGE_LABEL[r.stage]}</span></td>
                  <td className="px-4 py-3 text-text-mid whitespace-nowrap">{r.stage === "closed" ? "—" : days(daysInStage(r.stage_at))}</td>
                  {seeCrew && <td className="px-4 py-3 text-text-mid whitespace-nowrap">{r.site?.name || "—"}</td>}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[13px] text-text-muted">No projects.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {open && rows && (
        <ProjectEditor project={open === "new" ? null : open} crew={crew} assign={assign} site={site}
          canEdit={work} canDelete={assign} onGo={(href) => router.push(href as any)}
          onSaved={(r, isNew) => { if (isNew) setRows([r, ...rows]); else replace(r); setOpen(r); }}
          onDeleted={(id) => { setRows(rows.filter((x) => x.id !== id)); setOpen(null); }}
          onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

type Draft = { customer_name: string; mobile: string; city: string; kw: string; project_cost: string; payment_mode: PaymentMode; site_member_id: string; notes: string };

function ProjectEditor({ project, crew, assign, site, canEdit, canDelete, onGo, onSaved, onDeleted, onClose }: {
  project: ProjectRow | null; crew: MemberRow[]; assign: boolean; site: boolean;
  canEdit: boolean;   // details (Owner / Admin / Sales)
  canDelete: boolean; // Owner / Admin
  onGo: (href: string) => void;
  onSaved: (r: ProjectRow, isNew: boolean) => void; onDeleted: (id: string) => void; onClose: () => void;
}) {
  const p = project;
  const [d, setD] = useState<Draft>(() => ({
    customer_name: p?.customer_name ?? "", mobile: p?.mobile ?? "", city: p?.city ?? "",
    kw: p?.kw != null ? String(p.kw) : "", project_cost: p?.project_cost != null ? String(p.project_cost) : "",
    payment_mode: p?.payment_mode ?? "cash", site_member_id: p?.site_member_id ?? "", notes: p?.notes ?? "",
  }));
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [history, setHistory] = useState<StageMove[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const work = canEdit || site; // may move the stage, add photos, write notes

  useEffect(() => {
    if (!p) return;
    fetchPhotos(p.id).then(setPhotos, () => setPhotos([]));
    void fetchHistory(p.id).then(setHistory);
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stages = stagesFor(p?.payment_mode ?? d.payment_mode);
  const at = p ? stages.indexOf(p.stage) : -1;
  const next = p && at >= 0 && at < stages.length - 1 ? stages[at + 1] : null;

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message || "Something went wrong."); } finally { setBusy(false); }
  }

  const save = () => run(async () => {
    if (site && p) { onSaved(await saveNotes(p.id, d.notes), false); return; }
    if (!d.customer_name.trim()) throw new Error("Enter the customer's name.");
    if (d.mobile && !MOBILE_RE.test(d.mobile)) throw new Error("Enter a valid 10-digit mobile.");
    const saved = await saveProject(p?.id ?? null, {
      customer_name: d.customer_name, mobile: d.mobile || null, city: d.city || null,
      kw: d.kw ? Number(d.kw) : null, project_cost: d.project_cost ? Number(d.project_cost) : null,
      payment_mode: d.payment_mode, notes: d.notes || null,
      site_member_id: assign ? d.site_member_id || null : p?.site_member_id ?? null,
    }, p);
    onSaved(saved, !p);
  });

  const move = (s: ProjectStage) => run(async () => {
    if (!p) return;
    const saved = await setStage(p.id, s);
    onSaved(saved, false);
    setHistory(await fetchHistory(p.id));
  });

  const upload = (f: File) => run(async () => { if (p) setPhotos(await addPhoto(p.id, f)); });
  const unphoto = (path: string) => {
    if (!p || !window.confirm("Delete this photo? This can't be undone.")) return;
    void run(async () => setPhotos(await removePhoto(p.id, path)));
  };
  const remove = () => {
    if (!p || !window.confirm(`Delete the project ${p.customer_name}? This can't be undone.`)) return;
    void run(async () => { await deleteProject(p.id); onDeleted(p.id); });
  };

  return (
    <Modal onClose={onClose} closeOnBackdrop="mousedown" overlayClassName={OVERLAY.soft} className="bg-white rounded-2xl shadow-xl w-full max-w-[760px] max-h-[92vh] overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="text-[17px] font-display font-bold text-[#0f3d2e]">{p ? p.customer_name : "New project"}</div>
        {p?.application_id && !site && (
          <button type="button" onClick={() => onGo(`/dashboard/${p.application_id}`)} className="text-[13px] font-semibold text-[#1e3a8a] hover:underline">Open loan</button>
        )}
      </div>

      {/* Stages */}
      {p && (
        <div className="mb-5">
          <div className="flex flex-wrap gap-1.5">
            {stages.map((s, i) => (
              <span key={s} className={["px-2.5 py-1 rounded-full text-[12px] font-semibold border",
                i < at ? "bg-[#e6f6ee] text-[#178a5c] border-transparent" : i === at ? "text-white border-transparent" : "bg-white text-text-muted border-line"].join(" ")}
                style={i === at ? { background: NAVY } : undefined}>
                {i < at ? "✓ " : ""}{STAGE_LABEL[s]}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-3 text-[13px]">
            <span className="text-text-mid">{p.stage === "closed" ? STAGE_LABEL.closed : `${STAGE_LABEL[p.stage]} · ${days(daysInStage(p.stage_at))}`}</span>
            {work && next && (
              <button type="button" onClick={() => void move(next)} disabled={busy}
                className="px-3.5 py-1.5 rounded-xl text-white text-[13px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
                Move to {STAGE_LABEL[next]}
              </button>
            )}
            {work && (
              <select className={input + " max-w-[220px]"} value={p.stage} disabled={busy} onChange={(e) => void move(e.target.value as ProjectStage)}>
                {stages.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Site photos */}
      {p && (
        <div className="mb-5">
          <div className="text-[12.5px] font-medium text-text-mid mb-2">Site photos {photos ? `${photos.length}/${PHOTOS_NEEDED}` : ""}</div>
          <div className="flex flex-wrap gap-2">
            {(photos ?? []).map((ph) => (
              <div key={ph.path} className="relative w-24 h-24 rounded-xl overflow-hidden border border-line bg-bg-soft">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <a href={ph.url} target="_blank" rel="noreferrer"><img src={ph.url} alt="" className="w-full h-full object-cover" /></a>
                {work && (
                  <button type="button" onClick={() => unphoto(ph.path)} disabled={busy} aria-label="Delete photo"
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 text-red-600 text-[13px] font-bold grid place-items-center">×</button>
                )}
              </div>
            ))}
            {work && (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                className="w-24 h-24 rounded-xl border-2 border-dashed border-line text-text-muted text-[22px] grid place-items-center hover:border-[#1e3a8a] hover:text-[#1e3a8a] disabled:opacity-60">+</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          </div>
        </div>
      )}

      {/* Money, documents, invoices (Site staff: documents only) */}
      {p && !site && <ProjectMoney project={p} canEdit={canEdit} onChanged={(r) => onSaved(r, false)} />}
      {p && <ProjectDocuments project={p} canUpload={work} />}
      {p && !site && <ProjectInvoices project={p} canIssue={canEdit} />}

      {/* Details */}
      <fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3">
        <fieldset disabled={!canEdit} className="contents">
          <Field l="Customer name" req><input className={input} value={d.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></Field>
          <Field l="Mobile"><input className={input} inputMode="numeric" value={d.mobile} onChange={(e) => set("mobile", digits(e.target.value).slice(0, 10))} placeholder="10-digit mobile" /></Field>
          <Field l="City"><input className={input} value={d.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field l="System size (kW)"><input className={input} inputMode="decimal" value={d.kw} onChange={(e) => set("kw", decimal(e.target.value))} /></Field>
          {!site && <Field l="Project cost ₹"><input className={input} inputMode="decimal" value={d.project_cost} onChange={(e) => set("project_cost", decimal(e.target.value))} /></Field>}
          <Field l="Payment">
            <select className={input} value={d.payment_mode} onChange={(e) => set("payment_mode", e.target.value as PaymentMode)}>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
            </select>
          </Field>
          {assign && (
            <Field l="Site staff">
              <select className={input} value={d.site_member_id} onChange={(e) => set("site_member_id", e.target.value)}>
                <option value="">—</option>
                {crew.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                {p?.site_member_id && p.site && !crew.some((m) => m.id === p.site_member_id) && <option value={p.site_member_id}>{p.site.name}</option>}
              </select>
            </Field>
          )}
        </fieldset>
        <div className="sm:col-span-2">
          <Field l="Notes"><textarea className={input + " min-h-[70px]"} value={d.notes} disabled={!work} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
      </fieldset>

      {/* Stage moves */}
      {history.length > 0 && (
        <div className="mt-5">
          <div className="text-[12.5px] font-medium text-text-mid mb-1.5">History</div>
          <div className="flex flex-col gap-1 text-[13px]">
            {[...history].reverse().map((h, i) => (
              <div key={i} className="flex justify-between gap-3"><span className="text-text">{STAGE_LABEL[h.stage] ?? h.stage}</span><span className="text-text-muted">{fmtDate(h.at)}</span></div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}
      <div className="flex items-center gap-2 mt-5">
        {canDelete && p && (
          <button type="button" onClick={remove} disabled={busy} className="px-3 py-2 rounded-xl text-[13.5px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">Delete</button>
        )}
        <button type="button" onClick={onClose} className="ml-auto px-4 py-2.5 rounded-xl text-[13.5px] font-semibold text-text-mid hover:bg-bg-soft">{work ? "Cancel" : "Close"}</button>
        {work && (
          <button type="button" onClick={() => void save()} disabled={busy} className="px-5 py-2.5 rounded-xl text-white text-[13.5px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
    </Modal>
  );
}
