"use client";

// Other Insurance documents — one section (KYC documents, or the policy) with
// the portal's DocGrid (eye + delete) and an upload button. KYC takes as many
// files as needed; the policy is one file (uploading again replaces it). Used by
// both the file form and the view profile.

import { useRef, useState } from "react";
import { DocGrid, I } from "@/components/view/ViewKit";
import { isAcceptedFileType, ACCEPTED_FILE_TYPES } from "@/lib/validators";
import { uploadOtherInsDoc, otherInsDoc, type KycDoc } from "@/lib/other-insurance";

export default function OtherInsDocs({
  kind, docs, ensureId, onChanged,
}: {
  kind: "kyc" | "policy";
  docs: KycDoc[];
  /** The file's id — creating the file first when it's a new one. */
  ensureId: () => Promise<string | null>;
  onChanged: (id: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    const list = kind === "kyc" ? [...files] : [files[0]];
    const bad = list.find((f) => !isAcceptedFileType(f.type));
    if (bad) { setError(`${bad.name}: only photo or PDF files.`); return; }
    setBusy(true); setError(null);
    const id = await ensureId();
    if (id) {
      for (const f of list) {
        const r = await uploadOtherInsDoc(id, kind, f);
        if (!r.ok) { setError(`Couldn't upload ${f.name} — ${r.error}`); break; }
      }
      onChanged(id);
    }
    setBusy(false);
  }

  async function act(path: string, action: "sign" | "delete") {
    if (action === "delete" && (busy || !window.confirm("Delete this document?"))) return;
    const id = await ensureId();
    if (!id) return;
    const r = await otherInsDoc(id, path, action);
    if (!r.ok) { setError((action === "sign" ? "Couldn't open — " : "Couldn't delete — ") + r.error); return; }
    if (action === "sign" && r.url) window.open(r.url, "_blank", "noopener");
    if (action === "delete") onChanged(id);
  }

  const label = busy ? "Uploading…"
    : kind === "kyc" ? "+ Add KYC documents"
    : docs.length ? "Replace policy" : "+ Upload policy";

  return (
    <div>
      {docs.length > 0 && (
        <div className="mb-3">
          <DocGrid eyeIcon={I.eye} slots={docs.map((d) => ({
            key: d.path,
            label: d.name,
            title: d.name,
            onView: () => void act(d.path, "sign"),
            onDelete: () => void act(d.path, "delete"),
          }))} />
        </div>
      )}
      <button type="button" disabled={busy} onClick={() => ref.current?.click()}
        className="w-full border-2 border-dashed border-[#cdeadd] rounded-[10px] px-4 py-4 text-[13px] font-semibold text-[#178a5c] hover:bg-[#f0faf5] disabled:opacity-60">
        {label}
      </button>
      <input ref={ref} type="file" multiple={kind === "kyc"} accept={ACCEPTED_FILE_TYPES.join(",")} className="hidden"
        onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
    </div>
  );
}

/** The file's documents as OtherInsDocs lists. */
export function otherInsDocLists(row: Record<string, any> | null): { kyc: KycDoc[]; policy: KycDoc[] } {
  return {
    kyc: Array.isArray(row?.kyc_docs) ? row!.kyc_docs : [],
    policy: row?.policy_path ? [{ path: row.policy_path, name: "Insurance policy", mime: "" }] : [],
  };
}
