"use client";

// One-file uploader for the insurance flow. Posts the picked file to an
// insurance API route (extract-pan / extract-invoice / upload …) and reports
// back the JSON. Kept tiny — the OCR/persist happens server-side; this just
// drives the input and shows status. (The geo plant photo uses
// GeoOfficeUpload instead; Aadhaar's two-file upload is handled inline.)

import { useRef, useState } from "react";
import { getToken } from "@/lib/auth";

type Props = {
  endpoint: string;
  field?: string;
  label: string;
  hint?: string;
  accept?: string;
  extra?: Record<string, string>;
  initiallyDone?: boolean;
  onDone?: (data: Record<string, unknown>) => void;
};

export default function InsuranceUpload({
  endpoint, field = "file", label, hint, accept = "image/*,application/pdf", extra, initiallyDone, onDone,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(!!initiallyDone);
  const [name, setName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handle(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append(field, f);
      if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) { setErr(d?.error || `Upload failed (HTTP ${res.status}).`); return; }
      setDone(true);
      setName(f.name);
      onDone?.(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div>
      <p className="text-[13px] font-medium text-text-mid mb-1.5">{label}</p>
      <label
        className={[
          "flex flex-col items-center justify-center min-h-[132px] border-2 border-dashed rounded-input bg-white px-4 py-5 text-center cursor-pointer transition-colors",
          done ? "border-[#cdeadd] bg-[#f7fcfa]" : "border-[#185fa5] hover:bg-[#f2f7fc]",
        ].join(" ")}
      >
        <input
          ref={ref}
          type="file"
          className="hidden"
          accept={accept}
          disabled={busy}
          onChange={(e) => handle(e.target.files)}
        />
        {busy ? (
          <p className="text-[13px] text-text-muted">Uploading…</p>
        ) : done ? (
          <p className="text-[13px] text-[#178a5c] font-medium">✓ Uploaded{name ? ` — ${name}` : ""} · click to replace</p>
        ) : (
          <>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#185fa5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mb-2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-[14px] font-semibold text-[#185fa5]">Click to upload</p>
            <p className="text-[12px] text-[#5a86b3] mt-0.5">Photo, scan, or PDF</p>
          </>
        )}
      </label>
      {hint && !err && <p className="text-[11px] text-text-muted mt-1">{hint}</p>}
      {err && <p className="text-[12px] text-red-500 mt-1">{err}</p>}
    </div>
  );
}
