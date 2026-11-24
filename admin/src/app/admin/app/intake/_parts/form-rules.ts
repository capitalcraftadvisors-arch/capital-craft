// Intake chat — small rules on the chat's form: co-applicant present, answers that reset others, a read-row builder, system kW.

import type { Fetched, Form } from "@/components/chat/types";

// A co-applicant is present when the name-check / paste set the flag, OR the RM
// answered the explicit "co-applicant required?" question with Yes. Either one
// reveals the co-applicant document slots in the table and its detail turns.
export const hasCoapp = (f: Form) => f._has_coapp === "1" || f.coapp_needed === "yes";
// The co-applicant Yes / No answer is the decision (a "No" also drops one read earlier).
export const coappDecision = (turnId: string | undefined, value: string): Form =>
  (turnId === "coapp_needed" && value ? { _has_coapp: value === "yes" ? "1" : "" } : {});
// Changing the employment type clears a profession picked from the other list.
export const employmentReset = (turnId: string | undefined, value: string, f: Form): Form =>
  (turnId === "employment_type" && value !== (f.employment_type || "") ? { profession: "", profession_other: "" } : {});

// Build one editable "read from the document" row from a form value.
export function frow(label: string, value: string | undefined, field: string): Fetched {
  const v = (value ?? "").trim();
  return { label, value: v, ok: !!v, field };
}

// System size in kW (a size in MW × 1000); null when not known.
export function kwOf(f: Form): number | null {
  const s = Number(f.project_size);
  if (!s) return null;
  return f.project_size_unit === "mw" ? s * 1000 : s;
}
