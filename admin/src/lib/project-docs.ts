// A project's document vault (Partner Portal v2): its site photos, the files
// filed for it (epc_project_documents, 0129) and — for everyone but Site staff —
// its loan's documents from BOTH stores (user_application_docs rows + the *_path
// columns on epc_applications). Everyone who sees the project may use it; RLS
// decides what each person reads, adds or deletes. Site staff never see money
// papers (the loan's documents, an invoice copy).
//
// One database read builds the list (vaultEntries — shared by the server routes:
// /api/epc/project-docs signs it, /api/epc/project-zip zips it). The portal keeps
// the list a few minutes in the tab and updates it in place after an upload or a
// delete — never a re-read.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { JwtClaims } from "./jwt";
import { getBusiness, getToken } from "./auth";
import { getCached, setCached } from "./list-cache";
import { fmtDateIST } from "./dates";
import { LOAN_PATH_COLUMNS } from "./loan-doc-checklist";
import { openWhatsApp } from "./wa-link";
import type { ProjectRow } from "./projects";

export type VaultGroup = "Site photos" | "Project documents" | "Loan documents";
export const VAULT_GROUPS: VaultGroup[] = ["Site photos", "Project documents", "Loan documents"];
/** One file as the portal shows it — url is a 1-hour link; id only for a project document. */
export type VaultFile = { group: VaultGroup; name: string; url: string; id?: string; deletable: boolean };

export type ProjectDocCategory = "agreement" | "net_metering" | "discom_approval" | "invoice_copy" | "other";
export const PROJECT_DOC_CATEGORIES: { key: ProjectDocCategory; label: string }[] = [
  { key: "agreement", label: "Agreement" },
  { key: "net_metering", label: "Net metering" },
  { key: "discom_approval", label: "DISCOM approval" },
  { key: "invoice_copy", label: "Invoice copy" },
  { key: "other", label: "Other" },
];
/** Project documents Site staff never see (money). */
export const MONEY_DOC_CATEGORIES = new Set<string>(["invoice_copy"]);
export const isProjectDocCategory = (c: string): c is ProjectDocCategory => PROJECT_DOC_CATEGORIES.some((x) => x.key === c);

/** "Agreement · deed.pdf" — a project document's name in the vault. */
export function projectDocName(category: string, fileName: string | null | undefined): string {
  const label = PROJECT_DOC_CATEGORIES.find((x) => x.key === category)?.label ?? pretty(category);
  return fileName ? `${label} · ${fileName}` : label;
}

// The loan's documents in words: the *_path columns, then the user_application_docs categories.
const LOAN_COLUMN_LABEL: Record<(typeof LOAN_PATH_COLUMNS)[number], string> = {
  aadhaar_front_path: "Aadhaar (front)", aadhaar_back_path: "Aadhaar (back)", aadhaar_face_path: "Aadhaar photo",
  ebill_path: "Electricity bill", proforma_invoice_path: "Quotation / Proforma", bank_statement_path: "Bank statement",
  customer_photo_path: "Applicant photo", rooftop_photo_path: "Rooftop photo", coapp_pan_path: "Co-applicant PAN",
  coapp_aadhaar_front_path: "Co-applicant Aadhaar (front)", coapp_aadhaar_back_path: "Co-applicant Aadhaar (back)",
  coapp_aadhaar_face_path: "Co-applicant Aadhaar photo",
};
const LOAN_CATEGORY_LABEL: Record<string, string> = {
  borrower_pan: "PAN card", borrower_aadhaar: "Aadhaar", borrower_photo: "Rooftop photo", rooftop_photo_extra: "Rooftop photo",
  customer_photo: "Applicant photo", quotation: "Quotation", electricity_bill: "Electricity bill", bank_statement: "Bank statement",
  income_proof: "Income proof", property_doc: "Property document", sanction_letter: "Sanction letter",
  disbursement_advice: "Disbursement advice", feasibility_report: "Feasibility report", mmr_advance_receipt: "Advance receipt",
  completion_invoice: "Completion invoice", completion_report: "Completion report", completion_plant_photo: "Plant photo",
  completion_panel_photo: "Panel photo", completion_inverter_photo: "Inverter photo", completion_meter_photo: "Meter photo",
  other: "Other document",
};
function pretty(c: string): string {
  const s = (c || "document").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Server: the vault's files (read with the caller's token — RLS decides) ────
/** A file before it is signed / zipped. */
export type VaultEntry = Omit<VaultFile, "url"> & { path: string; mime: string | null };
/** Who is asking (from the login token). manager = Owner / Admin (deletes any project document). */
export type VaultViewer = { site: boolean; manager: boolean; memberId: string | null };
/** The viewer from the login token's claims (the database checks the role again, live). */
export const vaultViewer = (c: Pick<JwtClaims, "business_type" | "member_id" | "member_role">): VaultViewer => ({
  site: c.member_role === "SITE",
  manager: c.business_type !== "admin" && (!c.member_id || c.member_role === "ADMIN"),
  memberId: c.member_id ?? null,
});

type Photo = { path: string; at?: string | null };
type DocRow = { id: string; category: string; storage_path: string; file_name: string | null; mime_type: string | null; created_by_member: string | null; created_at: string };
type LoanFile = { category: string; storage_path: string; file_name: string | null; mime_type: string | null };
type Raw = {
  customer_name: string; photos: Photo[] | null; docs: DocRow[] | null;
  loan?: (Record<string, unknown> & { files?: LoanFile[] | null }) | Array<Record<string, unknown> & { files?: LoanFile[] | null }> | null;
};

/** The project's files in vault order, or null when the caller can't see the project. One read. */
export async function vaultEntries(db: SupabaseClient, projectId: string, who: VaultViewer): Promise<{ customer: string; entries: VaultEntry[] } | null> {
  const loan = who.site ? ""
    : `, loan:epc_applications!epc_projects_application_id_fkey(${LOAN_PATH_COLUMNS.join(", ")}, files:user_application_docs(category, storage_path, file_name, mime_type))`;
  const { data, error } = await db.from("epc_projects")
    .select(`customer_name, photos, docs:epc_project_documents!epc_project_documents_project_id_fkey(id, category, storage_path, file_name, mime_type, created_by_member, created_at)${loan}`)
    .eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const p = data as unknown as Raw;
  const out: VaultEntry[] = [];

  const photos = [...(p.photos ?? [])].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
  photos.forEach((ph, i) => out.push({
    group: "Site photos", name: `Site photo ${i + 1}${ph.at ? ` · ${fmtDateIST(ph.at)}` : ""}`, path: ph.path, mime: "image/jpeg", deletable: false,
  }));

  const docs = [...(p.docs ?? [])].filter((d) => !who.site || !MONEY_DOC_CATEGORIES.has(d.category))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const d of docs) out.push({
    group: "Project documents", name: projectDocName(d.category, d.file_name), path: d.storage_path, mime: d.mime_type, id: d.id,
    deletable: who.manager || (!!who.memberId && d.created_by_member === who.memberId),
  });

  const l = Array.isArray(p.loan) ? p.loan[0] ?? null : p.loan ?? null;
  if (l) {
    const seen = new Set<string>();
    const add = (name: string, path: unknown, mime: string | null) => {
      if (typeof path !== "string" || !path || seen.has(path)) return;
      seen.add(path);
      out.push({ group: "Loan documents", name, path, mime, deletable: false });
    };
    for (const c of LOAN_PATH_COLUMNS) add(LOAN_COLUMN_LABEL[c], l[c], null);
    for (const f of l.files ?? []) add(LOAN_CATEGORY_LABEL[f.category] ?? pretty(f.category), f.storage_path, f.mime_type);
  }

  // The same name twice in a group ("Rooftop photo") → "Rooftop photo (2)".
  const count = new Map<string, number>();
  for (const e of out) {
    const k = `${e.group}|${e.name}`;
    const n = (count.get(k) ?? 0) + 1;
    count.set(k, n);
    if (n > 1) e.name = `${e.name} (${n})`;
  }
  return { customer: p.customer_name, entries: out };
}

// ── Portal ─────────────────────────────────────────────────────────────────
const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });
const listKey = (id: string) => `projectdocs.${getBusiness()?.id ?? ""}.${getBusiness()?.member?.id ?? ""}.${id}`;
const LIST_TTL = 5 * 60_000; // the links inside last an hour

async function json(r: Response, fallback: string) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) throw new Error(j?.error || fallback);
  return j;
}

/** Everything filed for the project (read when the project is opened). */
export async function fetchVault(projectId: string): Promise<VaultFile[]> {
  const hit = getCached<VaultFile[]>(listKey(projectId), LIST_TTL);
  if (hit) return hit;
  const j = await json(await fetch(`/api/epc/project-docs?project=${projectId}`, { headers: auth() }), "Couldn't load the documents.");
  const files = j.files as VaultFile[];
  setCached(listKey(projectId), files);
  return files;
}

/** Files a document for the project; returns the list with it added. */
export async function addVaultDoc(projectId: string, files: VaultFile[], category: ProjectDocCategory, file: File): Promise<VaultFile[]> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("table", "epc_project_documents");
  fd.append("category", category);
  fd.append("project_id", projectId);
  const r = await fetch("/api/upload", { method: "POST", headers: auth(), body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) {
    throw new Error(j?.error === "unsupported_file_type" ? "Choose a PDF or a photo (JPG or PNG)." : j?.error || "Couldn't upload the document.");
  }
  const next = [...files, { group: "Project documents" as const, name: projectDocName(category, file.name), url: String(j.url || ""), id: String(j.id), deletable: true }];
  setCached(listKey(projectId), next);
  return next;
}

/** Deletes a project document (RLS: Owner / Admin, or whoever added it); returns the list without it. */
export async function removeVaultDoc(projectId: string, files: VaultFile[], id: string): Promise<VaultFile[]> {
  await json(await fetch(`/api/document/${id}?in=project`, { method: "DELETE", headers: auth() }), "Couldn't delete the document.");
  const next = files.filter((f) => f.id !== id);
  setCached(listKey(projectId), next);
  return next;
}

/** The whole vault as one ZIP (the caller saves it). */
export async function fetchVaultZip(projectId: string): Promise<{ blob: Blob; name: string }> {
  const r = await fetch(`/api/epc/project-zip?project=${projectId}`, { headers: auth() });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error || "Couldn't make the ZIP."); }
  const name = ((r.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/) || [])[1] || "Project.zip";
  return { blob: await r.blob(), name };
}

/** WhatsApp (paid): the customer gets the latest site photos as 90-day links, in Hindi. */
export async function whatsAppPhotoUpdate(p: Pick<ProjectRow, "id" | "customer_name" | "mobile">, org: string) {
  // Open the tab now (while the click counts); it goes to WhatsApp once the links are ready.
  const win = window.open("", "_blank");
  if (win) win.opener = null;
  try {
    const j = await json(await fetch(`/api/epc/project-docs?project=${p.id}&share=photos`, { method: "POST", headers: auth() }), "Couldn't share the photos.");
    const text = `नमस्ते ${p.customer_name} जी,\n\nआपके सोलर इंस्टॉलेशन की ताज़ा तस्वीरें:\n${(j.links as string[]).join("\n")}\n\n${org}`;
    openWhatsApp(win, p.mobile, text);
  } catch (e) {
    win?.close();
    throw e;
  }
}
