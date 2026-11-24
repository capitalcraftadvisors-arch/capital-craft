"use client";

// Loan chat · the quotation step: upload the quotation / proforma, check the
// project size and cost read from it. readQuotation() is also the table's Replace.

import { useState } from "react";
import { authHeaders } from "@/lib/auth";
import { amountInput } from "@/lib/money";
import { errText } from "@/lib/errors";
import { PARTNER_THEME as THEME } from "@/components/chat/theme";
import type { Form } from "@/components/chat/types";
import { ContinueRow, FieldRows } from "@/components/chat/DocSlotTable";

// Reads a quotation / proforma (extract-loan-docs, proforma side): its stored
// path + the project size and total cost.
export async function readQuotation(appId: string, file: File): Promise<Form> {
  const fd = new FormData();
  fd.append("proforma", file);
  const res = await fetch(`/api/admin/loan-app/${appId}/extract-loan-docs`, { method: "POST", headers: authHeaders(), body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't read the quotation.");
  const p = j.proforma?.fields ?? {}; const path = j.proforma?.storage_path ?? "";
  return {
    proforma_invoice_path: path,
    ...(p.total_project_cost != null ? { total_project_cost: String(p.total_project_cost) } : {}),
    ...(p.project_size != null ? { project_size: String(p.project_size) } : {}),
    ...(p.project_size_unit ? { project_size_unit: String(p.project_size_unit) } : {}),
  };
}

// ── Quotation ──────────────────────────────────────────────────────────────
export default function QuotationDock({ appId, form, onPatch, onDone }: { appId: string; form: Form; onPatch: (p: Form) => void; onDone: () => void }) {
  const [status, setStatus] = useState<"idle" | "reading" | "done" | "error">(form.proforma_invoice_path ? "done" : "idle");
  const [err, setErr] = useState<string | null>(null);

  async function read(file: File) {
    if (!(file.type.startsWith("image/") || file.type.includes("pdf"))) return;
    setStatus("reading"); setErr(null);
    try {
      onPatch(await readQuotation(appId, file));
      setStatus("done");
    } catch (e) {
      setStatus("error"); setErr(errText(e, "Couldn't read the quotation."));
    }
  }

  const canContinue = (Number(form.project_size) || 0) > 0 && (Number(form.total_project_cost) || 0) > 0;

  return (
    <div className="flex flex-col gap-2.5">
      <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void read(f); }}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-navy bg-navy-soft px-4 py-3 cursor-pointer text-[13px] font-semibold text-navy hover:bg-navy-wash">
        {status === "reading" ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-navy/30 border-t-navy animate-spin" /> Reading…</> : <>＋ {status === "done" ? "Re-upload quotation" : "Upload quotation / proforma"}</>}
        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.currentTarget.value = ""; }} />
      </label>
      {err && <div className="text-[11.5px] text-red-600">{err}</div>}
      <div className="rounded-xl border border-line bg-white p-3">
        <FieldRows
          theme={THEME}
          fields={[
            { label: "Project size (kW)", field: "project_size", value: form.project_size || "", ok: !!form.project_size },
            { label: "Total project cost (₹)", field: "total_project_cost", value: form.total_project_cost || "", ok: !!form.total_project_cost },
          ]}
          onEdit={(field, value) => onPatch({ [field]: amountInput(value) })}
        />
      </div>
      <ContinueRow theme={THEME} label="Continue →" onClick={onDone} disabled={!canContinue} hint="Add the project size and cost to continue." />
    </div>
  );
}
