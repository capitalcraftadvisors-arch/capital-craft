"use client";

// Admin-only GST R3B section on the EPC detail page.
//
// Workflow:
//   1. Admin picks a mode: Monthly (up to 12 files) or Quarterly (up to 4).
//   2. Admin uploads files. Each one is SHA-256'd client-side; duplicates
//      against already-uploaded files are skipped (with a clear message).
//   3. For each file, OCR runs and pre-fills month/quarter, year, and the
//      Total taxable value (row 3.1(a)). All three are editable per row.
//   4. The table sorts newest-first. The row with the most-recent period
//      gets a highlighted border.
//   5. Switching modes after uploads requires confirmation and wipes the
//      table.
//
// Storage: same epc_documents table + GCS bucket + signed-URL viewing
// as all other doc categories. Per-file metadata lives in the JSONB
// `metadata` column with shape:
//   {
//     period_type: "monthly" | "quarterly",
//     content_hash: "<sha256-hex>",
//     month: "Apr" | ... | null,        // monthly mode
//     quarter: "Apr-Jun" | ... | null,  // quarterly mode
//     year: 2024 | null,
//     total_taxable_value: number | null,
//     gstin, legal_name, trade_name: string | null,
//     ocr_raw_text?: string             // truncated audit copy
//   }
//
// Admin-only enforcement (RLS, /api/upload, /api/document/[id]) is
// untouched by this rewrite — same constraints apply.

import { useEffect, useMemo, useRef, useState } from "react";
import Card from "@/components/ui/Card";
import { supabase } from "@/lib/supabase";
import { uploadDocument, getDocumentUrl, deleteDocument } from "@/lib/storage";
import { extractGstR3b } from "@/lib/ocr";
import { isAcceptedFileType } from "@/lib/validators";

type Mode = "monthly" | "quarterly";

const MAX_MONTHLY = 12;
const MAX_QUARTERLY = 4;

const MONTHS_ORDER = [
  "Apr", "May", "Jun", "Jul", "Aug", "Sep",
  "Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
] as const;

const QUARTERS_ORDER = ["Apr-Jun", "Jul-Sep", "Oct-Dec", "Jan-Mar"] as const;

// Calendar-month number for sorting. Latest = highest sortKey = year*100 + monthNum.
const MONTH_CAL_NUM: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};
const QUARTER_START_NUM: Record<string, number> = {
  "Apr-Jun": 4, "Jul-Sep": 7, "Oct-Dec": 10, "Jan-Mar": 1,
};

type Meta = {
  period_type: Mode;
  content_hash: string;
  month: string | null;
  quarter: string | null;
  year: number | null;
  total_taxable_value: number | null;
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  ocr_raw_text?: string;
};

type Doc = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  file_name: string | null;
  metadata: Meta;
};

type LegacyRow = { id: string; storage_path: string };

export default function GstR3bSection({ businessId }: { businessId: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [legacy, setLegacy] = useState<LegacyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Docs that have been uploaded but whose OCR pass is still running.
  // While a doc id is in this set, its row's editable inputs are disabled so
  // an in-flight OCR pre-fill can't overwrite an admin edit mid-keystroke.
  const [ocrInProgress, setOcrInProgress] = useState<Set<string>>(new Set());

  const max =
    mode === "monthly" ? MAX_MONTHLY : mode === "quarterly" ? MAX_QUARTERLY : 0;

  // ── Load ──────────────────────────────────────────────────────────────
  async function load() {
    const { data } = await supabase()
      .from("epc_documents")
      .select("id, storage_path, mime_type, file_name, metadata")
      .eq("business_id", businessId)
      .eq("category", "gst_r3b");

    const all = (data ?? []) as Doc[];
    const validDocs: Doc[] = [];
    const legacyRows: LegacyRow[] = [];
    for (const d of all) {
      const pt = d.metadata?.period_type;
      if (pt === "monthly" || pt === "quarterly") {
        validDocs.push(d);
      } else {
        legacyRows.push({ id: d.id, storage_path: d.storage_path });
      }
    }
    setDocs(validDocs);
    setLegacy(legacyRows);
    if (validDocs.length > 0) setMode(validDocs[0].metadata.period_type);
    setLoaded(true);
  }

  useEffect(() => { void load(); }, [businessId]);

  // ── Legacy cleanup ────────────────────────────────────────────────────
  async function clearLegacy() {
    if (
      !confirm(
        `Permanently delete ${legacy.length} legacy GSTR-3B file${
          legacy.length > 1 ? "s" : ""
        } from the previous design? This cannot be undone.`,
      )
    ) return;
    setBusy(true);
    for (const l of legacy) {
      await deleteDocument(l.id);
    }
    setBusy(false);
    await load();
  }

  // ── Mode switch (destructive if there are existing rows) ──────────────
  async function pickMode(newMode: Mode) {
    if (mode === newMode) return;
    if (docs.length > 0) {
      if (
        !confirm(
          `Switching to ${newMode} mode will permanently delete the ${docs.length} file${
            docs.length > 1 ? "s" : ""
          } already uploaded under ${mode} mode. Continue?`,
        )
      ) return;
      setBusy(true);
      for (const d of docs) {
        await deleteDocument(d.id);
      }
      setBusy(false);
    }
    setMode(newMode);
    setError(null);
    setInfo(null);
    await load();
  }

  // ── Upload + OCR + dedup ──────────────────────────────────────────────
  async function handleFiles(files: FileList) {
    if (!mode) return;
    setError(null);
    setInfo(null);

    const incoming = Array.from(files);
    const slots = max - docs.length;
    const candidates = incoming.slice(0, slots);
    const dropped = incoming.length - candidates.length;

    setBusy(true);
    let uploaded = 0;
    let duplicates = 0;
    const existingHashes = new Set(docs.map((d) => d.metadata.content_hash));
    const batchHashes = new Set<string>();

    try {
      for (const file of candidates) {
        if (!isAcceptedFileType(file.type)) {
          setError("Only JPG, PNG, WEBP, or PDF.");
          continue;
        }

        const hash = await sha256Hex(file);
        if (existingHashes.has(hash) || batchHashes.has(hash)) {
          duplicates++;
          continue;
        }
        batchHashes.add(hash);

        // 1. Upload — creates the DB row with minimal metadata
        //    (period_type, content_hash). Row is now real.
        const r = await uploadDocument(file, {
          table: "epc_documents",
          category: "gst_r3b",
          business_id: businessId,
          extraMetadata: { period_type: mode, content_hash: hash },
        });
        if (!r.ok) {
          setError(r.error);
          continue;
        }

        // 2. Mark OCR as in progress for this row and refresh so the row
        //    appears in the table immediately with locked inputs and a
        //    "Reading…" indicator. Admin can see the upload landed, but
        //    can't edit the row's values until OCR finishes.
        setOcrInProgress((s) => {
          const next = new Set(s);
          next.add(r.id);
          return next;
        });
        await load();

        // 3. OCR. ~1-3s window where the row stays locked.
        const ocr = await extractGstR3b(file);

        const newMeta: Meta = {
          period_type: mode,
          content_hash: hash,
          month: ocr.ok ? ocr.month : null,
          quarter: ocr.ok ? ocr.quarter : null,
          year: ocr.ok ? ocr.year : null,
          total_taxable_value: ocr.ok ? ocr.total_taxable_value : null,
          gstin: ocr.ok ? ocr.gstin : null,
          legal_name: ocr.ok ? ocr.legal_name : null,
          trade_name: ocr.ok ? ocr.trade_name : null,
          ocr_raw_text: ocr.ok ? ocr.raw_text : undefined,
        };

        await supabase()
          .from("epc_documents")
          .update({ metadata: newMeta })
          .eq("id", r.id);

        // 4. Release the lock and reload so the OCR-prefilled values land
        //    in the row's editable inputs.
        setOcrInProgress((s) => {
          const next = new Set(s);
          next.delete(r.id);
          return next;
        });
        await load();

        uploaded++;
      }
    } finally {
      setBusy(false);
    }

    // Status messages.
    const parts: string[] = [];
    if (duplicates > 0) {
      parts.push(
        `${duplicates} duplicate file${duplicates > 1 ? "s" : ""} skipped`,
      );
    }
    if (dropped > 0) {
      parts.push(
        `${dropped} file${dropped > 1 ? "s" : ""} dropped (max ${max} reached)`,
      );
    }
    if (parts.length > 0) {
      const remainingNeeded = max - (docs.length + uploaded);
      const tail =
        remainingNeeded > 0
          ? ` — add ${remainingNeeded} more if you have them.`
          : ".";
      setInfo(parts.join(", ") + tail);
    }
  }

  async function removeDoc(d: Doc) {
    if (!confirm("Remove this GSTR-3B file?")) return;
    const ok = await deleteDocument(d.id);
    if (!ok) {
      setError("Could not delete this file.");
      return;
    }
    await load();
  }

  async function updateRow(d: Doc, patch: Partial<Meta>) {
    const merged: Meta = { ...d.metadata, ...patch };
    await supabase()
      .from("epc_documents")
      .update({ metadata: merged })
      .eq("id", d.id);
    setDocs((arr) =>
      arr.map((x) => (x.id === d.id ? { ...x, metadata: merged } : x)),
    );
  }

  // ── Derived ───────────────────────────────────────────────────────────
  const consensus = useMemo(() => {
    let gstin: string | null = null;
    let legal_name: string | null = null;
    let trade_name: string | null = null;
    for (const d of docs) {
      if (!gstin && d.metadata.gstin) gstin = d.metadata.gstin;
      if (!legal_name && d.metadata.legal_name) legal_name = d.metadata.legal_name;
      if (!trade_name && d.metadata.trade_name) trade_name = d.metadata.trade_name;
    }
    return { gstin, legal_name, trade_name };
  }, [docs]);

  const sum = useMemo(() => {
    return docs.reduce((s, d) => {
      const v = d.metadata.total_taxable_value;
      return typeof v === "number" && !isNaN(v) ? s + v : s;
    }, 0);
  }, [docs]);

  const sortedDocs = useMemo(() => {
    return [...docs].sort((a, b) => sortKey(b) - sortKey(a));
  }, [docs]);

  const latestId = useMemo(() => {
    let bestKey = -1;
    let bestId: string | null = null;
    for (const d of docs) {
      const k = sortKey(d);
      if (k > bestKey) {
        bestKey = k;
        bestId = d.id;
      }
    }
    return bestId;
  }, [docs]);

  if (!loaded) return null;

  return (
    <Card className="p-6">
      <h3 className="font-display font-semibold text-[16px] mb-1">GST R3B</h3>
      <p className="text-[12px] text-text-muted mb-4">
        Admin-only. Files and parsed values are never visible to the EPC.
      </p>

      {legacy.length > 0 && (
        <div className="mb-4 p-3 rounded-input bg-gold-50 border border-[#f5b800]/30 flex items-center justify-between gap-4">
          <p className="text-[13px] text-[#8a6500]">
            <strong>Legacy data found.</strong>{" "}
            {legacy.length} file{legacy.length > 1 ? "s" : ""} from the previous
            design (Present/Previous panels) — not displayed in the new table.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={clearLegacy}
            className="shrink-0 text-[12px] font-semibold text-[#8a6500] border border-[#8a6500]/40 px-3 py-1.5 rounded hover:bg-[#f5b800]/15 disabled:opacity-50"
          >
            Clear legacy files
          </button>
        </div>
      )}

      {!mode ? (
        <ModePicker onPick={pickMode} />
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] text-text-mid">
              Filing mode:{" "}
              <span className="font-semibold text-text capitalize">{mode}</span>
              <span className="text-text-muted">
                {" "}(up to {max} files)
              </span>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                pickMode(mode === "monthly" ? "quarterly" : "monthly")
              }
              className="text-[12px] text-blue hover:underline disabled:opacity-50"
            >
              Switch to {mode === "monthly" ? "Quarterly" : "Monthly"}
            </button>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mb-4 text-[13px]">
            <ConsensusField label="GSTIN" value={consensus.gstin} />
            <ConsensusField label="Legal name" value={consensus.legal_name} />
            <ConsensusField label="Trade name" value={consensus.trade_name} />
          </div>

          {error && (
            <p className="text-[12px] text-red-500 mb-3">{error}</p>
          )}
          {info && (
            <p className="text-[12px] text-text-mid bg-blue-50 border border-blue/15 rounded-input px-3 py-2 mb-3">
              {info}
            </p>
          )}

          {docs.length < max && (
            <Uploader
              disabled={busy}
              max={max}
              used={docs.length}
              onFiles={handleFiles}
            />
          )}

          {sortedDocs.length > 0 && (
            <DocTable
              mode={mode}
              docs={sortedDocs}
              latestId={latestId}
              ocrInProgress={ocrInProgress}
              onUpdate={updateRow}
              onRemove={removeDoc}
            />
          )}

          <div className="bg-bg-tint border border-blue/15 rounded-input p-3 mt-4 flex justify-between items-center">
            <span className="text-[13px] text-text-mid">
              Sum &mdash; Total taxable value across all rows
            </span>
            <span className="text-[16px] font-semibold text-text">
              ₹{sum.toLocaleString("en-IN", {
                minimumFractionDigits: 2, maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Sortable integer: year * 100 + calendar-month-number-of-period-start.
// Returns -1 for unrankable rows so they sort to the bottom.
function sortKey(d: Doc): number {
  const year = d.metadata.year;
  if (typeof year !== "number") return -1;
  let m: number | undefined;
  if (d.metadata.period_type === "monthly") {
    const mo = d.metadata.month;
    m = mo ? MONTH_CAL_NUM[mo] : undefined;
  } else {
    const q = d.metadata.quarter;
    m = q ? QUARTER_START_NUM[q] : undefined;
  }
  if (m === undefined) return -1;
  return year * 100 + m;
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function ModePicker({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <div>
      <h4 className="font-semibold text-[14px] mb-2">How does this EPC file GSTR-3B?</h4>
      <p className="text-[12px] text-text-muted mb-4">
        Pick one to start uploading. You can switch later, but switching clears the table.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onPick("monthly")}
          className="border-2 border-line rounded-input bg-white p-4 text-left hover:border-blue transition-colors"
        >
          <p className="text-[14px] font-semibold text-text">Monthly</p>
          <p className="text-[12px] text-text-muted mt-1">
            Up to 12 monthly returns.
          </p>
        </button>
        <button
          type="button"
          onClick={() => onPick("quarterly")}
          className="border-2 border-line rounded-input bg-white p-4 text-left hover:border-blue transition-colors"
        >
          <p className="text-[14px] font-semibold text-text">Quarterly</p>
          <p className="text-[12px] text-text-muted mt-1">
            Up to 4 quarterly returns (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar).
          </p>
        </button>
      </div>
    </div>
  );
}

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
  max, used, disabled, onFiles,
}: {
  max: number;
  used: number;
  disabled: boolean;
  onFiles: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <label
      className={[
        "block border-2 border-dashed border-line rounded-input bg-white",
        "px-4 py-5 text-center cursor-pointer hover:border-blue transition-colors mb-3",
        disabled ? "opacity-60 pointer-events-none" : "",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/*,application/pdf"
        multiple
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(e.target.files);
            if (inputRef.current) inputRef.current.value = "";
          }
        }}
      />
      <p className="text-[13px] text-text-mid">
        {disabled ? "Working…" : `Click to upload (${used}/${max} used)`}
      </p>
      <p className="text-[11px] text-text-muted mt-1">
        JPG, PNG, WEBP, or PDF. Duplicates are auto-skipped.
      </p>
    </label>
  );
}

// ── Table + rows ───────────────────────────────────────────────────────────

function DocTable({
  mode, docs, latestId, ocrInProgress, onUpdate, onRemove,
}: {
  mode: Mode;
  docs: Doc[];
  latestId: string | null;
  ocrInProgress: Set<string>;
  onUpdate: (d: Doc, patch: Partial<Meta>) => void;
  onRemove: (d: Doc) => void;
}) {
  return (
    <div className="border border-line rounded-input overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="bg-bg-soft border-b border-line">
          <tr className="text-left text-text-muted">
            <th className="px-3 py-2 font-medium">GST file</th>
            <th className="px-3 py-2 font-medium">
              {mode === "monthly" ? "Month-Year" : "Period-Year"}
            </th>
            <th className="px-3 py-2 font-medium">Total taxable value</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <DocRow
              key={d.id}
              d={d}
              mode={mode}
              isLatest={d.id === latestId}
              ocrPending={ocrInProgress.has(d.id)}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocRow({
  d, mode, isLatest, ocrPending, onUpdate, onRemove,
}: {
  d: Doc;
  mode: Mode;
  isLatest: boolean;
  ocrPending: boolean;
  onUpdate: (d: Doc, patch: Partial<Meta>) => void;
  onRemove: (d: Doc) => void;
}) {
  // Local state for editable fields (commit on blur).
  const [periodSel, setPeriodSel] = useState<string>(
    (mode === "monthly" ? d.metadata.month : d.metadata.quarter) ?? "",
  );
  const [yearStr, setYearStr] = useState<string>(
    d.metadata.year != null ? String(d.metadata.year) : "",
  );
  const [valStr, setValStr] = useState<string>(
    d.metadata.total_taxable_value != null
      ? String(d.metadata.total_taxable_value)
      : "",
  );

  // Re-sync if the doc updates from outside (e.g., after OCR finishes).
  useEffect(() => {
    setPeriodSel((mode === "monthly" ? d.metadata.month : d.metadata.quarter) ?? "");
  }, [mode, d.metadata.month, d.metadata.quarter]);
  useEffect(() => {
    setYearStr(d.metadata.year != null ? String(d.metadata.year) : "");
  }, [d.metadata.year]);
  useEffect(() => {
    setValStr(
      d.metadata.total_taxable_value != null
        ? String(d.metadata.total_taxable_value)
        : "",
    );
  }, [d.metadata.total_taxable_value]);

  function commitPeriod(next: string) {
    if (mode === "monthly") {
      onUpdate(d, { month: next || null, quarter: null });
    } else {
      onUpdate(d, { quarter: next || null, month: null });
    }
  }
  function commitYear() {
    const s = yearStr.trim();
    if (!s) { onUpdate(d, { year: null }); return; }
    const y = parseInt(s, 10);
    if (isNaN(y) || y < 2017 || y > 2050) return;
    onUpdate(d, { year: y });
  }
  function commitValue() {
    const s = valStr.replace(/,/g, "").trim();
    if (!s) { onUpdate(d, { total_taxable_value: null }); return; }
    const v = parseFloat(s);
    if (isNaN(v)) return;
    onUpdate(d, { total_taxable_value: v });
  }

  const isPdf = (d.mime_type || "").includes("pdf");
  const periodOptions = mode === "monthly" ? MONTHS_ORDER : QUARTERS_ORDER;

  return (
    <tr
      className={[
        "border-b border-line last:border-0",
        isLatest ? "outline outline-2 outline-blue outline-offset-[-2px] bg-blue-50/30" : "",
      ].join(" ")}
    >
      <td className="px-3 py-2 max-w-[220px]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 bg-bg-tint rounded-md grid place-items-center text-blue text-[10px] font-bold shrink-0">
            {isPdf ? "PDF" : "IMG"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate">{d.file_name || "Document"}</p>
            {ocrPending && (
              <p className="text-[10px] text-blue animate-pulse">Reading…</p>
            )}
          </div>
          <button
            type="button"
            onClick={async () => {
              const u = await getDocumentUrl(d.id);
              if (u) window.open(u, "_blank");
            }}
            className="text-[12px] text-blue hover:underline shrink-0"
          >
            View
          </button>
        </div>
      </td>

      <td className="px-3 py-2">
        <div className="flex gap-1 items-center">
          <select
            value={periodSel}
            disabled={ocrPending}
            onChange={(e) => {
              setPeriodSel(e.target.value);
              commitPeriod(e.target.value);
            }}
            className="border border-line rounded px-1.5 py-1 text-[12px] focus:border-blue outline-none bg-white disabled:bg-bg-soft disabled:cursor-not-allowed"
          >
            <option value="">—</option>
            {periodOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="YYYY"
            value={yearStr}
            disabled={ocrPending}
            onChange={(e) => setYearStr(e.target.value.replace(/\D/g, ""))}
            onBlur={commitYear}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-[64px] border border-line rounded px-1.5 py-1 text-[12px] focus:border-blue outline-none disabled:bg-bg-soft disabled:cursor-not-allowed"
          />
        </div>
      </td>

      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <span className="text-text-muted text-[11px]">₹</span>
          <input
            type="text"
            inputMode="decimal"
            value={valStr}
            disabled={ocrPending}
            onChange={(e) => setValStr(e.target.value)}
            onBlur={commitValue}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="0.00"
            className="w-full max-w-[180px] border border-line rounded px-1.5 py-1 text-[12px] focus:border-blue outline-none disabled:bg-bg-soft disabled:cursor-not-allowed"
          />
        </div>
      </td>

      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => onRemove(d)}
          className="text-[12px] text-text-muted hover:text-red-500"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
