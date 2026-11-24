"use client";

// Loan Application — Step 3 · the small pieces: a document slot, the bill
// ownership card, a summary row, the co-applicant Aadhaar picker and its tiles.

import { useRef, useState } from "react";
import { FIELD_LABEL, EyeIcon, UploadedDoc, HiddenFileInput } from "@/components/loan-form";

export type DocState = {
  path: string;
  uploaded_at: string;
  signed_url: string | null;
  file_name: string;
} | null;

// One document slot: the shared "file on record" box once uploaded, otherwise
// this page's plain dashed upload tile. `label` "" still renders its (empty) line.
export function DocSlot({
  label, doc, uploading, onFile,
}: {
  label: string;
  doc: DocState;
  uploading: boolean;
  onFile: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className={FIELD_LABEL}>{label}</p>
      {doc ? (
        <UploadedDoc
          fileName={doc.file_name}
          uploadedAt={doc.uploaded_at}
          viewUrl={doc.signed_url}
          onReupload={() => inputRef.current?.click()}
          uploading={uploading}
        />
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={[
            "w-full h-[140px] rounded-input border-2 border-dashed transition-colors flex items-center justify-center text-center px-4",
            "border-[#185fa5] bg-white text-[#185fa5] hover:bg-[#f2f7fc]",
            uploading ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
        >
          <div>
            <p className="text-[13px] font-semibold">
              {uploading ? "Uploading & extracting…" : "Click to upload"}
            </p>
            <p className="text-[11px] mt-1">Photo, scan, or PDF</p>
          </div>
        </button>
      )}
      <HiddenFileInput ref={inputRef} onFile={onFile} />
    </div>
  );
}

// Yes / No card for "is the bill in the applicant's name?" (no radio dot).
export function OwnershipTile({
  active, onClick, title, note,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "text-left rounded-input border-2 p-4 transition-colors",
        active
          ? "border-[#178a5c] bg-white"
          : "border-line bg-white hover:border-[#185fa5]",
      ].join(" ")}
    >
      <p className="font-semibold text-[14px] text-[#0f3d2e]">
        {title}
      </p>
      <p className="text-[12px] text-text-muted mt-1">
        {note}
      </p>
    </button>
  );
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="min-w-[130px] text-text-muted">{label}</dt>
      <dd className="font-semibold text-[#0f3d2e]">{value}</dd>
    </div>
  );
}

// Two-file picker for co-applicant Aadhaar (front + back). Fires the
// callback only once BOTH files are selected so the server route can
// process them together (same shape the applicant Step 2 uses).
export function CoappAadhaarPicker({
  onFiles, uploading, error, hasFront, hasBack, frontUrl, backUrl,
}: {
  onFiles: (front: File, back: File) => void;
  uploading: boolean;
  error: string | null;
  hasFront: boolean;
  hasBack: boolean;
  frontUrl?: string | null;
  backUrl?: string | null;
}) {
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef  = useRef<HTMLInputElement>(null);
  const [front, setFront] = useState<File | null>(null);
  const [back,  setBack]  = useState<File | null>(null);

  // Extraction fires ONLY from the explicit "Extract details" button below —
  // the same mechanism the main applicant (Step 2) uses. The previous auto-fire
  // useEffect had `onFiles` in its deps, and since the parent recreates that
  // callback every render, it looped (upload → re-render → new onFiles →
  // effect → upload …) — the source of the "Failed to fetch" + glitching.

  return (
    <div className="space-y-2">
      <div className="grid sm:grid-cols-2 gap-3">
        <AadhaarSideTile
          title="Aadhaar Front"
          picked={front}
          has={hasFront}
          url={frontUrl}
          uploading={uploading}
          onClick={() => frontRef.current?.click()}
        />
        <AadhaarSideTile
          title="Aadhaar Back"
          picked={back}
          has={hasBack}
          url={backUrl}
          uploading={uploading}
          onClick={() => backRef.current?.click()}
        />
      </div>
      <HiddenFileInput ref={frontRef} onFile={setFront} />
      <HiddenFileInput ref={backRef} onFile={setBack} />
      <button
        type="button"
        onClick={() => { if (front && back && !uploading) onFiles(front, back); }}
        disabled={!front || !back || uploading}
        className="w-full inline-flex items-center justify-center gap-2 rounded-input bg-[#185fa5] text-white text-[13px] font-semibold px-4 py-2.5 hover:bg-[#134a80] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {uploading ? "Extracting details…" : "Extract details"}
      </button>
      <p className="text-[11px] text-text-muted">Select both front and back, then Extract — same Google Vision OCR as the main applicant.</p>
      {error && <p className="text-[12px] text-red-700">{error}</p>}
    </div>
  );
}

// One side of the co-applicant Aadhaar: the pick tile (green once a file is
// picked or one is on record) and a View link for the stored image.
function AadhaarSideTile({
  title, picked, has, url, uploading, onClick,
}: {
  title: string;
  picked: File | null;
  has: boolean;
  url?: string | null;
  uploading: boolean;
  onClick: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={uploading}
        className={[
          "w-full h-[84px] rounded-input border-2 border-dashed text-center flex items-center justify-center px-3 transition-colors",
          has || picked
            ? "border-[#178a5c] bg-[#f0faf5] text-[#0f3d2e]"
            : "border-[#185fa5] bg-white text-[#185fa5] hover:bg-[#f2f7fc]",
          uploading ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <div>
          <p className="text-[12px] font-semibold">{title}</p>
          <p className="text-[10px] mt-0.5">{picked ? picked.name : has ? "Uploaded — click to replace" : "Click to select"}</p>
        </div>
      </button>
      {url && (
        <a href={url} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#185fa5] hover:underline">
          <EyeIcon size="13" />
          View
        </a>
      )}
    </div>
  );
}
