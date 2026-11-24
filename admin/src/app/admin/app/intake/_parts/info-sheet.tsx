"use client";

// Intake chat — the pasted info sheet: the local parser (no AI), the rows it fills, and the confirm card.

import { amountInput } from "@/lib/money";
import { LOAN_INTAKE_THEME as THEME } from "@/components/chat/theme";
import type { Form } from "@/components/chat/types";
import { EditableRows, ReadCardFrame } from "@/components/chat/ReadCards";
import { PLANT_USE_LABEL, SYSTEM_LABEL } from "@/lib/loan-labels";

// ── Info-sheet paste parser (local, deterministic — no AI) ───────────────────
// The RM pastes a labeled sheet; we split each line on the FIRST ":", normalize
// the label, clean the value, and map it to a Form field. Everything the sheet
// can carry (co-applicant included) is handled; the EPC is chosen separately and
// is never overwritten (the merchant name is kept display-only).
const normLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// Clean a text value: strip a leading dash, a trailing "/-", and surrounding space.
function cleanText(raw: string): string {
  return raw.replace(/^\s*[-–—]\s*/, "").replace(/\s*\/-\s*$/, "").trim();
}
// An amount (amounts / subsidy): drop commas, "/-", "Rs", "₹", spaces; paise kept.
export function amountText(raw: string): string {
  return amountInput(cleanText(raw).replace(/rs\.?/gi, "").replace(/[,₹\s/-]/g, ""));
}
// The leading number in a value ("3KW" → 3, "5 YEAR" → 5, "5year" → 5).
function leadingNumber(raw: string): string {
  const m = cleanText(raw).match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : "";
}
// Last 10 digits of a phone value.
function last10(raw: string): string {
  const d = cleanText(raw).replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}
function normSystemType(raw: string): string {
  const s = cleanText(raw).toLowerCase();
  if (s.includes("off")) return "off_grid";
  if (s.includes("hybrid")) return "hybrid";
  if (s.includes("on")) return "on_grid";
  return "";
}

// A value that IS a use word: "house" → residential, "shop" → commercial. An
// address ("Shop no 3, near Power House") is "" — it stays the place.
function normUseType(raw: string): string {
  const s = cleanText(raw).toLowerCase().replace(/[^a-z]/g, "");
  if (/^(house|home|ghar|residential|residence|flat|apartment|bungalow|villa|society)$/.test(s)) return "residential";
  if (/^(shop|office|factory|commercial|industrial|industry|showroom|godown|warehouse)$/.test(s)) return "commercial";
  return "";
}
// The subsidy case from "yes" / "no" (or "subsidy" / "non subsidy"); "" otherwise.
function subsidyCase(raw: string): string {
  const s = cleanText(raw).toLowerCase();
  if (/^(non[\s-]?subsidy|no|n)\b/.test(s)) return "non_subsidy";
  if (/^(yes|y|subsidy)\b/.test(s)) return "subsidy";
  return "";
}
// A tenure the loan configuration offers, in years (1–5): "5 year" → 5, "60 months" → 5.
function tenureYears(raw: string): string {
  const n = Number(leadingNumber(raw));
  if (!n) return "";
  const years = Math.round(/mon|mth/i.test(raw) ? n / 12 : n);
  return years >= 1 && years <= 5 ? String(years) : "";
}

export function parseInfoSheet(text: string): Partial<Form> {
  const out: Form = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const ci = line.indexOf(":");
    if (ci < 0) continue;
    const nl = normLabel(line.slice(0, ci));
    if (!nl) continue;
    const rawVal = line.slice(ci + 1);
    const val = cleanText(rawVal);
    const isCo = nl.includes("coapp") || nl.includes("coapplicant") || (nl.startsWith("co") && nl.includes("app"));

    // Co-applicant fields (checked first so "co-app name" never matches applicant).
    if (isCo && nl.includes("name")) { if (val) { out.coapp_name = val; out._has_coapp = "1"; } continue; }
    if (isCo && (nl.includes("mob") || nl.includes("phone") || nl.includes("contact"))) { if (val) out.coapp_mobile = last10(rawVal); continue; }
    if (isCo && nl.includes("email")) { if (val) out.coapp_email = val; continue; }
    // Employer / business, and the display-only merchant name (never the EPC).
    if (nl.includes("employer") || nl.includes("business")) { if (val) out.organization_name = val; continue; }
    if (nl.includes("merchant")) { if (val) out._merchant_name = val; continue; }
    // Applicant contact
    if (!isCo && (nl.includes("mob") || nl.includes("phone") || nl.includes("contact"))) { if (val) out.borrower_mobile = last10(rawVal); continue; }
    if (!isCo && nl.includes("email")) { if (val) out.borrower_email = val; continue; }
    if (!isCo && nl.includes("name") && (nl.includes("app") || nl.includes("borrower") || nl.includes("customer"))) { if (val) out.borrower_name = val; continue; }
    // Loan / project money
    if (nl.includes("project") && nl.includes("cost")) { const d = amountText(rawVal); if (d) out.total_project_cost = d; continue; }
    if (nl.includes("tenure")) { const y = tenureYears(rawVal); if (y) out.selected_tenure_years = y; continue; }
    if (nl.includes("loan") && nl.includes("amount")) { const d = amountText(rawVal); if (d) out.loan_amount_required = d; continue; }
    // Subsidy: "yes" / "no" (the loan configuration's subsidy case) and/or an amount ("Yes 78,000/-").
    if (nl.includes("subsidy")) {
      const sc = subsidyCase(rawVal);
      if (sc) out._subsidy_case = sc;
      const d = amountText(rawVal);
      if (sc !== "non_subsidy" && /\d/.test(d)) out.central_subsidy = d;
      continue;
    }
    // System / capacity / place
    if (nl.includes("capacity")) { const n = leadingNumber(rawVal); if (n) { out.project_size = n; out.project_size_unit = "kw"; } continue; }
    if (nl.includes("grid")) { const st = normSystemType(rawVal); if (st) out.system_type = st; continue; }
    // Place of installation: "house" / "shop" is the property use; anything else is the place.
    if ((nl.includes("place") && nl.includes("install")) || nl.includes("installation") || nl.includes("location")) {
      const use = normUseType(rawVal);
      if (use) out.plant_use_type = use; else if (val) out.install_city = val;
      continue;
    }
  }
  return out;
}

// The order + labels the parsed info sheet is shown in on the confirm card.
export const SHEET_ROWS: { field: string; label: string; render?: (v: string) => string }[] = [
  { field: "borrower_name", label: "Applicant name" },
  { field: "borrower_mobile", label: "Applicant mobile" },
  { field: "borrower_email", label: "Applicant email" },
  { field: "coapp_name", label: "Co-applicant name" },
  { field: "coapp_mobile", label: "Co-applicant mobile" },
  { field: "coapp_email", label: "Co-applicant email" },
  { field: "organization_name", label: "Employer / business" },
  { field: "_merchant_name", label: "Merchant (for reference)" },
  { field: "total_project_cost", label: "Project cost", render: (v) => `₹${Number(v).toLocaleString("en-IN")}` },
  { field: "loan_amount_required", label: "Loan amount", render: (v) => `₹${Number(v).toLocaleString("en-IN")}` },
  { field: "central_subsidy", label: "Subsidy", render: (v) => `₹${Number(v).toLocaleString("en-IN")}` },
  { field: "_subsidy_case", label: "Subsidy", render: (v) => (v === "subsidy" ? "Yes" : v === "non_subsidy" ? "No" : v) },
  { field: "selected_tenure_years", label: "Loan tenure", render: (v) => `${v} year${v === "1" ? "" : "s"}` },
  { field: "project_size", label: "Capacity", render: (v) => `${v} kW` },
  { field: "system_type", label: "System", render: (v) => SYSTEM_LABEL[v] || v },
  { field: "install_city", label: "Place of installation" },
  { field: "plant_use_type", label: "Property use", render: (v) => PLANT_USE_LABEL[v] || v },
];
// The sheet's amount rows — a hand edit is cleaned the same way the parser cleans them.
export const SHEET_AMOUNT_FIELDS = new Set(["total_project_cost", "loan_amount_required", "central_subsidy"]);

// A hand edit on the confirm card, cleaned like the parser cleans the sheet — the
// fixed-choice rows only take a value the profile can store (a wrong one would
// make every later save of the chat fail).
const SHEET_CHOICE_EDITS: Record<string, { clean: (v: string) => string; error: string }> = {
  selected_tenure_years: { clean: tenureYears, error: "Enter a tenure of 1 to 5 years." },
  _subsidy_case: { clean: subsidyCase, error: "Enter Yes or No." },
  plant_use_type: { clean: normUseType, error: "Enter Residential or Commercial." },
  system_type: { clean: normSystemType, error: "Enter On-Grid, Off-Grid or Hybrid." },
};
export function cleanSheetEdit(field: string, value: string): { value: string } | { error: string } {
  if (SHEET_AMOUNT_FIELDS.has(field)) return { value: amountText(value) }; // "1,80,000" → "180000"
  const rule = SHEET_CHOICE_EDITS[field];
  if (!rule) return { value };
  const v = rule.clean(value);
  return v ? { value: v } : { error: rule.error };
}

// Info-sheet confirm card — the parsed values, every one editable, shown before
// they're written to the profile. Values are stored raw; friendly labels/format
// (₹, "years", "kW", "On-Grid") are display-only.
export function SheetConfirmCard({ parsed, onEdit, onConfirm, onSkip }: {
  parsed: Form; onEdit: (field: string, value: string) => void; onConfirm: () => void; onSkip: () => void;
}) {
  // Every row shown has a value (empty ones are left out), so none is "not found".
  const rows = SHEET_ROWS.filter((r) => parsed[r.field] != null && String(parsed[r.field]).trim() !== "").map((r) => {
    const raw = String(parsed[r.field]);
    return { label: r.label, value: raw, ok: true, field: r.field, display: r.render ? r.render(raw) : raw };
  });
  return (
    <ReadCardFrame theme={THEME} icon="📝" title="Read from the info sheet — check before continuing" width="max-w-[92%]">
      <div className="p-3.5 flex flex-col gap-2">
        <EditableRows theme={THEME} rows={rows} onSave={onEdit} />
        <p className="text-[11px] text-text-muted leading-snug mt-0.5">The EPC partner stays as you chose it — the merchant name is kept only for reference.</p>
        <div className="flex flex-wrap gap-2 mt-1">
          <button onClick={onConfirm} className="px-3.5 py-1.5 rounded-lg bg-cc-green text-white text-[12.5px] font-semibold hover:bg-cc-green-hover">Confirm & continue →</button>
          <button onClick={onSkip} className="px-3 py-1.5 rounded-lg border border-line text-[12.5px] text-text-mid hover:bg-bg-soft">Skip</button>
        </div>
      </div>
    </ReadCardFrame>
  );
}
