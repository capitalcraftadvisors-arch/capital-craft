"use client";

// Loan chat · any-number uploads: other documents (named by the AI reader), and for
// a commercial customer more electricity bills and geo-tagged rooftop photos.

import { Fragment, useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/auth";
import { deleteDocument } from "@/lib/storage";
import { nameDocument } from "@/lib/ocr";
import { askConfirm } from "@/lib/confirm";
import type { LoanDocRow } from "@/lib/loan-form";
import type { Form } from "@/components/chat/types";
import { uidGen } from "./script";
import { geoTagged } from "./doc-rows";

// ── Extra documents (first table, or an edit step) ───────────────────────────
// Any number of other documents — each named by the AI reader from what it is
// ("ITR 2024-25"), else its file name — and, for a commercial customer, more
// electricity bills (the first bill in the table stays the one that's read) and
// more geo-tagged rooftop photos. Each file uploads on pick as its own
// user_application_docs row. The lists live in the form (`_extra_*`, never
// submitted) so they're still shown on coming back; an edit starts from what's
// already on file. Capital Craft opens them for an edit with the keys in
// EXTRA_PICK (the edit-table / Message-to-EPC rows).
type ExtraDoc = { id: string; name: string };
export type ExtraKey = "_extra_docs" | "_extra_bills" | "_extra_rooftops";
const EXTRA_KEYS: ExtraKey[] = ["_extra_docs", "_extra_bills", "_extra_rooftops"];
export const EXTRA_PICK: Record<ExtraKey, string> = { _extra_docs: "other_docs", _extra_bills: "extra_bills", _extra_rooftops: "extra_rooftops" };
// Each list's document category. More rooftop photos (commercial, geo-tagged)
// have their own, so re-uploading the first rooftop photo never removes them.
const EXTRA_CATEGORY: Record<ExtraKey, string> = { _extra_docs: "other", _extra_bills: "electricity_bill", _extra_rooftops: "rooftop_photo_extra" };
const extraList = (f: Form, key: ExtraKey, docRows: LoanDocRow[]): ExtraDoc[] => {
  if (f[key]) { try { return JSON.parse(f[key]) as ExtraDoc[]; } catch { return []; } }
  // Not in the form yet (an edit) → what's on file; the first bill is its own row.
  return docRows
    .filter((d) => d.category === EXTRA_CATEGORY[key] && !(key === "_extra_bills" && d.storage_path === f.ebill_path))
    .map((d) => ({ id: d.id, name: (d.file_name ?? "").replace(/\.[^.]+$/, "") || "Document" }));
};

export default function ExtraDocs({ appId, form, docRows, bills, only, onPatch, onBusy }: { appId: string; form: Form; docRows: LoanDocRow[]; bills: boolean; only?: ExtraKey[]; onPatch: (p: Form) => void; onBusy: (busy: boolean) => void }) {
  const [lists, setLists] = useState<Record<ExtraKey, ExtraDoc[]>>(() =>
    Object.fromEntries(EXTRA_KEYS.map((k) => [k, extraList(form, k, docRows)])) as Record<ExtraKey, ExtraDoc[]>);
  // Which lists show: an edit step's granted ones, else all that apply.
  const shows = (k: ExtraKey) => (only ? only.includes(k) : k === "_extra_docs" || bills);
  const [pending, setPending] = useState<{ key: string; list: ExtraKey; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    onPatch(Object.fromEntries(EXTRA_KEYS.map((k) => [k, JSON.stringify(lists[k])])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists]);
  useEffect(() => { onBusy(pending.length > 0); }, [pending.length, onBusy]);

  async function upload(list: ExtraKey, file: File) {
    const key = uidGen();
    setPending((p) => [...p, { key, list, name: file.name }]);
    try {
      const named = list === "_extra_docs" ? await nameDocument(file) : null;
      const ext = /\.[^.]+$/.exec(file.name)?.[0] ?? "";
      const fd = new FormData();
      if (list === "_extra_rooftops") {
        const g = await geoTagged(file, EXTRA_CATEGORY[list]);
        fd.append("file", g.file);
        fd.append("gps", g.gps);
      } else {
        fd.append("file", named ? new File([file], `${named}${ext}`, { type: file.type }) : file);
      }
      fd.append("table", "user_application_docs");
      fd.append("category", EXTRA_CATEGORY[list]);
      fd.append("application_id", appId);
      fd.append("uploaded_by", "epc");
      const res = await fetch("/api/upload", { method: "POST", headers: authHeaders(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok || !j.id) { setError(j?.error || `Couldn't upload ${file.name}.`); return; }
      const doc = { id: String(j.id), name: named ?? file.name.replace(/\.[^.]+$/, "") };
      setLists((l) => ({ ...l, [list]: [...l[list], doc] }));
    } catch (e) {
      // A rooftop photo with no location says why; anything else is a failed upload.
      setError(list === "_extra_rooftops" && e instanceof Error ? e.message : `Couldn't upload ${file.name}.`);
    } finally {
      setPending((p) => p.filter((x) => x.key !== key));
    }
  }
  function add(list: ExtraKey, files: FileList | null) {
    setError(null);
    for (const f of Array.from(files ?? [])) {
      if (f.type.startsWith("image/") || f.type.includes("pdf")) void upload(list, f);
    }
  }
  async function remove(list: ExtraKey, d: ExtraDoc) {
    if (!(await askConfirm(`Delete "${d.name}"? This can't be undone.`, { danger: true }))) return;
    if (!(await deleteDocument(d.id))) { setError(`Couldn't delete ${d.name}.`); return; }
    setLists((l) => ({ ...l, [list]: l[list].filter((x) => x.id !== d.id) }));
  }

  const block = (list: ExtraKey, title: string, label: (d: ExtraDoc, i: number) => string, top: boolean) => {
    const waiting = pending.filter((p) => p.list === list);
    return (
      <div className={top ? "" : "border-t border-line/70"}>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-[12.5px] text-text leading-snug">{title}</span>
          <label className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line hover:border-navy bg-white px-2.5 py-1.5 cursor-pointer text-[11.5px] font-semibold text-navy whitespace-nowrap">
            <span className="text-[13px] leading-none">＋</span> Add
            <input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => { add(list, e.target.files); e.currentTarget.value = ""; }} />
          </label>
        </div>
        {(lists[list].length > 0 || waiting.length > 0) && (
          <ul className="px-3 pb-2.5 flex flex-col gap-1.5">
            {lists[list].map((d, i) => (
              <li key={d.id} className="flex items-center gap-2 text-[12px] text-text min-w-0">
                <span className="w-6 h-6 rounded-md bg-navy-soft border border-navy-line grid place-items-center text-[11px] shrink-0">📄</span>
                <span className="truncate flex-1">{label(d, i)}</span>
                <button onClick={() => void remove(list, d)} aria-label={`Delete ${label(d, i)}`} className="text-cc-empty hover:text-red-600 text-[13px] leading-none px-1">✕</button>
              </li>
            ))}
            {waiting.map((p) => (
              <li key={p.key} className="flex items-center gap-2 text-[11.5px] text-text-muted min-w-0">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-navy/30 border-t-navy animate-spin shrink-0" />
                <span className="truncate">{p.name} · {list === "_extra_bills" ? "Uploading…" : "Reading…"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        {([
          ["_extra_bills", "More electricity bills", (_d, i) => `Electricity bill ${i + 2}`],
          ["_extra_rooftops", "More rooftop photos (geo-tagged)", (_d, i) => `Rooftop photo ${i + 2}`],
          ["_extra_docs", "Other documents", (d) => d.name],
        ] as [ExtraKey, string, (d: ExtraDoc, i: number) => string][])
          .filter(([k]) => shows(k))
          .map(([k, title, label], i) => <Fragment key={k}>{block(k, title, label, i === 0)}</Fragment>)}
      </div>
      {error && <span className="text-[11.5px] text-red-600">{error}</span>}
    </div>
  );
}
