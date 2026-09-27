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

const SYS_LABEL: Record<string, string> = { on_grid: "On-Grid", off_grid: "Off-Grid", hybrid: "Hybrid" };
const USE_LABEL: Record<string, string> = { residential: "Residential", commercial: "Commercial" };

export type EditItem = { key: string; label: string; doc?: boolean; on?: boolean; path?: string | null; rowId?: string; value?: string };

// The grouped rows for an application, shared so callers can reason about which
// keys exist (e.g. select-all in the admin window).
export function editGroups(form: LoanForm, docRows: LoanDocRow[]): { title: string; items: EditItem[] }[] {
  const has = (k: string) => !!(form[k] && String(form[k]).trim());
  const panRow = docRows.find((d) => d.category === "borrower_pan");
  const hasCoapp = has("coapp_aadhaar_front_path") || has("coapp_pan_path") || has("coapp_pan") || has("coapp_aadhaar_number") || has("coapp_mobile");
  return [
    { title: "Documents", items: [
      { key: "aadhaar", label: "Aadhaar (front & back)", doc: true, on: has("aadhaar_front_path"), path: form.aadhaar_front_path },
      { key: "pan", label: "PAN card", doc: true, on: has("borrower_pan") || !!panRow, rowId: panRow?.id, path: panRow?.storage_path ?? undefined },
      { key: "ebill", label: "Electricity bill", doc: true, on: has("ebill_path"), path: form.ebill_path },
      { key: "rooftop", label: "Rooftop photo", doc: true, on: has("rooftop_photo_path"), path: form.rooftop_photo_path },
      { key: "selfie", label: "Applicant photo", doc: true, on: has("customer_photo_path"), path: form.customer_photo_path },
      { key: "bank", label: "Bank statement", doc: true, on: has("bank_statement_path"), path: form.bank_statement_path },
    ] },
    ...(hasCoapp ? [{ title: "Co-applicant", items: [
      { key: "coapp_aadhaar", label: "Co-applicant Aadhaar", doc: true, on: has("coapp_aadhaar_front_path"), path: form.coapp_aadhaar_front_path },
      { key: "coapp_pan", label: "Co-applicant PAN", doc: true, on: has("coapp_pan_path") || has("coapp_pan"), path: form.coapp_pan_path },
      { key: "coapp_mobile", label: "Co-applicant mobile", value: form.coapp_mobile || "—" },
    ] }] : []),
    { title: "Applicant details", items: [
      { key: "borrower_email", label: "Email", value: form.borrower_email || "—" },
      { key: "install_pincode", label: "Installation pincode", value: form.install_pincode || "—" },
      { key: "system_type", label: "System type", value: SYS_LABEL[form.system_type] || "—" },
      { key: "plant_use_type", label: "Property use", value: USE_LABEL[form.plant_use_type] || "—" },
    ] },
    { title: "Quotation & loan", items: [
      { key: "quotation", label: "Quotation document", doc: true, on: has("proforma_invoice_path"), path: form.proforma_invoice_path },
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
