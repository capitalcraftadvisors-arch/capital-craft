"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadDocument, getDocumentUrl, deleteDocument } from "@/lib/storage";
import { isAcceptedFileType } from "@/lib/validators";

type EpcCategory =
  | "pan_business" | "gstin" | "extra_doc"
  | "stakeholder_pan" | "stakeholder_aadhaar"
  | "cancelled_cheque"
  | "office_exterior" | "office_interior" | "office_selfie";

type LoanCategory =
  | "borrower_pan" | "borrower_aadhaar" | "borrower_photo"
  | "bank_statement" | "income_proof" | "electricity_bill"
  | "property_doc" | "quotation" | "other";

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
  label?: string;
  hint?: string;
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
    onUploaded, captureGps = false, label, hint,
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

    let gps: { lat: number; lng: number; captured_at: string } | null = null;
    if (captureGps && "geolocation" in navigator) {
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
                onClick={() => removeDoc(d)}
                className="text-[12px] text-text-muted hover:text-red-500 transition-colors"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {canUploadMore && (
        <label
          className={[
            "block border-2 border-dashed border-line rounded-input bg-white",
            "px-4 py-6 text-center cursor-pointer hover:border-blue transition-colors",
          ].join(" ")}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple={maxFiles > 1}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <p className="text-[13px] text-text-mid">
            {uploading ? "Uploading…" : "Click to upload"}
          </p>
          <p className="text-[11px] text-text-muted mt-1">JPG, PNG, WEBP or PDF</p>
        </label>
      )}

      {hint && !error && <p className="mt-1.5 text-[12px] text-text-muted">{hint}</p>}
      {error && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}
    </div>
  );
}
