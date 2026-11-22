// An EPC's projects (epc_projects, 0128) â€” Partner Portal v2. A project is a
// confirmed job: customer, size, cost, payment mode, the stage it is at and its
// site photos. RLS scopes the reads (Sales: the ones they made; Site staff: the
// ones given to them). The list is one narrow read (no history / photos) kept for
// a few minutes in the tab and dropped on every change.

import { supabase } from "./supabase";
import { getBusiness, getToken } from "./auth";
import { getCached, invalidate, setCached } from "./list-cache";
import type { LeadRow } from "./leads";
import { dashboardChanged } from "./dashboard-v2";

export type ProjectStage = "quote_won" | "site_survey" | "loan_in_process" | "material_dispatched"
  | "installation_done" | "net_metering_applied" | "commissioned" | "closed";
export const PROJECT_STAGES: ProjectStage[] = ["quote_won", "site_survey", "loan_in_process", "material_dispatched",
  "installation_done", "net_metering_applied", "commissioned", "closed"];
export const STAGE_LABEL: Record<ProjectStage, string> = {
  quote_won: "Quote won", site_survey: "Site survey", loan_in_process: "Loan in process", material_dispatched: "Material dispatched",
  installation_done: "Installation done", net_metering_applied: "Net metering applied", commissioned: "Commissioned", closed: "Closed",
};
export type PaymentMode = "cash" | "loan" | "part_loan";
export const PAYMENT_MODES: PaymentMode[] = ["cash", "loan", "part_loan"];
export const PAYMENT_LABEL: Record<PaymentMode, string> = { cash: "Cash", loan: "Loan", part_loan: "Part loan" };
/** Installation done and every stage after it need this many site photos. */
export const PHOTOS_NEEDED = 2;

/** The stages a project goes through â€” the loan stage only for loan / part loan. */
export const stagesFor = (mode: PaymentMode) => PROJECT_STAGES.filter((s) => s !== "loan_in_process" || mode !== "cash");
export const needsPhotos = (s: ProjectStage) => PROJECT_STAGES.indexOf(s) >= PROJECT_STAGES.indexOf("installation_done");
/** Whole days since the project reached its stage. */
export const daysInStage = (stageAt: string) => Math.max(0, Math.floor((Date.now() - new Date(stageAt).getTime()) / 86_400_000));

export type ProjectRow = {
  id: string; lead_id: string | null; application_id: string | null; insurance_application_id: string | null;
  customer_name: string; mobile: string | null; city: string | null; kw: number | null;
  payment_mode: PaymentMode; stage: ProjectStage; stage_at: string; notes: string | null;
  site_member_id: string | null; site: { name: string } | null; created_at: string;
  // The money (epc_project_finance, 0128) â€” null for Site staff, who never read it.
  project_cost: number | null; payment_due_on: string | null;
};
export type ProjectInput = Pick<ProjectRow, "customer_name" | "mobile" | "city" | "kw" | "project_cost" | "payment_mode" | "site_member_id" | "notes">
  & { payment_due_on?: string | null };
export type StageMove = { stage: ProjectStage; at: string; by: string | null };
export type Photo = { path: string; at: string; url: string };

const COLS = "id, lead_id, application_id, insurance_application_id, customer_name, mobile, city, kw, payment_mode, stage, stage_at, notes, site_member_id, created_at, " +
  "site:epc_members!epc_projects_site_member_id_fkey(name), finance:epc_project_finance(project_cost, payment_due_on)";
const listKey = () => `projects.${getBusiness()?.id ?? ""}.${getBusiness()?.member?.id ?? ""}`;
const LIST_TTL = 5 * 60_000;
type Finance = { project_cost: number | null; payment_due_on: string | null };
type Raw = Omit<ProjectRow, "site" | "project_cost" | "payment_due_on"> & {
  site: { name: string } | { name: string }[] | null; finance: Finance | Finance[] | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const row = ({ finance, site, ...r }: Raw): ProjectRow => {
  const f = one(finance);
  return { ...r, site: one(site), project_cost: f?.project_cost ?? null, payment_due_on: f?.payment_due_on ?? null };
};
/** Drop the cached list and the dashboard's figures (a project or its money changed). */
export const projectsChanged = () => { invalidate(listKey()); dashboardChanged(); };

// The database's refusals (0128) in plain words.
function friendly(e: { message?: string } | null): Error {
  const m = e?.message || "";
  if (/two_photos_needed/.test(m)) return new Error(`Add ${PHOTOS_NEEDED} site photos first.`);
  if (/loan_stage_cash/.test(m)) return new Error("A cash project has no loan stage.");
  if (/site_staff_limit|row-level|42501/.test(m)) return new Error("You don't have access to change this project.");
  return new Error(m || "Something went wrong.");
}

/** The company's projects, newest first (the latest 500). */
export async function fetchProjects(): Promise<ProjectRow[]> {
  const hit = getCached<ProjectRow[]>(listKey(), LIST_TTL);
  if (hit) return hit;
  const { data, error } = await supabase().from("epc_projects").select(COLS).order("created_at", { ascending: false }).limit(500);
  if (error) throw friendly(error);
  const rows = ((data ?? []) as unknown as Raw[]).map(row);
  setCached(listKey(), rows);
  return rows;
}

/** One project's stage moves, oldest first (read when it is opened). */
export async function fetchHistory(id: string): Promise<StageMove[]> {
  const { data } = await supabase().from("epc_projects").select("history").eq("id", id).maybeSingle();
  return ((data as { history?: StageMove[] } | null)?.history ?? []);
}

/** Saves the project, then its money (a second write, only when it changed). */
export async function saveProject(id: string | null, v: ProjectInput & { lead_id?: string | null; application_id?: string | null }, before?: ProjectRow | null): Promise<ProjectRow> {
  const { project_cost, payment_due_on, ...rest } = v;
  const cols = { ...rest, customer_name: v.customer_name.trim(), mobile: v.mobile || null, city: v.city?.trim() || null, notes: v.notes?.trim() || null };
  const q = id
    ? supabase().from("epc_projects").update(cols).eq("id", id).select(COLS).single()
    : supabase().from("epc_projects").insert({ ...cols, business_id: getBusiness()?.id }).select(COLS).single();
  const { data, error } = await q;
  if (error) throw friendly(error);
  let saved = row(data as unknown as Raw);
  const due = payment_due_on === undefined ? before?.payment_due_on ?? null : payment_due_on;
  if (project_cost !== (before?.project_cost ?? null) || due !== (before?.payment_due_on ?? null)) {
    const { error: e } = await supabase().from("epc_project_finance")
      .upsert({ project_id: saved.id, business_id: getBusiness()?.id, project_cost, payment_due_on: due, updated_at: new Date().toISOString() }, { onConflict: "project_id" });
    if (e) throw friendly(e);
    saved = { ...saved, project_cost, payment_due_on: due };
  }
  projectsChanged();
  return saved;
}

export async function setStage(id: string, stage: ProjectStage): Promise<ProjectRow> {
  const { data, error } = await supabase().from("epc_projects").update({ stage }).eq("id", id).select(COLS).single();
  if (error) throw friendly(error);
  projectsChanged();
  return row(data as unknown as Raw);
}

/** Notes only â€” what Site staff may change besides the stage and photos. */
export async function saveNotes(id: string, notes: string): Promise<ProjectRow> {
  const { data, error } = await supabase().from("epc_projects").update({ notes: notes.trim() || null }).eq("id", id).select(COLS).single();
  if (error) throw friendly(error);
  projectsChanged();
  return row(data as unknown as Raw);
}

export async function deleteProject(id: string) {
  const { error } = await supabase().from("epc_projects").delete().eq("id", id);
  if (error) throw friendly(error);
  projectsChanged();
}

/** A new project from a won lead (its loan, if one was applied for). */
export const projectFromLead = (l: LeadRow) => saveProject(null, {
  customer_name: l.name, mobile: l.mobile, city: l.city, kw: l.kw, project_cost: l.project_cost,
  payment_mode: l.application_id ? "loan" : "cash", site_member_id: null, notes: null,
  lead_id: l.id, application_id: l.application_id,
});

// â”€â”€ Site photos (/api/epc/project-photo) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });
async function photoCall(res: Promise<Response>): Promise<Photo[]> {
  const r = await res;
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) throw new Error(j?.error || "Couldn't load the photos.");
  return j.photos as Photo[];
}
export const fetchPhotos = (id: string) => photoCall(fetch(`/api/epc/project-photo?project=${id}`, { headers: auth() }));
export function addPhoto(id: string, file: File) {
  const fd = new FormData();
  fd.append("project", id);
  fd.append("file", file);
  return photoCall(fetch("/api/epc/project-photo", { method: "POST", headers: auth(), body: fd }));
}
export const removePhoto = (id: string, path: string) =>
  photoCall(fetch(`/api/epc/project-photo?project=${id}&path=${encodeURIComponent(path)}`, { method: "DELETE", headers: auth() }));
