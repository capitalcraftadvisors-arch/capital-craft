"use client";

// Intake chat — the document-slot table (one box per document, each read by its own route as it lands) and the combined-PDF mode.

import { useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/auth";
import { LOAN_INTAKE_THEME as THEME } from "@/components/chat/theme";
import type { FileReceipt, Form } from "@/components/chat/types";
import { AddFileButton, ContinueRow, DocSlotTable, FieldRows, ReadingLine, SlotFileChip } from "@/components/chat/DocSlotTable";
import {
  DOC_TABLE_ROWS, DOC_UNIT_PARTS, DOC_UNIT_PATHS, DOC_ROW_PATH, DOC_UNIT_FIELDS, UNIT_LABEL, docTableRowsFor, docTableUnitsFor,
  type DocRow, type DocSlot, type DocUnit,
} from "./doc-slots";
import { mapExtract } from "./form-map";
import type { Turn } from "./script";

type DocSlotFile = { file: File; thumb: string | null };
// Upload + read ONE unit with its dedicated route, returning the form patch. The
// mapping reuses mapExtract (identical to the old per-doc turns). Throws on a hard
// failure; the caller catches it and shows a per-row "couldn't read" state.
async function callDocRoute(unit: DocUnit, appId: string, files: Partial<Record<DocSlot, DocSlotFile>>, form: Form): Promise<Form> {
  const auth = authHeaders();
  const fileOf = (slot: DocSlot) => { const f = files[slot]?.file; if (!f) throw new Error("File missing — re-attach it."); return f; };
  if (unit === "aadhaar" || unit === "coapp_aadhaar") {
    const co = unit === "coapp_aadhaar";
    const fd = new FormData();
    fd.append("front", fileOf(co ? "coapp_aadhaar_front" : "aadhaar_front"));
    fd.append("back",  fileOf(co ? "coapp_aadhaar_back"  : "aadhaar_back"));
    const res = await fetch(`/api/admin/loan-app/${appId}/extract-aadhaar`, { method: "POST", headers: auth, body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the Aadhaar.");
    return mapExtract({ id: unit, bot: "", kind: "docs", extractRoute: "extract-aadhaar", extraForm: co ? { _coapp: "1" } : undefined } as Turn, j).patch;
  }
  if (unit === "applicant_pan" || unit === "coapp_pan") {
    const applicant = unit === "applicant_pan";
    const fd = new FormData();
    fd.append("file", fileOf(unit));
    if (applicant) fd.append("applicant", "1"); // route files it under the borrower_pan slot
    const res = await fetch(`/api/admin/loan-app/${appId}/extract-coapp-pan`, { method: "POST", headers: auth, body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the PAN.");
    return mapExtract({ id: unit, bot: "", kind: "docs", extractRoute: "extract-coapp-pan", applicantPan: applicant } as Turn, j).patch;
  }
  if (unit === "ebill") {
    const fd = new FormData();
    fd.append("ebill", fileOf("ebill"));
    const res = await fetch(`/api/admin/loan-app/${appId}/extract-loan-docs`, { method: "POST", headers: auth, body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the bill.");
    const patch = mapExtract({ id: "ebill", bot: "", kind: "docs", extractRoute: "extract-loan-docs" } as Turn, j).patch;
    // Name fallback (mirrors old runDocs): take the bill's name if the applicant's
    // is still unknown, honorific stripped, so we never re-ask a name a doc shows.
    if (!form.borrower_name && !patch.borrower_name && patch.ebill_name) {
      const nm = String(patch.ebill_name).replace(/^(m\/s|mr|mrs|ms|smt|shri|sri|dr)\.?\s+/i, "").trim();
      if (nm.length >= 2) patch.borrower_name = nm;
    }
    return patch;
  }
  // rooftop / selfie → /api/upload (no OCR). category MUST match the profile slot:
  // borrower_photo = rooftop, customer_photo = applicant photo.
  const category = unit === "rooftop" ? "borrower_photo" : "customer_photo";
  const pathField = unit === "rooftop" ? "rooftop_photo_path" : "customer_photo_path";
  const fd = new FormData();
  fd.append("file", fileOf(unit));
  fd.append("table", "user_application_docs");
  fd.append("category", category);
  fd.append("application_id", appId);
  fd.append("uploaded_by", "admin");
  fd.append("replace", "true"); // one row per photo slot — re-upload replaces, never duplicates (→ no stray "Other documents" copy)
  const res = await fetch("/api/upload", { method: "POST", headers: auth, body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't upload the photo.");
  const patch: Form = { [pathField]: j.storage_path };
  if (unit === "rooftop") patch.rooftop_photo_uploaded_at = new Date().toISOString();
  return patch;
}

// The document-slot table shown inside the chat dock for the doc_table turn.
// Column 1 = fixed label, Column 2 = upload box (tap / drop / paste) that reads
// with the row's dedicated extractor the moment a file lands (in parallel; a
// grouped Aadhaar reads once both sides are in), Column 3 = "Don't have it" skip.
// Every read is caught → a failing row shows "couldn't read — try again" and never
// blocks another. "Done with documents" enables once every row is uploaded or
// skipped; pending rows are recorded on the parent (draft at submit).
// Co-applicant visibility and edit-mode prefill both derive from `form`, so the
// table needs nothing else from the parent beyond the callbacks.
export default function DocTable({ appId, form, onPatch, onSkipChange, onDone, limitUnits }: {
  appId: string; form: Form;
  onPatch: (patch: Form) => void; onSkipChange: (label: string, skipped: boolean) => void;
  onDone: (receipt: FileReceipt[]) => void;
  limitUnits?: Set<DocUnit>;   // edit mode: show only these document units
}) {
  const [slotFiles, setSlotFiles] = useState<Partial<Record<DocSlot, DocSlotFile>>>({});
  const [skipped, setSkipped] = useState<Partial<Record<DocSlot, boolean>>>({});
  const [reads, setReads] = useState<Partial<Record<DocUnit, { status: "reading" | "done" | "error"; error?: string }>>>({});
  const [replacing, setReplacing] = useState<Partial<Record<DocUnit, boolean>>>({});
  // Optional shortcut: drop ONE combined PDF (all documents) → auto-split + fill
  // the boxes below. The rows read `form`, so patching it here fills them.
  const [combo, setCombo] = useState<{ status: "reading" | "done" | "error"; error?: string; filled?: number } | null>(null);
  const [comboName, setComboName] = useState<string>("");
  const filesRef = useRef<Partial<Record<DocSlot, DocSlotFile>>>({});
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const rows = docTableRowsFor(form).filter((r) => !limitUnits || limitUnits.size === 0 || limitUnits.has(r.unit));
  const labelOf = (slot: DocSlot) => DOC_TABLE_ROWS.find((r) => r.slot === slot)!.label;
  const rowPrefilled = (slot: DocSlot) => !!(form[DOC_ROW_PATH[slot]] && String(form[DOC_ROW_PATH[slot]]).trim());
  const unitPrefilled = (u: DocUnit) => DOC_UNIT_PATHS[u].every((k) => !!(form[k] && String(form[k]).trim()));
  const unitDone = (u: DocUnit) => !replacing[u] && (reads[u]?.status === "done" || unitPrefilled(u));
  // A box is "open" (needs a file) when it has no fresh file, isn't skipped, and
  // is either not on the profile or being replaced.
  const rowOpen = (slot: DocSlot, u: DocUnit) => !slotFiles[slot] && !skipped[slot] && (!rowPrefilled(slot) || !!replacing[u]);
  // A row is settled for "Continue" when skipped, freshly attached (and its read
  // hasn't hard-failed), or already on the profile. An errored read blocks only
  // softly — the RM can always tick "Don't have it".
  const rowSettled = (slot: DocSlot, u: DocUnit) =>
    !!skipped[slot] || (!!slotFiles[slot] && reads[u]?.status !== "error") || (!replacing[u] && rowPrefilled(slot));
  const allSettled = rows.every((r) => rowSettled(r.slot, r.unit));

  async function runUnit(unit: DocUnit, files: Partial<Record<DocSlot, DocSlotFile>>) {
    setReads((s) => ({ ...s, [unit]: { status: "reading" } }));
    try {
      const patch = await callDocRoute(unit, appId, files, form);
      onPatch(patch);
      if (mounted.current) setReads((s) => ({ ...s, [unit]: { status: "done" } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't read that — replace the file and try again.";
      if (mounted.current) setReads((s) => ({ ...s, [unit]: { status: "error", error: msg } }));
    }
  }

  // Combined-PDF shortcut → the auto-split route. Fills the table via onPatch;
  // the RM then reviews the filled rows + adds anything it couldn't read.
  async function runCombo(file: File) {
    if (!(file.type.includes("pdf") || file.type.startsWith("image/"))) return;
    setComboName(file.name || "combined PDF");
    setCombo({ status: "reading" });
    try {
      const fd = new FormData();
      fd.append("files", file);
      if (form.borrower_name) fd.append("applicant_name", form.borrower_name);
      if (form.coapp_name) fd.append("coapp_name", form.coapp_name);
      const res = await fetch(`/api/admin/loan-app/${appId}/bundle-docs`, { method: "POST", headers: authHeaders(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read that PDF.");
      if (j.form && typeof j.form === "object") onPatch(j.form as Form);
      const n = Array.isArray(j.documents) ? j.documents.length : 0;
      if (mounted.current) setCombo({ status: "done", filled: n });
    } catch (e) {
      if (mounted.current) setCombo({ status: "error", error: e instanceof Error ? e.message : "Couldn't read that PDF." });
    }
  }

  function pickFile(slot: DocSlot, unit: DocUnit, file: File) {
    if (!(file.type.startsWith("image/") || file.type.includes("pdf"))) return;
    const thumb = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    const next = { ...filesRef.current, [slot]: { file, thumb } };
    filesRef.current = next;
    setSlotFiles(next);
    if (skipped[slot]) { setSkipped((s) => { const n = { ...s }; delete n[slot]; return n; }); onSkipChange(labelOf(slot), false); }
    setReplacing((s) => (s[unit] ? { ...s, [unit]: false } : s));
    // Fire the read once EVERY part of this unit has a file (Aadhaar = both sides).
    if (DOC_UNIT_PARTS[unit].every((p) => next[p])) void runUnit(unit, next);
  }

  function toggleSkip(slot: DocSlot) {
    const now = !skipped[slot];
    setSkipped((s) => ({ ...s, [slot]: now }));
    onSkipChange(labelOf(slot), now);
    if (now) { const n = { ...filesRef.current }; delete n[slot]; filesRef.current = n; setSlotFiles(n); }
  }

  // "Replace" on a done unit → clear its file(s) + read so the box(es) re-open.
  // Aadhaar clears BOTH sides (the extractor reads front + back together).
  function replaceUnit(unit: DocUnit) {
    const n = { ...filesRef.current };
    for (const p of DOC_UNIT_PARTS[unit]) delete n[p];
    filesRef.current = n; setSlotFiles(n);
    setReads((s) => { const x = { ...s }; delete x[unit]; return x; });
    setReplacing((s) => ({ ...s, [unit]: true }));
  }
  // "Replace" on a box before its read finishes (e.g. one Aadhaar side) → clear
  // just that box; a done/prefilled unit clears wholesale.
  function reopen(slot: DocSlot, unit: DocUnit) {
    if (reads[unit]?.status === "done" || unitPrefilled(unit)) { replaceUnit(unit); return; }
    const n = { ...filesRef.current }; delete n[slot]; filesRef.current = n; setSlotFiles(n);
    setReads((s) => { const x = { ...s }; delete x[unit]; return x; });
  }

  function done() {
    if (form._doc_choice === "single") { onDone(comboName ? [{ name: comboName, thumb: null }] : []); return; }
    const receipt = rows.filter((r) => slotFiles[r.slot]).map((r) => ({ name: slotFiles[r.slot]!.file.name, thumb: slotFiles[r.slot]!.thumb }));
    onDone(receipt);
  }

  // Paste (Ctrl+V) fills the first open box.
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0]; if (!f) return;
      const target = rows.find((r) => rowOpen(r.slot, r.unit));
      if (!target) return;
      e.preventDefault();
      pickFile(target.slot, target.unit, f);
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  });

  // Column-2 content for a row (inline function, not a nested component — keeps the
  // field editor from remounting when a sibling row's read updates the parent).
  function cell(r: DocRow) {
    if (skipped[r.slot]) return <span className="text-[11.5px] text-text-muted italic">skipped</span>;
    if (rowOpen(r.slot, r.unit)) return <AddFileButton theme={THEME} onFile={(f) => pickFile(r.slot, r.unit, f)} />;
    return <SlotFileChip theme={THEME} thumb={slotFiles[r.slot]?.thumb} onReplace={() => reopen(r.slot, r.unit)} />;
  }

  // The read strip shown under a unit's last row: reading / error+retry / editable
  // fields / replacing. Returns null when the unit's boxes are still empty.
  function unitStrip(unit: DocUnit) {
    const rd = reads[unit];
    if (rd?.status === "reading") return <ReadingLine theme={THEME} />;
    if (rd?.status === "error") {
      const canRetry = DOC_UNIT_PARTS[unit].every((p) => filesRef.current[p]);
      return (
        <span className="flex flex-wrap items-center gap-2 text-[11.5px]">
          <span className="text-red-600">{rd.error || "Couldn't read that."}</span>
          {canRetry && <button onClick={() => void runUnit(unit, filesRef.current)} className="text-[#178a5c] font-semibold hover:underline">Try again</button>}
          <span className="text-text-muted">or use “Replace” above.</span>
        </span>
      );
    }
    if (unitDone(unit)) {
      const build = DOC_UNIT_FIELDS[unit];
      return build
        ? <FieldRows theme={THEME} fields={build(form)} onEdit={(field, value) => onPatch({ [field]: value })} />
        : <span className="text-[11.5px] text-[#178a5c] font-medium">Uploaded ✓</span>;
    }
    if (replacing[unit] && unitPrefilled(unit)) {
      return (
        <span className="flex items-center gap-2 text-[11.5px] text-text-muted">
          Replacing — attach the file{DOC_UNIT_PARTS[unit].length > 1 ? "s" : ""} above, or
          <button onClick={() => setReplacing((s) => ({ ...s, [unit]: false }))} className="text-[#178a5c] font-semibold hover:underline">keep the current one</button>
        </span>
      );
    }
    return null;
  }

  // ── SINGLE combined-PDF mode: one upload, OCR reads the whole PDF, review. ──
  if (form._doc_choice === "single") {
    const units = docTableUnitsFor(form);
    const foundUnits = units.filter((u) => unitDone(u) || unitPrefilled(u));
    const missingUnits = units.filter((u) => !(unitDone(u) || unitPrefilled(u)));
    const canContinue = combo?.status === "done" || foundUnits.length > 0;
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-xl border border-dashed border-[#cdeadd] bg-[#f7fcf9] px-3 py-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[12.5px] text-text-mid">
              <span className="font-semibold text-[#0f3d2e]">Upload the combined PDF</span> — I&rsquo;ll read every document inside it.
            </div>
            <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void runCombo(f); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#178a5c] bg-white px-3 py-1.5 cursor-pointer text-[12px] font-semibold text-[#178a5c] hover:bg-[#f0faf5] shrink-0">
              {combo?.status === "reading"
                ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-[#178a5c]/30 border-t-[#178a5c] animate-spin" /> Reading…</>
                : <>＋ {combo?.status === "done" ? "Re-upload PDF" : "Upload combined PDF"}</>}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void runCombo(f); e.currentTarget.value = ""; }} />
            </label>
          </div>
          {combo?.status === "reading" && <div className="text-[11.5px] text-text-muted mt-1">Reading the PDF and pulling out each document…</div>}
          {combo?.status === "error" && <div className="text-[11.5px] text-red-600 mt-1">{combo.error}</div>}
        </div>

        {combo?.status === "done" && (
          <div className="rounded-xl border border-line bg-white divide-y divide-line/70">
            {foundUnits.map((u) => {
              const build = DOC_UNIT_FIELDS[u];
              return (
                <div key={u} className="px-3 py-2.5">
                  <div className="text-[12px] font-semibold text-[#0f3d2e] mb-1">{UNIT_LABEL[u]} <span className="text-[#178a5c]">✓</span></div>
                  {build ? <FieldRows theme={THEME} fields={build(form)} onEdit={(field, value) => onPatch({ [field]: value })} /> : <span className="text-[11.5px] text-text-muted">Uploaded</span>}
                </div>
              );
            })}
            {missingUnits.length > 0 && (
              <div className="px-3 py-2.5 text-[11.5px] text-amber-700">
                Not found in the PDF: {missingUnits.map((u) => UNIT_LABEL[u]).join(", ")}. Re-upload a fuller PDF, or continue and add them later.
              </div>
            )}
          </div>
        )}

        <ContinueRow theme={THEME} label="Done with documents →" disabled={!canContinue} onClick={done} hint="Upload the combined PDF to continue." />
      </div>
    );
  }

  // ── SEPARATE mode: the labeled-slot table (one box per document). ──
  return (
    <div className="flex flex-col gap-2">
      <DocSlotTable theme={THEME} rows={rows} skipped={skipped} onToggleSkip={toggleSkip} cell={cell} strip={(r) => unitStrip(r.unit)} />
      <ContinueRow theme={THEME} label="Done with documents →" disabled={!allSettled} onClick={done} hint="Add or tick “Don't have it” for every row to continue." />
    </div>
  );
}
