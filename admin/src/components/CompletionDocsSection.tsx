"use client";

// The 3 completion documents collected AFTER the first disbursement, to
// unlock the second:
//   1. Invoice / tax invoice        — image or PDF
//   2. Geo-tagged plant + inverter  — must carry a location (GeoOfficeUpload)
//   3. Work completion report       — image or PDF
//
// SHARED SLOTS: the admin (on behalf of the customer) and the EPC upload into
// the SAME three categories on the SAME application, so whoever gets there
// first fills the slot and the other side sees it. That's why this component
// takes only an applicationId + who's uploading — nothing else differs.
//
// The geo-tagged photo reuses GeoOfficeUpload verbatim, so it inherits the
// full-buffer EXIF read (GPS extracted BEFORE the server compresses and
// strips it), the live-camera + GPS capture, the Vision OCR fallback for
// burned-in GPS stamps, and the lat/long + address display.

import { useEffect, useState } from "react";
import FileUpload from "@/components/FileUpload";
import GeoOfficeUpload from "@/components/GeoOfficeUpload";
import { supabase } from "@/lib/supabase";
import { getDocumentUrl } from "@/lib/storage";

export const COMPLETION_CATEGORIES = [
  "completion_invoice",
  "completion_plant_photo",
  "completion_report",
] as const;

export type CompletionCategory = typeof COMPLETION_CATEGORIES[number];

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
        .in("category", COMPLETION_CATEGORIES as unknown as string[]);
      if (cancelled) return;
      const rows = (data ?? []) as DocRow[];
      setDocs(rows);
      const have = new Set(rows.map((r) => r.category));
      onCountChange?.(COMPLETION_CATEGORIES.filter((c) => have.has(c)).length, COMPLETION_CATEGORIES.length);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, refreshKey, tick]);

  const byCat = (c: CompletionCategory) => docs.find((d) => d.category === c) ?? null;

  async function open(id: string) {
    const u = await getDocumentUrl(id);
    if (u) window.open(u, "_blank", "noopener");
  }

  return (
    <div className="space-y-5">
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

      {/* 2 — Geo-tagged plant + inverter photo */}
      <div>
        <p className="text-[13px] font-semibold text-[#0f3d2e] mb-1">
          Geo-tagged photo — plant with inverter
        </p>
        <GeoOfficeUpload
          applicationId={applicationId}
          uploadedBy={uploadedBy}
          category="completion_plant_photo"
          label=""
          hint="Must carry a location — take it live, or upload a photo with GPS / a GPS-camera stamp."
        />
      </div>

      {/* 3 — Work completion report */}
      <DocSlot
        title="Work completion report"
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
