"use client";

// A project's document vault inside the project editor (Partner Portal v2,
// lib/project-docs): its site photos, its documents and — not for Site staff —
// its loan's documents, grouped; each opens in a new tab. Whoever may work on the
// project (canUpload — Site staff too) adds a document and sends the customer a
// Hindi photo update on WhatsApp (paid); the Owner / Admin or whoever added a
// document may delete it. "Download all" saves one ZIP. The list is read once,
// when the editor opens, and updated in place after an upload or a delete.

import { useEffect, useRef, useState } from "react";
import WhatsAppButton from "@/components/partner/WhatsAppButton";
import { NAVY } from "@/components/partner/PartnerShell";
import { input } from "@/components/quotation/form-kit";
import { saveUrl } from "@/lib/storage";
import { getBusiness } from "@/lib/auth";
import { isSiteStaff, portalV2 } from "@/lib/epc-roles";
import { fetchEpcName } from "@/lib/epc-name";
import { fetchWhatsAppOn } from "@/lib/subscription";
import {
  addVaultDoc, fetchVault, fetchVaultZip, removeVaultDoc, whatsAppPhotoUpdate,
  MONEY_DOC_CATEGORIES, PROJECT_DOC_CATEGORIES, VAULT_GROUPS, type ProjectDocCategory, type VaultFile,
} from "@/lib/project-docs";
import type { ProjectRow } from "@/lib/projects";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export default function ProjectDocuments({ project, canUpload }: { project: ProjectRow; canUpload: boolean }) {
  const me = getBusiness();
  const v2 = portalV2(me), site = isSiteStaff(me);
  const [files, setFiles] = useState<VaultFile[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState<ProjectDocCategory>("agreement");
  const [busy, setBusy] = useState(""); // "upload" | "zip" | "wa" | "del:<id>"
  const [error, setError] = useState<string | null>(null);
  const [wa, setWa] = useState(false);
  const [org, setOrg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const categories = PROJECT_DOC_CATEGORIES.filter((c) => !site || !MONEY_DOC_CATEGORIES.has(c.key));

  useEffect(() => {
    if (!v2) return;
    setFiles(null); setFailed(false);
    fetchVault(project.id).then(setFiles, () => setFailed(true));
  }, [v2, project.id]);
  // WhatsApp (paid) + the company's name for the message — both cached reads.
  useEffect(() => {
    if (v2 && canUpload) { fetchWhatsAppOn().then(setWa, () => {}); void fetchEpcName().then(setOrg); }
  }, [v2, canUpload]);

  if (!v2) return null;

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message || "Something went wrong."); } finally { setBusy(""); }
  }
  const upload = (f: File) => run("upload", async () => setFiles(await addVaultDoc(project.id, files ?? [], category, f)));
  const remove = (f: VaultFile) => {
    if (!f.id || !window.confirm(`Delete ${f.name}? This can't be undone.`)) return;
    const id = f.id;
    void run(`del:${id}`, async () => setFiles(await removeVaultDoc(project.id, files ?? [], id)));
  };
  const zip = () => run("zip", async () => {
    const { blob, name } = await fetchVaultZip(project.id);
    const url = URL.createObjectURL(blob);
    saveUrl(url, name);
    URL.revokeObjectURL(url);
  });
  const share = () => run("wa", () => whatsAppPhotoUpdate(project, org));

  return (
    <div className="mb-5">
      <div className="flex items-center gap-4 flex-wrap mb-2">
        <div className="text-[12.5px] font-medium text-text-mid">Documents</div>
        <div className="ml-auto flex items-center gap-4">
          {canUpload && <WhatsAppButton on={wa} busy={busy === "wa"} onClick={() => void share()} label="Photo update" />}
          <button type="button" onClick={() => void zip()} disabled={!files?.length || !!busy}
            className="text-[13px] font-semibold text-[#1e3a8a] hover:underline disabled:opacity-50 disabled:no-underline">
            {busy === "zip" ? "Preparing…" : "Download all"}
          </button>
        </div>
      </div>

      {failed ? (
        <p className="text-[13px] text-red-600">Couldn&apos;t load the documents.</p>
      ) : !files ? (
        <p className="text-[13px] text-text-muted">Loading…</p>
      ) : (
        <div className="rounded-xl border border-line divide-y divide-line">
          {VAULT_GROUPS.map((g) => {
            const list = files.filter((f) => f.group === g);
            if (!list.length) return null;
            return (
              <div key={g} className="px-3.5 py-2.5">
                <div className="text-[11.5px] uppercase tracking-wide font-semibold text-text-muted mb-1.5">{g}</div>
                <div className="flex flex-col gap-1">
                  {list.map((f, i) => (
                    <div key={f.id ?? `${g}.${i}`} className="flex items-center gap-3 text-[13px] min-w-0">
                      {f.url
                        ? <a href={f.url} target="_blank" rel="noreferrer" className="text-text hover:text-[#1e3a8a] hover:underline truncate">{f.name}</a>
                        : <span className="text-text-muted truncate">{f.name}</span>}
                      {f.deletable && f.id && (
                        <button type="button" onClick={() => remove(f)} disabled={!!busy}
                          className="ml-auto shrink-0 text-[12.5px] font-semibold text-red-600 hover:underline disabled:opacity-60">
                          {busy === `del:${f.id}` ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {files.length === 0 && <div className="px-3.5 py-3 text-[13px] text-text-muted">No documents.</div>}
          {canUpload && (
            <div className="px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
              <select className={input + " max-w-[200px]"} value={category} disabled={!!busy}
                onChange={(e) => setCategory(e.target.value as ProjectDocCategory)}>
                {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy}
                className="px-3.5 py-2 rounded-xl text-white text-[13px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
                {busy === "upload" ? "Uploading…" : "+ Add document"}
              </button>
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
            </div>
          )}
        </div>
      )}
      {error && <p className="text-[13px] text-red-600 mt-2">{error}</p>}
    </div>
  );
}
