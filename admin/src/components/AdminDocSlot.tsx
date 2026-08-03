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
  // When true, the slot renders nothing when no doc exists (no upload
  // affordance). Used for legacy-only categories like stakeholder_aadhaar
  // where new uploads should go to the split front/back categories, but
  // an existing doc still needs to be viewable / replaceable / removable.
  hideWhenEmpty?: boolean;
};

type Doc = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  file_name: string | null;
};

export default function AdminDocSlot({
  businessId, stakeholderId, category, label, onChange, hideWhenEmpty,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [busy, setBusy] = useState<"upload" | "replace" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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
    setLoaded(true);
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

  // Legacy-only mode: after the initial load, if no doc exists we render
  // nothing so the admin isn't offered an upload affordance for a category
  // that's meant to be phased out.
  if (hideWhenEmpty && loaded && !doc) return null;

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
          <div className="flex items-center gap-1.5 shrink-0">
            {/* View (eye) + Remove (trash, immediate). Replace is gone — to
                change a file, trash it and the "+" upload button reappears. */}
            <button
              type="button"
              disabled={!!busy}
              onClick={async () => { const u = await getDocumentUrl(doc.id); if (u) window.open(u, "_blank"); }}
              title="View"
              aria-label="View"
              className="w-8 h-8 grid place-items-center rounded-md border border-line bg-white text-blue hover:bg-bg-soft disabled:opacity-50"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={remove}
              title="Remove"
              aria-label="Remove"
              className="w-8 h-8 grid place-items-center rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {busy === "remove"
                ? <span className="text-[10px] font-semibold">…</span>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>}
            </button>
          </div>
        </div>
      ) : (
        <label className={[
          "flex items-center justify-center gap-1.5 border border-dashed border-line rounded-input bg-white",
          "px-3 py-2.5 cursor-pointer hover:border-blue transition-colors text-[13px] font-medium text-blue",
          busy ? "opacity-60 pointer-events-none" : "",
        ].join(" ")}>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files, false)}
          />
          <span className="text-[16px] leading-none">+</span>
          {busy === "upload" ? "Uploading…" : "Upload"}
        </label>
      )}

      {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
    </div>
  );
}
