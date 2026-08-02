"use client";

// The completion documents collected AFTER the first disbursement, to unlock
// the second:
//   1. Invoice / tax invoice                 — image or PDF
//   2. Customer with panel     (geo-tagged)  — GeoOfficeUpload, upload-only
//   3. Customer with inverter  (geo-tagged)  — GeoOfficeUpload, upload-only
//   4. Customer with meter     (geo-tagged)  — GeoOfficeUpload, upload-only
//   5. Work Completion Report / Commission Report — image or PDF
//
// SHARED SLOTS: the admin (on behalf of the customer) and the EPC upload into
// the SAME categories on the SAME application, so whoever gets there first
// fills the slot and the other side sees it.
//
// The three geo photos reuse GeoOfficeUpload, so they inherit the full-buffer
// EXIF read (GPS extracted BEFORE the server compresses and strips it) and the
// Vision OCR fallback for burned-in GPS stamps. They're upload-only (no live
// camera) — the site photos are taken beforehand.
//
// LEGACY: a single 'completion_plant_photo' from the earlier build is shown
// read-only if present, so nothing already uploaded is orphaned.

import { useEffect, useState } from "react";
import FileUpload from "@/components/FileUpload";
import GeoOfficeUpload from "@/components/GeoOfficeUpload";
import { supabase } from "@/lib/supabase";
import { getDocumentUrl } from "@/lib/storage";

export const COMPLETION_CATEGORIES = [
  "completion_invoice",
  "completion_panel_photo",
  "completion_inverter_photo",
  "completion_meter_photo",
  "completion_report",
] as const;

export type CompletionCategory = typeof COMPLETION_CATEGORIES[number];

// Tranche-1 admin documents — uploaded here alongside the completion set but
// NOT part of the 2nd-tranche review gate (they belong to the 1st tranche).
const TRANCHE1_DOCS: { category: "feasibility_report" | "mmr_advance_receipt"; title: string }[] = [
  { category: "feasibility_report",  title: "Feasibility Approval Report" },
  { category: "mmr_advance_receipt", title: "MMR / Advance Receipt" },
];

// The three geo photos, in order.
const GEO_PHOTOS: { category: CompletionCategory; title: string }[] = [
  { category: "completion_panel_photo",    title: "Customer with panel" },
  { category: "completion_inverter_photo", title: "Customer with inverter" },
  { category: "completion_meter_photo",    title: "Customer with meter" },
];

type DocRow = { id: string; category: string; file_name: string | null; mime_type: string | null };

type Props = {
  applicationId: string;
  uploadedBy: "epc" | "admin";
  /** Bump to force a re-read after an upload elsewhere. */
  refreshKey?: number;
  /** Fired when the uploaded-count changes, so parents can gate the review. */
  onCountChange?: (uploaded: number, total: number) => void;
};

const EYE = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

export default function CompletionDocsSection({ applicationId, uploadedBy, refreshKey, onCountChange }: Props) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase()
        .from("user_application_docs")
        .select("id, category, file_name, mime_type")
        .eq("application_id", applicationId)
        // Also pull the legacy plant photo (read-only) + the Tranche-1 docs.
        .in("category", [...COMPLETION_CATEGORIES, "completion_plant_photo", ...TRANCHE1_DOCS.map((d) => d.category)] as unknown as string[]);
      if (cancelled) return;
      const rows = (data ?? []) as DocRow[];
      setDocs(rows);
      // The gate counts only the current set (not the legacy photo).
      const have = new Set(rows.map((r) => r.category));
      onCountChange?.(COMPLETION_CATEGORIES.filter((c) => have.has(c)).length, COMPLETION_CATEGORIES.length);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, refreshKey, tick]);

  const byCat = (c: string) => docs.find((d) => d.category === c) ?? null;
  const legacyPlant = byCat("completion_plant_photo");

  async function open(id: string) {
    const u = await getDocumentUrl(id);
    if (u) window.open(u, "_blank", "noopener");
  }

  return (
    <div className="space-y-5">
      {/* 1st Tranche Docs — admin-only (feasibility report, MMR/receipt). Kept
          out of the EPC mirror so EPC-facing flows are unchanged. */}
      {uploadedBy === "admin" && (
        <>
          <p className="text-[12px] font-bold uppercase tracking-wide text-[#5a8a76]">1st Tranche Docs</p>
          {TRANCHE1_DOCS.map((d) => (
            <DocSlot key={d.category} title={d.title} hint="Image or PDF." doc={byCat(d.category)} onOpen={open}>
              <FileUpload
                applicationId={applicationId}
                table="user_application_docs"
                category={d.category}
                uploadedBy={uploadedBy}
                maxFiles={1}
                label=""
                hint="JPG, PNG, WEBP or PDF."
                onUploaded={() => setTick((n) => n + 1)}
              />
            </DocSlot>
          ))}
          <p className="text-[12px] font-bold uppercase tracking-wide text-[#5a8a76] pt-2 border-t border-[#eaf3ee]">2nd Tranche Docs</p>
        </>
      )}
      {/* 1 — Invoice / tax invoice */}
      <DocSlot
        title="Invoice / tax invoice"
        hint="Image or PDF."
        doc={byCat("completion_invoice")}
        onOpen={open}
      >
        <FileUpload
          applicationId={applicationId}
          table="user_application_docs"
          category="completion_invoice"
          uploadedBy={uploadedBy}
          maxFiles={1}
          label=""
          hint="JPG, PNG, WEBP or PDF."
          onUploaded={() => setTick((n) => n + 1)}
        />
      </DocSlot>

      {/* 2-4 — Three geo-tagged site photos (upload only). */}
      {GEO_PHOTOS.map((p) => (
        <div key={p.category}>
          <p className="text-[13px] font-semibold text-[#0f3d2e] mb-1">{p.title} (geo-tagged)</p>
          <GeoOfficeUpload
            applicationId={applicationId}
            uploadedBy={uploadedBy}
            category={p.category}
            label=""
            uploadOnly
            hint="Must carry a location — upload a photo with GPS / a GPS-camera stamp."
          />
        </div>
      ))}

      {/* 5 — Work completion / commission report */}
      <DocSlot
        title="Work Completion Report / Commission Report"
        hint="Image or PDF."
        doc={byCat("completion_report")}
        onOpen={open}
      >
        <FileUpload
          applicationId={applicationId}
          table="user_application_docs"
          category="completion_report"
          uploadedBy={uploadedBy}
          maxFiles={1}
          label=""
          hint="JPG, PNG, WEBP or PDF."
          onUploaded={() => setTick((n) => n + 1)}
        />
      </DocSlot>

      {/* Legacy single plant photo from the earlier build — read-only. */}
      {legacyPlant && (
        <DocSlot title="Plant photo (legacy)" doc={legacyPlant} onOpen={open}>
          <span />
        </DocSlot>
      )}
    </div>
  );
}

// Shows the existing upload (with an eye-View) when present, otherwise the
// uploader. Keeps the two file slots visually level with the geo slot.
function DocSlot({
  title, hint, doc, onOpen, children,
}: {
  title: string;
  hint?: string;
  doc: DocRow | null;
  onOpen: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-[#0f3d2e] mb-1">{title}</p>
      {doc ? (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-[#f7fcfa] border border-[#e0f0e8] rounded-input">
          <span className="text-[13px] text-[#0f3d2e] truncate">{doc.file_name || "Uploaded"}</span>
          <button
            type="button"
            onClick={() => onOpen(doc.id)}
            title="View document"
            className="shrink-0 text-[#185fa5] hover:text-[#144d84]"
          >
            {EYE}
          </button>
        </div>
      ) : (
        <>
          {hint && <p className="text-[11px] text-text-muted mb-1.5">{hint}</p>}
          {children}
        </>
      )}
    </div>
  );
}
