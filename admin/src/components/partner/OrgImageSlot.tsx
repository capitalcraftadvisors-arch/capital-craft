"use client";

// One branding image (logo / signature / stamp): a square preview with
// Upload / Change and Remove — through /api/epc/org-image.

import { useRef, useState, type ReactNode } from "react";
import { getToken } from "@/lib/auth";
import { orgImageUrl, type OrgImageKind } from "@/lib/org-profile";
import { setOrgImage } from "@/lib/org-settings";
import { NAVY } from "@/components/partner/PartnerShell";

export default function OrgImageSlot({ kind, path, empty, onChange }: {
  kind: OrgImageKind;
  path: string | null;
  empty: ReactNode;                       // shown in the square when there is no image
  onChange: (path: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE", body?: FormData): Promise<{ ok?: boolean; path?: string; error?: string }> {
    const res = await fetch(`/api/epc/org-image${method === "DELETE" ? `?kind=${kind}` : ""}`,
      { method, headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body });
    return res.json().catch(() => ({ error: "Network error." }));
  }
  async function done(p: string | null) { await setOrgImage(kind, p).catch(() => {}); onChange(p); }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    const r = await call("POST", fd);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (r.ok && r.path) await done(r.path);
    else setError(r.error || "Couldn't upload the image.");
  }

  async function remove() {
    if (!window.confirm("Remove this image?")) return;
    setBusy(true); setError(null);
    const r = await call("DELETE");
    setBusy(false);
    if (r.ok) await done(null);
    else setError(r.error || "Couldn't remove the image.");
  }

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="w-28 h-28 rounded-2xl border border-line bg-white grid place-items-center overflow-hidden shrink-0">
        {path ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={orgImageUrl(path)} alt="" className="w-full h-full object-contain p-2" />
        ) : empty}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 flex-wrap">
          <label className={"px-4 py-2 rounded-xl text-white text-[13.5px] font-semibold cursor-pointer" + (busy ? " opacity-60 pointer-events-none" : "")} style={{ background: NAVY }}>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
            {busy ? "Saving…" : path ? "Change" : "Upload"}
          </label>
          {path && (
            <button type="button" onClick={() => void remove()} disabled={busy}
              className="px-4 py-2 rounded-xl border border-line bg-white text-[13.5px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">
              Remove
            </button>
          )}
        </div>
        {error && <p className="text-[12.5px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}
