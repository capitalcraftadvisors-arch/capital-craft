"use client";

// Stakeholder profile details (lib/stakeholders field groups): one card per
// group — label / value rows, or inputs while editing. Dates are kept ISO
// (YYYY-MM-DD) and shown DD/MM/YYYY.

import { KV, Section } from "@/components/view/ViewKit";
import DateField from "@/components/ui/DateField";
import { fmtDate } from "@/lib/dates";
import type { Details, FieldGroup, FieldSpec } from "@/lib/stakeholders";

export const inputCls = "w-full border border-line rounded-input px-3 py-2 text-[14px] bg-white focus:outline-none focus:border-[#178a5c]";

function shown(f: FieldSpec, v: string | undefined): string | null {
  if (!v) return null;
  return f.type === "date" ? fmtDate(v) : v;
}

export function FieldInput({ f, value, onChange }: { f: FieldSpec; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block mb-1 text-[12.5px] text-[#5a8a76]">{f.label}</span>
      {f.type === "date" ? (
        <DateField className={inputCls} value={value} onChange={onChange} ariaLabel={f.label} />
      ) : f.type === "textarea" ? (
        <textarea className={`${inputCls} min-h-[72px]`} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={inputCls} type={f.type === "email" ? "email" : f.type === "tel" ? "tel" : f.type === "url" ? "url" : "text"}
          value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export default function StakeholderDetails({ groups, values, editing, onChange }: {
  groups: FieldGroup[];
  values: Details;
  editing: boolean;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 items-start">
      {groups.map((g) => (
        <Section key={g.title} card white title={g.title}>
          {editing ? (
            <div className="space-y-3">
              {g.fields.map((f) => <FieldInput key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => onChange(f.key, v)} />)}
            </div>
          ) : g.fields.map((f) => (
            <KV key={f.key} k={f.label} v={shown(f, values[f.key])} wrap={f.type === "textarea"}
              copy={f.type === "email" || f.type === "tel" ? values[f.key] : undefined} />
          ))}
        </Section>
      ))}
    </div>
  );
}
