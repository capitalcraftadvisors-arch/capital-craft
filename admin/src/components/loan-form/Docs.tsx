"use client";

// Upload pieces shared by the loan-form pages. The empty "Click to upload" tile
// differs from page to page, so each page keeps its own; these two are the same
// everywhere:
//   UploadedDoc     — the green "file on record" box (name, time, View, Re-upload)
//   HiddenFileInput — the invisible file picker a tile opens with ref.current.click()

import { forwardRef } from "react";
import { fmtDateTime } from "@/lib/dates";
import { EyeIcon } from "./Fields";

/** Green box for a document already uploaded. View is a link when `viewUrl` is
 *  given, a button when `onView` is given, and hidden when neither is. */
export function UploadedDoc({
  fileName, uploadedAt, viewUrl, onView, onReupload, uploading,
}: {
  fileName: string;
  uploadedAt: string;
  viewUrl?: string | null;
  onView?: () => void;
  onReupload: () => void;
  uploading: boolean;
}) {
  const viewClass = "inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#185fa5] hover:underline";
  return (
    <div className="rounded-input border-2 border-[#178a5c] bg-[#f0faf5] p-4 space-y-2">
      <p className="text-[13px] font-semibold text-[#0f3d2e]">{fileName}</p>
      <p className="text-[11px] text-[#5a8a76]">
        Uploaded on {fmtDateTime(new Date(uploadedAt))}
      </p>
      <div className="flex items-center gap-2 pt-1">
        {viewUrl ? (
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener"
            title="View uploaded document"
            aria-label="View uploaded document"
            className={viewClass}
          >
            <EyeIcon size="14" />
            View
          </a>
        ) : onView ? (
          <button
            type="button"
            onClick={onView}
            title="View uploaded document"
            aria-label="View uploaded document"
            className={viewClass}
          >
            <EyeIcon size="14" />
            View
          </button>
        ) : null}
        <button
          type="button"
          onClick={onReupload}
          disabled={uploading}
          className="text-[12px] font-semibold text-[#178a5c] hover:underline disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "Re-upload"}
        </button>
      </div>
    </div>
  );
}

/** Invisible single-file picker (photo, scan or PDF). Hands the picked file to
 *  `onFile` and clears itself, so picking the same file again still fires. */
export const HiddenFileInput = forwardRef<HTMLInputElement, { onFile: (f: File) => void }>(
  function HiddenFileInput({ onFile }, ref) {
    return (
      <input
        ref={ref}
        type="file"
        accept="image/*,application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
        className="hidden"
      />
    );
  },
);
