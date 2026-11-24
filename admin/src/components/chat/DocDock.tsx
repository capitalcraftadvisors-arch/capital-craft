"use client";

// Chat kit · the document dock of the team (admin) chats' "docs" turns, used by
// admin/app/intake (LOAN_INTAKE_THEME) and admin/epc/intake (EPC_INTAKE_THEME):
//
//   DocDock          one box per upload slot (tap / drag in / paste), the run
//                    button and "Don't have it — skip"
//   useDocDockFiles  the files + thumbnails attached to those slots
//
// The page does the upload / read itself (its runDocs) — the dock only collects
// the files. The paste (Ctrl+V) listener stays in the page: each chat enables it
// under its own conditions.

import { useEffect, useRef, useState } from "react";
import type { AdminChatTheme } from "./theme";

export type UploadSlot = { name: string; label: string };

/**
 * The files attached to the current docs turn, by slot name, with an image
 * thumbnail (blob: URL) for each.
 *   fillNextSlot(slots, file) puts a pasted file in the first empty slot.
 *   clearFiles() empties every slot (a new turn, Re-attach, a replace).
 * A thumbnail stays valid until the page unmounts, then every one is revoked —
 * not on a replace / clear, because the page hands the same blob: URLs to the
 * chat's document receipts and the read card, which outlive the dock's slots.
 */
export function useDocDockFiles() {
  const [files, setFiles] = useState<Record<string, File>>({});
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const made = useRef<string[]>([]);
  useEffect(() => () => { made.current.forEach((u) => URL.revokeObjectURL(u)); made.current = []; }, []);
  function setFileFor(name: string, file: File) {
    setFiles((s) => ({ ...s, [name]: file }));
    const thumb = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (thumb) made.current.push(thumb);
    setThumbs((s) => ({ ...s, [name]: thumb }));
  }
  function clearFileFor(name: string) {
    setFiles((s) => { const n = { ...s }; delete n[name]; return n; });
    setThumbs((s) => { const n = { ...s }; delete n[name]; return n; });
  }
  function fillNextSlot(slots: UploadSlot[], file: File) {
    const empty = slots.find((u) => !files[u.name]);
    if (empty) setFileFor(empty.name, file);
  }
  function clearFiles() { setFiles({}); setThumbs({}); }
  return { files, thumbs, setFileFor, clearFileFor, fillNextSlot, clearFiles };
}

/**
 * `runLabel` is the main button's text — each chat words it differently
 * ("Read document", "Upload & attach", "Re-read & replace"…). `replacing` hides
 * the skip button (an earlier document is being replaced). A file dropped on the
 * box goes to the first empty slot (through `onPick`, like a tapped one).
 */
export function DocDock({ theme, uploads, files, thumbs, onPick, onClear, onRun, onSkip, replacing, runLabel }: {
  theme: AdminChatTheme; uploads: UploadSlot[]; files: Record<string, File>; thumbs: Record<string, string | null>;
  onPick: (name: string, f: File) => void; onClear: (name: string) => void; onRun: () => void; onSkip: () => void;
  replacing?: boolean; runLabel: string;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault(); setDrag(false);
          const f = e.dataTransfer.files?.[0];
          const empty = f && uploads.find((u) => !files[u.name]);
          if (f && empty) onPick(empty.name, f);
        }}
        className={["rounded-xl border-2 border-dashed p-2.5 transition", drag ? `${theme.accentBorder} ${theme.headBg}` : "border-line bg-white"].join(" ")}
      >
        <div className="grid gap-2" style={{ gridTemplateColumns: uploads.length > 1 ? "1fr 1fr" : "1fr" }}>
          {uploads.map((u) => {
            const has = !!files[u.name];
            return (
              <label key={u.name} className={["relative flex items-center gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition", has ? `${theme.accentBorder} ${theme.tintBg}` : `border-line bg-white ${theme.accentBorderHalf}`].join(" ")}>
                {has && thumbs[u.name]
                  ? <img src={thumbs[u.name] as string} alt="" className="w-9 h-9 rounded-md object-cover" />
                  : <span className="w-9 h-9 rounded-md bg-bg-soft grid place-items-center text-[15px]">{has ? "📄" : "＋"}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-text truncate">{u.label}</span>
                  <span className="block text-[11px] text-text-muted truncate">{has ? files[u.name].name : "Tap, drop, or paste"}</span>
                </span>
                {has
                  ? <button type="button" onClick={(e) => { e.preventDefault(); onClear(u.name); }} className="text-text-muted hover:text-red-500 text-[15px] leading-none px-1">×</button>
                  : <span className={`${theme.accentText} text-[12px] font-semibold`}>Add</span>}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(u.name, f); e.currentTarget.value = ""; }} />
              </label>
            );
          })}
        </div>
        <div className="text-[11px] text-text-muted mt-2 px-0.5">Attach by tapping, dragging a file in, or pasting a copied image (Ctrl+V).</div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onRun} className={`px-4 py-2 rounded-lg ${theme.accentBg} text-white text-[13px] font-semibold ${theme.accentBgHover}`}>{runLabel}</button>
        {!replacing && <button onClick={onSkip} className="px-3 py-2 rounded-lg text-[12.5px] text-text-muted hover:text-text hover:bg-bg-soft">Don&apos;t have it — skip</button>}
      </div>
    </div>
  );
}
