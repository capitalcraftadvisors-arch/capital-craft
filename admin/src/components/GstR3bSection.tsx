"use client";

// Admin-only GST R3B section on the EPC detail page.
//
// Two upload panels:
//   - Present Period File:    1 file
//   - Previous Period Files:  up to 12 files
//
// On every successful upload we also call extract-gst-r3b (Vision OCR) and
// store the parsed fields in the row's metadata.ocr. Admin can later edit
// the Total taxable value field — that writes back to metadata.ocr.
//
// Read flow on mount:
//   1. SELECT epc_documents WHERE business_id=X AND category='gst_r3b'
//   2. Partition by metadata.period_type into present/previous
//   3. Render
//
// All file-storage operations route through the same /api/upload and
// /api/document/[id] endpoints other docs use — admin-only enforcement is
// in those routes, so EPCs would be blocked even if they somehow had this
// component rendered.

import { useEffect, useMemo, useRef, useState } from "react";
import Card from "@/components/ui/Card";
import { supabase } from "@/lib/supabase";
import {
  uploadDocument,
  getDocumentUrl,
  deleteDocument,
} from "@/lib/storage";
import { extractGstR3b } from "@/lib/ocr";
import { isAcceptedFileType } from "@/lib/validators";

type PeriodType = "present" | "previous";

type Ocr = {
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  total_taxable_value: number | null;
  period: string | null;
  raw_text?: string;
};

type Meta = { period_type: PeriodType; ocr?: Ocr };

type Doc = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  file_name: string | null;
  metadata: Meta;
};

const MAX_PREVIOUS = 12;

export default function GstR3bSection({ businessId }: { businessId: string }) {
  const [presentDoc, setPresentDoc] = useState<Doc | null>(null);
  const [previousDocs, setPreviousDocs] = useState<Doc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploadingPresent, setUploadingPresent] = useState(false);
  const [uploadingPrevious, setUploadingPrevious] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase()
      .from("epc_documents")
      .select("id, storage_path, mime_type, file_name, metadata")
      .eq("business_id", businessId)
      .eq("category", "gst_r3b");
    const all = (data ?? []) as Doc[];
    setPresentDoc(
      all.find((d) => d.metadata?.period_type === "present") ?? null,
    );
    setPreviousDocs(
      all
        .filter((d) => d.metadata?.period_type === "previous")
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    setLoaded(true);
  }

  useEffect(() => { void load(); }, [businessId]);

  // ── Upload + OCR + metadata persist ────────────────────────────────────
  async function uploadOne(file: File, periodType: PeriodType) {
    setError(null);
    if (!isAcceptedFileType(file.type)) {
      setError("Only JPG, PNG, WEBP, or PDF.");
      return;
    }
    const setUploading =
      periodType === "present" ? setUploadingPresent : setUploadingPrevious;
    setUploading(true);
    try {
      // 1. Upload through normal pipeline (compress image / pass PDF through,
      //    write to GCS, insert epc_documents row).
      const r = await uploadDocument(file, {
        table: "epc_documents",
        category: "gst_r3b",
        business_id: businessId,
        extraMetadata: { period_type: periodType },
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }

      // 2. OCR — uses ORIGINAL file (not the compressed JPEG that may have
      //    landed in GCS). Vision API gets the cleaner source bytes.
      const ocr = await extractGstR3b(file);

      // 3. Persist parsed fields. Always preserve period_type.
      const newMetadata: Meta = { period_type: periodType };
      if (ocr.ok) {
        newMetadata.ocr = {
          gstin: ocr.gstin,
          legal_name: ocr.legal_name,
          trade_name: ocr.trade_name,
          total_taxable_value: ocr.total_taxable_value,
          period: ocr.period,
          raw_text: ocr.raw_text,
        };
      }
      await supabase()
        .from("epc_documents")
        .update({ metadata: newMetadata })
        .eq("id", r.id);

      await load();
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setUploading(false);
    }
  }

  async function removeDoc(d: Doc) {
    if (!confirm("Remove this GSTR-3B file?")) return;
    const ok = await deleteDocument(d.id);
    if (!ok) { setError("Could not delete this file."); return; }
    await load();
  }

  // ── Edit handler for Total taxable value ───────────────────────────────
  async function updateTotalTaxableValue(d: Doc, newValue: number | null) {
    const existingOcr: Ocr = d.metadata?.ocr ?? {
      gstin: null, legal_name: null, trade_name: null,
      total_taxable_value: null, period: null,
    };
    const merged: Meta = {
      ...d.metadata,
      ocr: { ...existingOcr, total_taxable_value: newValue },
    };
    await supabase()
      .from("epc_documents")
      .update({ metadata: merged })
      .eq("id", d.id);

    if (presentDoc?.id === d.id) {
      setPresentDoc({ ...presentDoc, metadata: merged });
    } else {
      setPreviousDocs((arr) =>
        arr.map((p) => (p.id === d.id ? { ...p, metadata: merged } : p)),
      );
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────
  const allDocs: Doc[] = [
    ...(presentDoc ? [presentDoc] : []),
    ...previousDocs,
  ];

  const consensus = useMemo(() => {
    let gstin: string | null = null;
    let legal_name: string | null = null;
    let trade_name: string | null = null;
    for (const d of allDocs) {
      const o = d.metadata?.ocr;
      if (!o) continue;
      if (!gstin && o.gstin) gstin = o.gstin;
      if (!legal_name && o.legal_name) legal_name = o.legal_name;
      if (!trade_name && o.trade_name) trade_name = o.trade_name;
    }
    return { gstin, legal_name, trade_name };
    // allDocs identity changes when underlying arrays change, so this is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentDoc, previousDocs]);

  const grandTotal = useMemo(() => {
    return allDocs.reduce((sum, d) => {
      const v = d.metadata?.ocr?.total_taxable_value;
      return typeof v === "number" && !isNaN(v) ? sum + v : sum;
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentDoc, previousDocs]);

  if (!loaded) return null;

  return (
    <Card className="p-6">
      <h3 className="font-display font-semibold text-[16px] mb-1">GST R3B</h3>
      <p className="text-[12px] text-text-muted mb-4">
        Admin-only. Files and parsed values are never visible to the EPC.
      </p>

      {/* Consensus identity (from first successfully-OCR'd file) */}
      <div className="grid sm:grid-cols-3 gap-4 mb-4 text-[13px]">
        <ConsensusField label="GSTIN" value={consensus.gstin} />
        <ConsensusField label="Legal name" value={consensus.legal_name} />
        <ConsensusField label="Trade name" value={consensus.trade_name} />
      </div>

      {/* Grand total */}
      <div className="bg-bg-tint border border-blue/15 rounded-input p-3 mb-5 flex justify-between items-center">
        <span className="text-[13px] text-text-mid">
          Grand total &mdash; sum of all 3.1(a) Total taxable values
        </span>
        <span className="text-[16px] font-semibold text-text">
          ₹{grandTotal.toLocaleString("en-IN", {
            minimumFractionDigits: 2, maximumFractionDigits: 2,
          })}
        </span>
      </div>

      {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}

      {/* ── Present panel ──────────────────────────────────────────── */}
      <div className="mb-5">
        <h4 className="font-semibold text-[14px] mb-1">Present Period File</h4>
        <p className="text-[12px] text-text-muted mb-2">1 file — current period.</p>
        {presentDoc ? (
          <DocCard
            d={presentDoc}
            onRemove={removeDoc}
            onValueChange={updateTotalTaxableValue}
          />
        ) : (
          <Uploader
            disabled={uploadingPresent}
            label={uploadingPresent ? "Uploading…" : "Click to upload (1 file)"}
            onFiles={(files) => { void uploadOne(files[0], "present"); }}
          />
        )}
      </div>

      {/* ── Previous panel ─────────────────────────────────────────── */}
      <div>
        <h4 className="font-semibold text-[14px] mb-1">Previous Period Files</h4>
        <p className="text-[12px] text-text-muted mb-2">
          Up to {MAX_PREVIOUS}. Past GSTR-3B filings.
        </p>
        {previousDocs.map((d) => (
          <DocCard
            key={d.id}
            d={d}
            onRemove={removeDoc}
            onValueChange={updateTotalTaxableValue}
          />
        ))}
        {previousDocs.length < MAX_PREVIOUS && (
          <Uploader
            disabled={uploadingPrevious}
            multiple
            label={
              uploadingPrevious
                ? "Uploading…"
                : `Click to upload (${previousDocs.length}/${MAX_PREVIOUS} used)`
            }
            onFiles={async (files) => {
              const remaining = MAX_PREVIOUS - previousDocs.length;
              const arr = Array.from(files).slice(0, remaining);
              for (const f of arr) {
                await uploadOne(f, "previous");
              }
            }}
          />
        )}
      </div>
    </Card>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

function ConsensusField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-text-muted text-[11px] uppercase tracking-wide">{label}</p>
      <p className="text-text break-words">
        {value || <span className="text-text-muted">—</span>}
      </p>
    </div>
  );
}

function Uploader({
  label, disabled, multiple, onFiles,
}: {
  label: string;
  disabled?: boolean;
  multiple?: boolean;
  onFiles: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <label
      className={[
        "block border-2 border-dashed border-line rounded-input bg-white",
        "px-4 py-6 text-center cursor-pointer hover:border-blue transition-colors",
        disabled ? "opacity-60 pointer-events-none" : "",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(e.target.files);
            if (inputRef.current) inputRef.current.value = "";
          }
        }}
      />
      <p className="text-[13px] text-text-mid">{label}</p>
      <p className="text-[11px] text-text-muted mt-1">JPG, PNG, WEBP, or PDF</p>
    </label>
  );
}

function DocCard({
  d, onRemove, onValueChange,
}: {
  d: Doc;
  onRemove: (d: Doc) => void;
  onValueChange: (d: Doc, v: number | null) => void;
}) {
  const ocr = d.metadata?.ocr;
  const [localValue, setLocalValue] = useState<string>(
    ocr?.total_taxable_value != null ? String(ocr.total_taxable_value) : "",
  );

  // Keep local field in sync if the underlying doc.metadata.ocr changes
  // from outside this component (e.g. after a fresh OCR).
  useEffect(() => {
    const v = d.metadata?.ocr?.total_taxable_value;
    setLocalValue(v != null ? String(v) : "");
  }, [d.metadata?.ocr?.total_taxable_value]);

  function commitValue() {
    const raw = localValue.replace(/,/g, "").trim();
    if (raw === "") {
      onValueChange(d, null);
      return;
    }
    const v = parseFloat(raw);
    if (isNaN(v)) return; // ignore invalid input, keep old value
    onValueChange(d, v);
  }

  const isPdf = (d.mime_type || "").includes("pdf");

  return (
    <div className="bg-white border border-line rounded-input p-3 mb-2">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-bg-tint rounded-md grid place-items-center text-blue text-xs font-bold">
          {isPdf ? "PDF" : "IMG"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] truncate">{d.file_name || "Document"}</p>
          <p className="text-[11px] text-text-muted">
            {ocr?.period ? `Period: ${ocr.period}` : "Period not detected"}
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            const u = await getDocumentUrl(d.id);
            if (u) window.open(u, "_blank");
          }}
          className="text-[12px] text-blue hover:underline"
        >
          View
        </button>
        <button
          type="button"
          onClick={() => onRemove(d)}
          className="text-[12px] text-text-muted hover:text-red-500"
        >
          Remove
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[12px] text-text-muted whitespace-nowrap">
          3.1(a) Total taxable value
        </label>
        <span className="text-[12px] text-text-muted">₹</span>
        <input
          type="text"
          inputMode="decimal"
          className="flex-1 max-w-[200px] border border-line rounded px-2 py-1 text-[13px] focus:border-blue outline-none"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={commitValue}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="0.00"
        />
      </div>
    </div>
  );
}
