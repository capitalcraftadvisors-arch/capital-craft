"use client";

// Loan chat · the document table: one row per document, each read on pick
// (Aadhaar, PAN, bill, quotation, bank statement) or uploaded (photos).

import { useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/auth";
import { openLoanDoc } from "@/lib/storage";
import { PINCODE_RE } from "@/lib/validators";
import { PARTNER_THEME as THEME } from "@/components/chat/theme";
import type { Form } from "@/components/chat/types";
import { AddFileButton, ContinueRow, DocSlotTable, FieldRows, ReadingLine, SlotFileChip } from "@/components/chat/DocSlotTable";
import { UNIT_DONE_KEY, UNIT_FIELDS, geoTagged, type Row, type Slot, type Unit } from "./doc-rows";
import ExtraDocs, { type ExtraKey } from "./ExtraDocs";
import { readQuotation } from "./QuotationDock";

type SlotFile = { file: File; thumb: string | null };

export default function DocTable({ appId, form, rows, docRows = [], review = false, extras, onPatch, onDone }: { appId: string; form: Form; rows: Row[]; docRows?: { id: string; category: string; storage_path: string | null }[]; review?: boolean; extras?: { bills: boolean; only?: ExtraKey[] }; onPatch: (p: Form) => void; onDone: () => void }) {
  const [extrasBusy, setExtrasBusy] = useState(false);
  const [files, setFiles] = useState<Partial<Record<Slot, SlotFile>>>({});
  const [skipped, setSkipped] = useState<Partial<Record<Slot, boolean>>>({});
  // Slots the user re-opened via "Replace" — shows the file picker again even
  // though a document is already on file (editing). The existing path is kept
  // until a new file is actually picked, so backing out never wipes a document.
  const [reopened, setReopened] = useState<Partial<Record<Slot, boolean>>>({});
  const [reads, setReads] = useState<Partial<Record<Unit, { status: "reading" | "done" | "error"; error?: string }>>>({});
  const filesRef = useRef<Partial<Record<Slot, SlotFile>>>({});
  const mounted = useRef(true);
  // Picked images preview via object URLs — free each one when its file is
  // replaced, removed or the table goes away.
  const revokeThumb = (s?: SlotFile) => { if (s?.thumb) URL.revokeObjectURL(s.thumb); };
  useEffect(() => () => { mounted.current = false; Object.values(filesRef.current).forEach(revokeThumb); }, []);

  // The document already on file for a unit (View opens it, so editors can see
  // what they uploaded before). Path-based docs go via sign-doc; the PAN image is
  // a row, and a PAN read here opens by the signed URL its read returned.
  const unitTarget = (u: Unit): { path?: string; rowId?: string; url?: string } => {
    switch (u) {
      case "aadhaar":       return { path: form.aadhaar_front_path };
      case "pan":           return { url: form._pan_url, path: form.borrower_pan_path, rowId: docRows.find((d) => d.category === "borrower_pan")?.id };
      case "ebill":         return { path: form.ebill_path };
      case "rooftop":       return { path: form.rooftop_photo_path };
      case "selfie":        return { path: form.customer_photo_path };
      case "bank":          return { path: form.bank_statement_path };
      case "coapp_aadhaar": return { path: form.coapp_aadhaar_front_path };
      case "coapp_pan":     return { url: form._coapp_pan_url, path: form.coapp_pan_path };
      case "quotation":     return { path: form.proforma_invoice_path };
      default:              return {};
    }
  };
  const unitPrefilled = (u: Unit) => UNIT_DONE_KEY[u].some((k) => !!(form[k] && String(form[k]).trim()));
  const unitDone = (u: Unit) => reads[u]?.status === "done" || unitPrefilled(u);
  const rowOpen = (slot: Slot, u: Unit) => !files[slot] && !skipped[slot] && (!!reopened[slot] || !unitPrefilled(u));
  // A row is settled once its read is done (or it was on file, or skipped), and
  // nothing continues while any read is running — the next turns act on it.
  const rowSettled = (r: Row) => !!skipped[r.slot] || (!!files[r.slot] && reads[r.unit]?.status === "done") || unitPrefilled(r.unit);
  const reading = Object.values(reads).some((x) => x?.status === "reading");
  // In review mode every row is already uploaded (or optional), so Continue is
  // always available — the table is for checking/fixing, not forced completion.
  const allSettled = review || (!reading && !extrasBusy && rows.every(rowSettled));

  async function callRoute(unit: Unit, f: Partial<Record<Slot, SlotFile>>): Promise<Form> {
    const fileOf = (s: Slot) => { const x = f[s]?.file; if (!x) throw new Error("File missing — re-attach it."); return x; };
    // Aadhaar (applicant / co-app) — front + back in one extract-aadhaar call.
    if (unit === "aadhaar" || unit === "coapp_aadhaar") {
      const co = unit === "coapp_aadhaar";
      const fd = new FormData();
      fd.append("front", fileOf(co ? "coapp_aadhaar_front" : "aadhaar_front"));
      fd.append("back", fileOf(co ? "coapp_aadhaar_back" : "aadhaar_back"));
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-aadhaar`, { method: "POST", headers: authHeaders(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the Aadhaar.");
      const x = j.fields ?? {}, p = j.storage_paths ?? {};
      // Names (borrower_name / coapp_name) are set when the roles are assigned.
      if (co) return { coapp_aadhaar_name: x.name ?? "", coapp_aadhaar_dob: x.dob ?? "", coapp_aadhaar_gender: x.gender ?? "", coapp_aadhaar_number: x.aadhaar_number ?? "", coapp_aadhaar_care_of: x.care_of ?? "", coapp_aadhaar_address: x.address ?? "", coapp_aadhaar_front_path: p.front ?? "", coapp_aadhaar_back_path: p.back ?? "", coapp_aadhaar_face_path: p.face ?? "" };
      return { aadhaar_name: x.name ?? "", aadhaar_dob: x.dob ?? "", aadhaar_gender: x.gender ?? "", aadhaar_number: x.aadhaar_number ?? "", aadhaar_care_of: x.care_of ?? "", aadhaar_address: x.address ?? "", aadhaar_front_path: p.front ?? "", aadhaar_back_path: p.back ?? "", aadhaar_face_path: p.face ?? "" };
    }
    // PAN (either person) — extract-coapp-pan, read-only (no `applicant=1`, so
    // no doc row yet): who the applicant is isn't final until the roles are
    // decided. The submit files the final applicant's PAN (borrower_pan_path)
    // as the borrower_pan row; the co-applicant's goes in coapp_pan_path.
    if (unit === "pan" || unit === "coapp_pan") {
      const applicant = unit === "pan";
      const file = fileOf(applicant ? "pan" : "coapp_pan");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-coapp-pan`, { method: "POST", headers: authHeaders(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the PAN.");
      const x = j.fields ?? {};
      const mime = file.type.startsWith("image/") ? "image/jpeg" : file.type; // the route stores images as JPEG
      // A PAN with no readable date keeps the date of birth already on file.
      if (applicant) return { borrower_pan: x.pan ?? "", borrower_father_name: x.father_name ?? "", _pan_name: x.name ?? "", ...(x.dob ? { borrower_dob: x.dob } : {}), borrower_pan_path: j.storage_path ?? "", borrower_pan_mime: mime, borrower_pan_file_name: file.name, _pan_url: j.signed_url ?? "" };
      return { coapp_pan: x.pan ?? "", coapp_father_name: x.father_name ?? "", _coapp_pan_name: x.name ?? "", ...(x.dob ? { coapp_dob: x.dob } : {}), coapp_pan_path: j.storage_path ?? "", _coapp_pan_mime: mime, _coapp_pan_file_name: file.name, _coapp_pan_url: j.signed_url ?? "" };
    }
    // E-bill — extract-loan-docs (ebill side).
    if (unit === "ebill") {
      const fd = new FormData();
      fd.append("ebill", fileOf("ebill"));
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-loan-docs`, { method: "POST", headers: authHeaders(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the bill.");
      const e = j.ebill?.fields ?? {}; const path = j.ebill?.storage_path ?? "";
      // The bill's pincode pre-fills the installation pincode question.
      const pin = String(e.pincode ?? "").trim();
      return { ebill_path: path, monthly_bill_amount: e.monthly_bill_amount != null ? String(e.monthly_bill_amount) : "", discom_name: e.discom_name ?? "", ca_number: e.ca_number ?? "", ebill_address_line: e.ebill_address_line ?? "", ebill_name: e.ebill_name ?? "", ...(PINCODE_RE.test(pin) ? { install_pincode: pin } : {}) };
    }
    // Quotation / proforma — extract-loan-docs (proforma side); reads project
    // size + total cost. Used in the review table's Replace.
    if (unit === "quotation") return readQuotation(appId, fileOf("quotation"));
    // Bank statement — stored AND read (holder, bank, a/c no., IFSC, type), the
    // same reader the team's chat uses, so the profile's Bank details fill in
    // and the team never has to ask for it again. Saved with the application on submit.
    if (unit === "bank") {
      const fd = new FormData();
      fd.append("file", fileOf("bank"));
      fd.append("method", "manual_epdf");
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-bank-statement`, { method: "POST", headers: authHeaders(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the bank statement.");
      const b = (j.fields ?? {}) as Record<string, string | null>;
      return {
        bank_statement_path: j.storage_path ?? "", bank_statement_method: j.method ?? "manual_epdf",
        bank_account_holder: b.account_holder ?? "", bank_name: b.bank_name ?? "", bank_account_no: b.account_no ?? "",
        bank_ifsc: b.ifsc ?? "", bank_account_type: b.account_type ?? "", bank_mobile: b.mobile ?? "", bank_email: b.email ?? "",
      };
    }
    // Photos — upload only (no OCR); replace keeps one row/slot.
    const category = unit === "rooftop" ? "borrower_photo" : "customer_photo";
    const pathField = unit === "rooftop" ? "rooftop_photo_path" : "customer_photo_path";
    const fd = new FormData();
    if (unit === "rooftop" && form.plant_use_type === "commercial") {
      const g = await geoTagged(fileOf("rooftop"), category);
      fd.append("file", g.file);
      fd.append("gps", g.gps);
    } else {
      fd.append("file", fileOf(unit as Slot));
    }
    fd.append("table", "user_application_docs");
    fd.append("category", category);
    fd.append("application_id", appId);
    fd.append("uploaded_by", "epc");
    fd.append("replace", "true");
    const res = await fetch("/api/upload", { method: "POST", headers: authHeaders(), body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't upload the file.");
    return { [pathField]: j.storage_path };
  }

  async function run(unit: Unit, f: Partial<Record<Slot, SlotFile>>) {
    setReads((s) => ({ ...s, [unit]: { status: "reading" } }));
    try {
      const patch = await callRoute(unit, f);
      onPatch(patch);
      if (mounted.current) setReads((s) => ({ ...s, [unit]: { status: "done" } }));
    } catch (e) {
      if (mounted.current) setReads((s) => ({ ...s, [unit]: { status: "error", error: e instanceof Error ? e.message : "Couldn't read that." } }));
    }
  }

  function pick(slot: Slot, unit: Unit, file: File) {
    if (!(file.type.startsWith("image/") || file.type.includes("pdf"))) return;
    const thumb = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    revokeThumb(filesRef.current[slot]);
    const next = { ...filesRef.current, [slot]: { file, thumb } };
    filesRef.current = next; setFiles(next);
    if (skipped[slot]) setSkipped((s) => { const n = { ...s }; delete n[slot]; return n; });
    const parts = rows.find((r) => r.slot === slot)!.parts;
    if (parts.every((p) => next[p])) void run(unit, next);
  }
  function toggleSkip(slot: Slot) {
    const now = !skipped[slot];
    setSkipped((s) => ({ ...s, [slot]: now }));
    if (now) { const n = { ...filesRef.current }; revokeThumb(n[slot]); delete n[slot]; filesRef.current = n; setFiles(n); }
  }
  function replace(slot: Slot, unit: Unit) {
    const parts = rows.find((r) => r.slot === slot)!.parts;
    const n = { ...filesRef.current };
    for (const p of parts) { revokeThumb(n[p]); delete n[p]; }
    filesRef.current = n; setFiles(n);
    setReads((s) => { const x = { ...s }; delete x[unit]; return x; });
    // Re-open the picker for every part of this unit (front + back for Aadhaar).
    setReopened((s) => { const x = { ...s }; for (const p of parts) x[p] = true; return x; });
  }
  function cell(r: Row) {
    if (skipped[r.slot]) return <span className="text-[11.5px] text-text-muted italic">skipped</span>;
    if (rowOpen(r.slot, r.unit)) return <AddFileButton theme={THEME} onFile={(f) => pick(r.slot, r.unit, f)} />;
    return <SlotFileChip theme={THEME} thumb={files[r.slot]?.thumb} onReplace={() => replace(r.slot, r.unit)} />;
  }

  function strip(unit: Unit) {
    const rd = reads[unit];
    if (rd?.status === "reading") return <ReadingLine theme={THEME} />;
    if (rd?.status === "error") {
      const canRetry = rows.find((r) => r.unit === unit)!.parts.every((p) => filesRef.current[p]);
      return <span className="flex flex-wrap items-center gap-2 text-[11.5px]"><span className="text-red-600">{rd.error || "Couldn't read that."}</span>{canRetry && <button onClick={() => void run(unit, filesRef.current)} className="text-[#1e3a8a] font-semibold hover:underline">Try again</button>}</span>;
    }
    if (unitDone(unit)) {
      const build = UNIT_FIELDS[unit];
      const tgt = unitTarget(unit);
      const viewLink = (tgt.url || tgt.path || tgt.rowId)
        ? <button onClick={() => void openLoanDoc(appId, tgt)} className="text-[#1e3a8a] text-[11px] font-semibold hover:underline">View current file</button>
        : null;
      return build
        ? <div className="flex flex-col gap-1.5">{viewLink}<FieldRows theme={THEME} fields={build(form).map((x) => { const value = form[x.field] || ""; return { ...x, value, ok: !!value }; })} onEdit={(field, value) => onPatch({ [field]: value })} /></div>
        : <span className="flex items-center gap-2 text-[11.5px] text-[#1e3a8a] font-medium">Uploaded ✓{viewLink && <>· {viewLink}</>}</span>;
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* An edit step for the any-number uploads alone has no table rows. */}
      {rows.length > 0 && <DocSlotTable theme={THEME} rows={rows} skipped={skipped} onToggleSkip={toggleSkip} cell={cell} strip={(r) => strip(r.unit)} />}
      {extras && <ExtraDocs appId={appId} form={form} docRows={docRows} bills={extras.bills} only={extras.only} onPatch={onPatch} onBusy={setExtrasBusy} />}
      <ContinueRow theme={THEME} label="Continue →" onClick={onDone} disabled={!allSettled} hint={reading || extrasBusy ? "" : "Add or tick “Don't have it” for every row to continue."} />
    </div>
  );
}
