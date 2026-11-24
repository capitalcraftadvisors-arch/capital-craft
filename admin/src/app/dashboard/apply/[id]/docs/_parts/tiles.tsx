"use client";

// Partner documents page · the small tiles: card heading + status pill, the
// "on file" row, the Aadhaar sides and number, the dashed pick tiles.

import { useRef } from "react";
import Input from "@/components/ui/Input";
import { RadioDot } from "@/components/loan-form";

// A document card's heading with its Uploaded / Pending pill.
export function DocCardHead({ title, done }: { title: string; done: boolean }) {
  return <div className="flex items-center justify-between gap-2"><h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">{title}</h2><DocStatus done={done} /></div>;
}

// A small Uploaded / Pending pill for a document card header.
function DocStatus({ done }: { done: boolean }) {
  return done
    ? <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#e6f6ee] text-[#178a5c] whitespace-nowrap">Uploaded</span>
    : <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">Pending</span>;
}

// A compact "already on file" row shown in an edit card: View + optional Remove.
export function DocOnFile({ label, onView, onRemove }: { label: string; onView: () => void; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-3 text-[13px] rounded-input bg-[#f0faf5] border border-[#cdeadd] px-3.5 py-2">
      <span className="text-[#178a5c] font-semibold shrink-0">✓ {label}</span>
      <button type="button" onClick={onView} className="text-blue font-semibold hover:underline">View</button>
      {onRemove && <button type="button" onClick={onRemove} className="text-red-600 hover:underline ml-auto">Remove</button>}
    </div>
  );
}

// An Aadhaar card's two sides (applicant or co-applicant): the two picks, the
// sides already on file, and the reading's progress / error.
export function AadhaarSides({
  front, back, paths, busy, err, onFront, onBack, onView,
}: {
  front: File | null; back: File | null; paths: { front: string; back: string } | null;
  busy: boolean; err: string | null;
  onFront: (f: File) => void; onBack: (f: File) => void; onView: (path: string) => void;
}) {
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <PickTile label="Aadhaar Front" file={front} onPick={onFront} busy={busy} done={!!paths} />
        <PickTile label="Aadhaar Back"  file={back}  onPick={onBack}  busy={busy} done={!!paths} />
      </div>
      {paths?.front && (
        <div className="grid sm:grid-cols-2 gap-2">
          <DocOnFile label="Aadhaar front" onView={() => void onView(paths.front)} />
          {paths.back && <DocOnFile label="Aadhaar back" onView={() => void onView(paths.back)} />}
        </div>
      )}
      {busy && <p className="text-[12px] text-text-muted">Extracting details…</p>}
      {err && <p className="text-[12px] text-red-700">{err}</p>}
    </>
  );
}

// The Aadhaar number, shown in groups of four ("0000 0000 0000"), kept as 12 digits.
export function AadhaarNumberInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      label="Aadhaar number"
      value={value.replace(/(\d{4})(?=\d)/g, "$1 ")}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 12))}
      placeholder="0000 0000 0000"
      maxLength={14}
    />
  );
}

// The dashed "click to pick a file" box behind PickTile, EbillTile and PanTile.
function UploadTile({
  height, filled, busy, onFile, children,
}: {
  height: string; filled: boolean; busy: boolean; onFile: (f: File) => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className={[
          `w-full ${height} rounded-input border-2 border-dashed flex items-center justify-center text-center px-3 transition-colors`,
          filled ? "border-[#178a5c] bg-[#f0faf5] text-[#0f3d2e]" : "border-[#185fa5] bg-white text-[#185fa5] hover:bg-[#f2f7fc]",
          busy ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        {children}
      </button>
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
    </div>
  );
}

function PickTile({
  label, file, onPick, busy, done,
}: {
  label: string; file: File | null; onPick: (f: File) => void;
  busy: boolean; done: boolean;
}) {
  const has = !!file || done;
  return (
    <UploadTile height="h-[110px]" filled={has} busy={busy} onFile={onPick}>
      <div>
        <p className="text-[13px] font-semibold">{label}</p>
        <p className="text-[10px] mt-0.5">{file ? file.name : has ? "Uploaded" : "Click to select"}</p>
      </div>
    </UploadTile>
  );
}

export function EbillTile({
  ebill, busy, onFile,
}: {
  ebill: { file_name: string } | null; busy: boolean; onFile: (f: File) => void;
}) {
  return (
    <UploadTile height="h-[110px]" filled={!!ebill} busy={busy} onFile={onFile}>
      <div>
        <p className="text-[13px] font-semibold">
          {busy ? "Uploading & reading…" : ebill ? ebill.file_name : "Click to upload"}
        </p>
        <p className="text-[10px] mt-0.5">{ebill ? "Click to replace" : "Photo, scan, or PDF"}</p>
      </div>
    </UploadTile>
  );
}

export function PanTile({
  path, busy, onFile,
}: {
  path: string | null; busy: boolean; onFile: (f: File) => void;
}) {
  return (
    <UploadTile height="h-[90px]" filled={!!path} busy={busy} onFile={onFile}>
      <p className="text-[13px] font-semibold">
        {busy ? "Uploading & reading…" : path ? "Uploaded — click to replace" : "Click to upload PAN"}
      </p>
    </UploadTile>
  );
}

export function ToggleTile({
  active, onClick, title, desc,
}: {
  active: boolean; onClick: () => void; title: string; desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "text-left rounded-input border-2 p-4 transition-colors relative",
        active ? "border-[#178a5c] bg-[#f0faf5]" : "border-line bg-white hover:border-[#185fa5]",
      ].join(" ")}
    >
      <RadioDot active={active} />
      <p className={"font-display font-semibold text-[14px] pr-6 " + (active ? "text-[#0f3d2e]" : "text-text")}>{title}</p>
      <p className="text-[12px] text-text-muted mt-1">{desc}</p>
    </button>
  );
}
