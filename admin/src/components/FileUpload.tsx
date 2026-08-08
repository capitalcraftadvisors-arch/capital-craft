"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadDocument, getDocumentUrl, deleteDocument } from "@/lib/storage";
import { isAcceptedFileType } from "@/lib/validators";

type EpcCategory =
  | "pan_business" | "gstin" | "extra_doc" | "admin_extra"
  | "stakeholder_pan" | "stakeholder_aadhaar"
  | "cancelled_cheque"
  | "office_exterior" | "office_interior" | "office_selfie";

type LoanCategory =
  | "borrower_pan" | "borrower_aadhaar" | "borrower_photo"
  | "customer_photo"
  | "bank_statement" | "income_proof" | "electricity_bill"
  | "property_doc" | "quotation" | "other" | "sanction_letter"
  // Post-first-disbursement completion docs (migration 0043). Shared slots —
  // uploaded by either the admin (on behalf) or the EPC.
  | "completion_invoice" | "completion_plant_photo" | "completion_report"
  // Tranche-1 admin docs (migration 0056).
  | "feasibility_report" | "mmr_advance_receipt";

type Props = {
  businessId?: string;
  stakeholderId?: string;
  applicationId?: string;
  category: EpcCategory | LoanCategory;
  table: "epc_documents" | "user_application_docs";
  maxFiles?: number;
  uploadedBy?: "epc" | "admin";
  // Fired after a successful upload. The File is the ORIGINAL (uncompressed)
  // file — exactly what Step 4 needs to feed to extract-cheque.
  onUploaded?: (info: { docId: string; storagePath: string; file: File }) => void;
  captureGps?: boolean;
  // Pre-captured metadata to attach to the upload (e.g. a GPS fix taken
  // ONCE by the caller, then reused across multiple uploads in the same
  // session). If `extraMetadata.gps` is set, it overrides `captureGps`
  // and no second geolocation prompt is shown.
  extraMetadata?: { gps?: { lat: number; lng: number; captured_at: string } | null };
  label?: string;
  hint?: string;
  // Sub-line shown inside the upload box under "Click to upload".
  // Defaults to "Photo, scan, or PDF" when not provided.
  uploadHint?: string;
};

type DocRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  file_name: string | null;
};

export default function FileUpload(props: Props) {
  const {
    businessId, stakeholderId, applicationId,
    category, table, maxFiles = 1, uploadedBy,
    onUploaded, captureGps = false, extraMetadata, label, hint, uploadHint,
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing docs for this slot. (We still query Supabase directly here
  // because RLS protects access — no API round-trip needed for metadata.)
  useEffect(() => {
    (async () => {
      const q = supabase()
        .from(table)
        .select("id, storage_path, mime_type, file_name")
        .eq("category", category);

      const final = table === "epc_documents"
        ? q.eq("business_id", businessId!).eq(
            stakeholderId ? "stakeholder_id" : "category",
            stakeholderId ?? category,
          )
        : q.eq("application_id", applicationId!);

      const { data } = await final;
      const rows = (data ?? []) as DocRow[];
      setDocs(rows);

      // Sign thumbnails for images
      const t: Record<string, string> = {};
      for (const d of rows) {
        if ((d.mime_type || "").startsWith("image/")) {
          const u = await getDocumentUrl(d.id);
          if (u) t[d.id] = u;
        }
      }
      setThumbs(t);
    })();
  }, [businessId, stakeholderId, applicationId, category, table]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (docs.length + files.length > maxFiles) {
      setError(`Only ${maxFiles} file${maxFiles > 1 ? "s" : ""} allowed in this slot.`);
      return;
    }
    setError(null);
    setUploading(true);

    // Pre-captured gps from caller wins. Falls back to on-upload capture
    // if `captureGps` was set and no extraMetadata.gps was supplied.
    let gps: { lat: number; lng: number; captured_at: string } | null =
      extraMetadata?.gps ?? null;
    if (!gps && captureGps && "geolocation" in navigator) {
      gps = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            captured_at: new Date().toISOString(),
          }),
          () => resolve(null),
          { timeout: 6000 },
        );
      });
    }

    for (const file of Array.from(files)) {
      if (!isAcceptedFileType(file.type)) {
        setError("Only JPG, PNG, WEBP, or PDF files are allowed.");
        continue;
      }

      const r = await uploadDocument(file, {
        table,
        category,
        business_id: businessId,
        stakeholder_id: stakeholderId,
        application_id: applicationId,
        uploaded_by: uploadedBy,
        gps,
      });

      if (!r.ok) {
        setError(r.error);
        continue;
      }

      const row: DocRow = {
        id: r.id,
        storage_path: r.storage_path,
        mime_type: r.mime_type,
        file_name: file.name,
      };
      setDocs((d) => [...d, row]);

      if ((row.mime_type || "").startsWith("image/")) {
        const u = await getDocumentUrl(row.id);
        if (u) setThumbs((t) => ({ ...t, [row.id]: u }));
      }

      // Note: pass the ORIGINAL file (not the compressed JPEG). This is what
      // Step 4's onUploaded handler base64-encodes and sends to extract-cheque,
      // so OCR keeps working unchanged.
      onUploaded?.({ docId: row.id, storagePath: row.storage_path, file });
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function removeDoc(d: DocRow) {
    const ok = await deleteDocument(d.id);
    if (!ok) {
      setError("Could not delete this file.");
      return;
    }
    setDocs((arr) => arr.filter((x) => x.id !== d.id));
    setThumbs((t) => { const c = { ...t }; delete c[d.id]; return c; });
  }

  const canUploadMore = docs.length < maxFiles;

  return (
    <div>
      {label && <p className="text-[13px] font-medium text-text-mid mb-2">{label}</p>}

      {docs.length > 0 && (
        <ul className="space-y-2 mb-3">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 bg-white border border-line rounded-input px-3 py-2"
            >
              {thumbs[d.id] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={thumbs[d.id]} alt="" className="w-10 h-10 object-cover rounded-md" />
              ) : (
                <div className="w-10 h-10 bg-bg-tint rounded-md grid place-items-center text-blue text-xs font-bold">
                  PDF
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-text truncate">{d.file_name || "Document"}</p>
                <p className="text-[11px] text-text-muted">Uploaded</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const url = await getDocumentUrl(d.id);
                  if (url) window.open(url, "_blank", "noopener");
                }}
                title="View uploaded document"
                aria-label="View uploaded document"
                className="p-1.5 rounded hover:bg-bg-tint text-[#185fa5] transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => removeDoc(d)}
                title="Remove"
                aria-label="Remove"
                className="p-1.5 rounded hover:bg-red-50 text-red-600 transition-colors"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canUploadMore && (
        <label
          className={[
            "flex flex-col items-center justify-center min-h-[96px] border-2 border-dashed border-[#185fa5] rounded-input bg-white",
            "px-4 py-4 text-center cursor-pointer hover:bg-[#f2f7fc] transition-colors",
          ].join(" ")}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            // image/* lets mobile browsers surface the camera + photo library
            // + scanner/file-picker options. Backend ACCEPTED set still
            // restricts to JPEG/PNG/WEBP/PDF; iOS Safari converts HEIC → JPEG
            // at upload time so most camera shots arrive as image/jpeg.
            accept="image/*,application/pdf"
            multiple={maxFiles > 1}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#185fa5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mb-2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-[14px] font-semibold text-[#185fa5]">
            {uploading ? "Uploading…" : "Click to upload"}
          </p>
          <p className="text-[12px] text-[#5a86b3] mt-0.5">{uploadHint ?? "Photo, scan, or PDF"}</p>
        </label>
      )}

      {hint && !error && <p className="mt-1.5 text-[12px] text-text-muted">{hint}</p>}
      {error && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}
    </div>
  );
}
