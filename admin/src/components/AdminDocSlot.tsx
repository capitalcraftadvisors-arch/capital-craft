"use client";

// Admin-only single-doc slot for the EPC detail page. Covers categories
// with per-category unique indexes (pan_business, gstin, cancelled_cheque,
// stakeholder_pan) as well as the office_* triple.
//
// States:
//   - empty: shows Upload affordance.
//   - filled: shows file name + thumb/PDF chip + [View] [Replace] [Remove].
//
// Replace: prompts file picker → uploadDocument(file, {replace: true}).
// Remove:  deleteDocument(d.id).
// All operations call /api/upload or /api/document/[id] which already
// audit-log to admin_edit_log on the backend.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  uploadDocument, getDocumentUrl, deleteDocument,
} from "@/lib/storage";
import { isAcceptedFileType } from "@/lib/validators";

type Props = {
  businessId: string;
  stakeholderId?: string | null;
  category: string;
  label: string;
  // Called whenever the slot's state changes (uploaded/replaced/removed) so
  // the parent can re-fetch the doc list. Optional.
  onChange?: () => void;
};

type Doc = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  file_name: string | null;
};

export default function AdminDocSlot({
  businessId, stakeholderId, category, label, onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [busy, setBusy] = useState<"upload" | "replace" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    let q = supabase()
      .from("epc_documents")
      .select("id, storage_path, mime_type, file_name")
      .eq("business_id", businessId)
      .eq("category", category);
    q = stakeholderId
      ? q.eq("stakeholder_id", stakeholderId)
      : q.is("stakeholder_id", null);
    const { data } = await q.maybeSingle();
    setDoc((data as Doc | null) ?? null);
    if (data && (data.mime_type || "").startsWith("image/")) {
      const u = await getDocumentUrl(data.id);
      setThumb(u);
    } else {
      setThumb(null);
    }
  }

  useEffect(() => { void load(); }, [businessId, stakeholderId, category]);

  async function handleFiles(files: FileList | null, replaceMode: boolean) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!isAcceptedFileType(file.type)) {
      setError("Only JPG, PNG, WEBP, or PDF.");
      return;
    }
    setError(null);
    setBusy(replaceMode ? "replace" : "upload");
    try {
      const r = await uploadDocument(file, {
        table: "epc_documents",
        category,
        business_id: businessId,
        stakeholder_id: stakeholderId ?? undefined,
        replace: replaceMode,
      });
      if (!r.ok) { setError(r.error); return; }
      await load();
      onChange?.();
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    if (!doc) return;
    if (!confirm(`Remove ${label}?`)) return;
    setBusy("remove");
    const ok = await deleteDocument(doc.id);
    setBusy(null);
    if (!ok) { setError("Could not remove this file."); return; }
    setDoc(null);
    setThumb(null);
    onChange?.();
  }

  return (
    <div className="bg-white border border-line rounded-input p-3">
      <p className="text-[12px] text-text-muted mb-2">{label}</p>

      {doc ? (
        <div className="flex items-center gap-3">
          {thumb ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={thumb} alt="" className="w-12 h-12 object-cover rounded-md shrink-0" />
          ) : (
            <div className="w-12 h-12 bg-bg-tint rounded-md grid place-items-center text-blue text-xs font-bold shrink-0">
              {(doc.mime_type || "").includes("pdf") ? "PDF" : "FILE"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] truncate">{doc.file_name || "Document"}</p>
            <p className="text-[11px] text-text-muted">Uploaded</p>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button
              type="button"
              disabled={!!busy}
              onClick={async () => {
                const u = await getDocumentUrl(doc.id);
                if (u) window.open(u, "_blank");
              }}
              className="text-[12px] text-blue hover:underline disabled:opacity-50"
            >
              View
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => inputRef.current?.click()}
              className="text-[12px] text-text-mid hover:text-blue disabled:opacity-50"
            >
              {busy === "replace" ? "Replacing…" : "Replace"}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={remove}
              className="text-[12px] text-text-muted hover:text-red-500 disabled:opacity-50"
            >
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      ) : (
        <label className={[
          "block border-2 border-dashed border-line rounded-input bg-white",
          "px-3 py-4 text-center cursor-pointer hover:border-blue transition-colors",
          busy ? "opacity-60 pointer-events-none" : "",
        ].join(" ")}>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files, false)}
          />
          <p className="text-[12px] text-text-mid">
            {busy === "upload" ? "Uploading…" : "Click to upload"}
          </p>
          <p className="text-[10px] text-text-muted mt-0.5">JPG, PNG, WEBP, or PDF</p>
        </label>
      )}

      {/* Hidden input reused for Replace when doc exists. */}
      {doc && (
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files, true)}
        />
      )}

      {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
    </div>
  );
}
