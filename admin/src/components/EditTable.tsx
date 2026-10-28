"use client";

// Shared multi-select edit table for a loan application. Rows are grouped
// (Documents · Co-applicant · Applicant details · Quotation & loan); each shows
// the current value, and documents on file get a View button. Controlled via
// `value` / `onChange` (the ticked picker keys).
//
// Used in two places with the SAME table:
//   • EPC edit chatbot — the partner ticks what to change.
//   • Admin "Message to EPC" window — Capital Craft ticks which rows to OPEN for
//     the EPC to edit (the grant). Keys match lib/loan-form + the submit route.

import { getToken } from "@/lib/auth";
import { getDocumentUrl } from "@/lib/storage";
import type { LoanForm, LoanDocRow } from "@/lib/loan-form";
import { DOC_CATEGORY } from "@/lib/loan-doc-checklist";

const SYS_LABEL: Record<string, string> = { on_grid: "On-Grid", off_grid: "Off-Grid", hybrid: "Hybrid" };
const USE_LABEL: Record<string, string> = { residential: "Residential", commercial: "Commercial" };

export type EditItem = { key: string; label: string; doc?: boolean; on?: boolean; path?: string | null; rowId?: string; value?: string };

// The grouped rows for an application, shared so callers can reason about which
// keys exist (e.g. select-all in the admin window).
export function editGroups(form: LoanForm, docRows: LoanDocRow[]): { title: string; items: EditItem[] }[] {
  const has = (k: string) => !!(form[k] && String(form[k]).trim());
  const panRow = docRows.find((d) => d.category === "borrower_pan");
  const hasCoapp = has("coapp_aadhaar_front_path") || has("coapp_pan_path") || has("coapp_pan") || has("coapp_aadhaar_number") || has("coapp_mobile");
  // A document is on file as its *_path column OR a user_application_docs row
  // (same rule as lib/loan-doc-checklist) — View opens whichever exists.
  const doc = (key: string, label: string, col: string, cat: string): EditItem => {
    const r = docRows.find((d) => d.category === cat);
    return { key, label, doc: true, on: has(col) || !!r, path: form[col] || undefined, rowId: r?.id };
  };
  return [
    { title: "Documents", items: [
      // Front and back separately — each can be viewed and opened on its own.
      { key: "aadhaar_front", label: "Aadhaar — front", doc: true, on: has("aadhaar_front_path"), path: form.aadhaar_front_path },
      { key: "aadhaar_back", label: "Aadhaar — back", doc: true, on: has("aadhaar_back_path"), path: form.aadhaar_back_path },
      { key: "pan", label: "PAN card", doc: true, on: has("borrower_pan") || !!panRow, rowId: panRow?.id, path: panRow?.storage_path ?? undefined },
      doc("ebill", "Electricity bill", "ebill_path", DOC_CATEGORY.ebill),
      doc("rooftop", "Rooftop photo", "rooftop_photo_path", DOC_CATEGORY.rooftop),
      doc("selfie", "Applicant photo", "customer_photo_path", DOC_CATEGORY.photo),
      doc("bank", "Bank statement", "bank_statement_path", DOC_CATEGORY.bank),
    ] },
    ...(hasCoapp ? [{ title: "Co-applicant", items: [
      { key: "coapp_aadhaar_front", label: "Co-applicant Aadhaar — front", doc: true, on: has("coapp_aadhaar_front_path"), path: form.coapp_aadhaar_front_path },
      { key: "coapp_aadhaar_back", label: "Co-applicant Aadhaar — back", doc: true, on: has("coapp_aadhaar_back_path"), path: form.coapp_aadhaar_back_path },
      { key: "coapp_pan", label: "Co-applicant PAN", doc: true, on: has("coapp_pan_path") || has("coapp_pan"), path: form.coapp_pan_path },
      { key: "coapp_mobile", label: "Co-applicant mobile", value: form.coapp_mobile || "—" },
      { key: "coapp_email", label: "Co-applicant email", value: form.coapp_email || "—" },
    ] }] : []),
    { title: "Applicant details", items: [
      { key: "borrower_email", label: "Email", value: form.borrower_email || "—" },
      { key: "install_pincode", label: "Installation pincode", value: form.install_pincode || "—" },
      { key: "system_type", label: "System type", value: SYS_LABEL[form.system_type] || "—" },
      { key: "plant_use_type", label: "Property use", value: USE_LABEL[form.plant_use_type] || "—" },
    ] },
    { title: "Quotation & loan", items: [
      doc("quotation", "Quotation document", "proforma_invoice_path", DOC_CATEGORY.quotation),
      { key: "loan_amount", label: "Loan amount", value: form.loan_amount_required ? `₹${Number(form.loan_amount_required).toLocaleString("en-IN")}` : "—" },
      { key: "loan_config", label: "Loan configuration", value: form.selected_tenure_years ? `${form.selected_tenure_years} yr tenure` : "—" },
    ] },
  ];
}

export default function EditTable({ appId, form, docRows, value, onChange, accent = "#1e3a8a" }: {
  appId: string;
  form: LoanForm;
  docRows: LoanDocRow[];
  value: string[];
  onChange: (keys: string[]) => void;
  accent?: string;
}) {
  const sel = new Set(value);
  const toggle = (k: string) => { const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); onChange([...n]); };
  const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });

  async function view(path?: string | null, rowId?: string) {
    try {
      if (path) {
        const res = await fetch(`/api/admin/loan-app/${appId}/sign-doc`, {
          method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ path }),
        });
        const j = await res.json().catch(() => ({}));
        if (j?.ok && j.url) { window.open(j.url as string, "_blank", "noopener"); return; }
      }
      if (rowId) { const url = await getDocumentUrl(rowId); if (url) { window.open(url, "_blank", "noopener"); return; } }
      alert("Couldn't open the document.");
    } catch { alert("Couldn't open the document."); }
  }

  const groups = editGroups(form, docRows);
  return (
    <div className="rounded-xl border border-line bg-white overflow-hidden">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="px-3 py-2 bg-[#eef3fc] border-y border-[#dbe4f6] text-[11px] font-semibold text-[#14235c]">{g.title}</div>
          {g.items.map((it) => {
            const checked = sel.has(it.key);
            return (
              <div key={it.key} onClick={() => toggle(it.key)} className="flex items-center gap-2.5 px-3 py-2 border-b border-line/70 last:border-b-0 cursor-pointer hover:bg-[#f7f9fe]">
                <input type="checkbox" checked={checked} onChange={() => toggle(it.key)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 cursor-pointer shrink-0" style={{ accentColor: accent }} aria-label={it.label} />
                <span className="flex-1 text-[12.5px] text-text leading-snug">{it.label}</span>
                {it.doc ? (
                  it.on ? (
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-semibold text-[#178a5c]">On file</span>
                      <button onClick={(e) => { e.stopPropagation(); void view(it.path, it.rowId); }} className="text-[11px] font-semibold hover:underline" style={{ color: accent }}>View</button>
                    </span>
                  ) : <span className="text-[11px] font-semibold text-amber-600 shrink-0">Missing</span>
                ) : (
                  <span className="text-[11.5px] text-text-muted text-right max-w-[46%] truncate shrink-0">{it.value}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
