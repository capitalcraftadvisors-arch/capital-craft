"use client";

// Intake chat — the edit "what to edit" picker: the grouped rows (documents re-read, details re-asked) and their tick list.

import type { Dispatch, SetStateAction } from "react";
import type { Form } from "@/components/chat/types";
import { hasCoapp } from "./form-rules";
import type { DocUnit } from "./doc-slots";
import { SYSTEM_LABEL, PLANT_USE_LABEL } from "@/lib/loan-labels";

// ── Edit table (grouped "what to edit" picker — mirrors the EPC portal chatbot) ──
// Each row maps to the turn(s) re-asked when it's ticked; document rows also carry
// the doc_table `units` to re-open. The co-applicant group shows only when the
// file has a co-applicant. Documents re-upload (re-OCR); details edit inline.
type EditRow = { key: string; label: string; doc?: boolean; on?: boolean; value?: string; turns: string[]; units?: DocUnit[] };
type EditGroup = { title: string; rows: EditRow[] };
export function editTableGroups(f: Form): EditGroup[] {
  const fv = (k: string) => (f[k] || "").trim();
  const on = (k: string) => !!fv(k);
  const rupee = (k: string) => (fv(k) ? "₹" + Number(f[k]).toLocaleString("en-IN") : "");
  const groups: EditGroup[] = [
    { title: "Documents", rows: [
      { key: "aadhaar", label: "Aadhaar (front & back)", doc: true, on: on("aadhaar_front_path"), turns: ["doc_table"], units: ["aadhaar"] },
      { key: "pan", label: "PAN card", doc: true, on: on("borrower_pan"), turns: ["doc_table"], units: ["applicant_pan"] },
      { key: "ebill", label: "Electricity bill", doc: true, on: on("ebill_path"), turns: ["doc_table"], units: ["ebill"] },
      { key: "rooftop", label: "Rooftop photo", doc: true, on: on("rooftop_photo_path"), turns: ["doc_table"], units: ["rooftop"] },
      { key: "selfie", label: "Applicant photo", doc: true, on: on("customer_photo_path"), turns: ["doc_table"], units: ["selfie"] },
      { key: "bank", label: "Bank statement", doc: true, on: on("bank_statement_path"), turns: ["bank"] },
      { key: "quotation", label: "Quotation / proforma invoice", doc: true, on: on("proforma_invoice_path"), turns: ["quotation"] },
      { key: "additional", label: "Additional documents", doc: true, on: false, turns: ["additional_docs"] },
    ] },
    { title: "Applicant details", rows: [
      { key: "name", label: "Name & father's name", value: fv("borrower_name") || "—", turns: ["doc_table"], units: ["applicant_pan"] },
      { key: "mobile", label: "Mobile", value: fv("borrower_mobile") || "—", turns: ["borrower_mobile"] },
      { key: "email", label: "Email", value: fv("borrower_email") || "—", turns: ["edit_borrower_email"] },
      { key: "aadhaar_fields", label: "DOB · gender · address", value: "from Aadhaar", turns: ["doc_table"], units: ["aadhaar"] },
      { key: "pincode", label: "Installation pincode", value: fv("install_pincode") || "—", turns: ["install_pincode"] },
      { key: "system_type", label: "System type", value: SYSTEM_LABEL[f.system_type] || "—", turns: ["edit_system_type"] },
      { key: "use", label: "Property use", value: PLANT_USE_LABEL[f.plant_use_type] || "—", turns: ["plant_use_type"] },
      { key: "lead_owner", label: "Lead owner", value: fv("lead_owner_name") || "—", turns: ["lead_owner_name"] },
      { key: "coapp", label: "Co-applicant", value: hasCoapp(f) ? "Yes" : f.coapp_needed === "no" ? "No" : "—", turns: ["coapp_needed"] },
    ] },
  ];
  if (hasCoapp(f)) groups.push({ title: "Co-applicant", rows: [
    { key: "coapp_aadhaar", label: "Co-applicant Aadhaar", doc: true, on: on("coapp_aadhaar_front_path"), turns: ["doc_table"], units: ["coapp_aadhaar"] },
    { key: "coapp_pan", label: "Co-applicant PAN", doc: true, on: on("coapp_pan_path") || on("coapp_pan"), turns: ["doc_table"], units: ["coapp_pan"] },
    { key: "coapp_relation", label: "Relation", value: fv("coapp_relation") || "—", turns: ["coapp_relation"] },
    { key: "coapp_mobile", label: "Mobile", value: fv("coapp_mobile") || "—", turns: ["coapp_mobile"] },
    { key: "coapp_email", label: "Email", value: fv("coapp_email") || "—", turns: ["coapp_email"] },
  ] });
  groups.push({ title: "Project & bill", rows: [
    { key: "project", label: "Project size & total cost", value: [fv("project_size") && fv("project_size") + " " + (f.project_size_unit || "kw"), rupee("total_project_cost")].filter(Boolean).join(" · ") || "—", turns: ["quotation"] },
    { key: "bill", label: "Monthly bill · DISCOM", value: [rupee("monthly_bill_amount"), fv("discom_name")].filter(Boolean).join(" · ") || "—", turns: ["doc_table"], units: ["ebill"] },
  ] });
  groups.push({ title: "Employment & bank", rows: [
    { key: "employment", label: "Employment & profession", value: [f.employment_type, f.profession].filter(Boolean).join(" · ") || "—", turns: ["employment_type", "profession"] },
    { key: "org_income", label: "Organization & annual income", value: [f.organization_name, rupee("annual_income")].filter(Boolean).join(" · ") || "—", turns: ["organization_name", "annual_income"] },
    { key: "bank_details", label: "Bank a/c · IFSC · name · type", value: [f.bank_name, f.bank_ifsc].filter(Boolean).join(" · ") || "—", turns: ["bank"] },
  ] });
  groups.push({ title: "Loan configuration", rows: [
    { key: "loan_amount", label: "Loan amount", value: rupee("loan_amount_required") || "—", turns: ["loan_amount"] },
    { key: "loanconfig", label: "Subsidy · tenure · EMI", value: fv("selected_tenure_years") ? f.selected_tenure_years + " yr" : "—", turns: ["loanconfig"] },
  ] });
  return groups;
}

// The tick list shown in the dock — tick documents to re-upload (re-read) or details to edit, then "Edit selected".
export function EditPickList({ form, pickSel, setPickSel, onEditSelected, onBack }: {
  form: Form; pickSel: string[]; setPickSel: Dispatch<SetStateAction<string[]>>; onEditSelected: () => void; onBack: () => void;
}) {
  const groups = editTableGroups(form);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] text-text-muted">{pickSel.length} selected · tick documents to re-upload (re-read) or details to edit</div>
      <div className="rounded-xl border border-line bg-white overflow-hidden max-h-[46vh] overflow-y-auto">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-3 py-1.5 bg-[#eef7f2] border-y border-[#d7ebe1] text-[11px] font-semibold text-cc-ink">{g.title}</div>
            {g.rows.map((r) => {
              const on = pickSel.includes(r.key);
              return (
                <div key={r.key} onClick={() => setPickSel((s) => (on ? s.filter((x) => x !== r.key) : [...s, r.key]))}
                  className="flex items-center gap-2.5 px-3 py-2 border-b border-line/70 last:border-b-0 cursor-pointer hover:bg-cc-mist">
                  <input type="checkbox" checked={on} onChange={() => {}} onClick={(e) => e.stopPropagation()} className="w-4 h-4 accent-cc-green cursor-pointer shrink-0" aria-label={r.label} />
                  <span className="flex-1 text-[12.5px] text-text leading-snug">{r.label}</span>
                  {r.doc
                    ? (r.on ? <span className="text-[11px] font-semibold text-cc-green shrink-0">On file</span> : <span className="text-[11px] font-semibold text-amber-600 shrink-0">Missing</span>)
                    : <span className="text-[11.5px] text-text-muted text-right max-w-[46%] truncate shrink-0">{r.value}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-1">
        <button onClick={onEditSelected} disabled={!pickSel.length} className="px-4 py-2.5 rounded-xl bg-cc-green text-white text-[14px] font-semibold disabled:opacity-50 hover:bg-cc-green-hover">Edit selected{pickSel.length ? ` (${pickSel.length})` : ""} →</button>
        <button onClick={onBack} className="px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid">Back</button>
      </div>
    </div>
  );
}
