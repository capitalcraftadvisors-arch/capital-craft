"use client";

// Admin EPC page · the Members section editor.

import { useEffect, useState } from "react";
import AdminDocSlot from "@/components/AdminDocSlot";
import { authHeaders } from "@/lib/auth";
import type { Stakeholder } from "@/lib/epc-stakeholders";
import { FIELD, SaveCancel, useSectionSave } from "./editor-kit";

// ── Members editor (edit-only per spec; no add/delete) ────────────────────
// Minimum stakeholders per business type (LLP/Partnership = 2 partners,
// Pvt Ltd = 2 directors). Enforced on save — existing submitted EPCs are
// only affected when an admin actively re-saves this section.
const MEMBER_RULES: Record<string, { min: number; max: number; role: string; defaultDesignation: string }> = {
  proprietorship: { min: 1, max: 1,        role: "proprietor", defaultDesignation: "Proprietor" },
  pvt_ltd:        { min: 2, max: Infinity, role: "director",   defaultDesignation: "Director" },
  partnership:    { min: 2, max: Infinity, role: "partner",    defaultDesignation: "Partner" },
  llp:            { min: 2, max: Infinity, role: "partner",    defaultDesignation: "Partner" },
};
function memberRule(bt: string | null) {
  return MEMBER_RULES[bt ?? ""] ?? { min: 1, max: Infinity, role: "member", defaultDesignation: "" };
}

export default function MembersEditor({
  value, onSave, businessId, businessType,
}: {
  value: Stakeholder[];
  onSave: (next: Stakeholder[]) => Promise<void>;
  businessId: string;
  businessType: string | null;
}) {
  const { editing, setEditing, saving, error, setError, commit } = useSectionSave();
  const [draft, setDraft] = useState<Stakeholder[]>(value);

  useEffect(() => { setDraft(value); }, [value]);

  const rule = memberRule(businessType);
  const blankMember = (): Stakeholder => ({ id: crypto.randomUUID(), name: "", designation: rule.defaultDesignation, mobile: "", email: "", father_name: "", dob: "", aadhaar_number: "", aadhaar_address: "" });
  function setMember(i: number, key: keyof Stakeholder, v: string) {
    const next = [...draft]; next[i] = { ...next[i], [key]: v };
    setDraft(next);
  }

  // Auto-fill a stakeholder's KYC by reading their uploaded PAN / Aadhaar with
  // Gemini. Fills only EMPTY fields (never overwrites what a human typed), then
  // persists the stakeholders JSONB. Fully non-fatal — a miss just leaves the
  // fields blank for manual entry.
  async function ocrFill(s: Stakeholder, kind: "pan" | "aadhaar_front" | "aadhaar_back", file: File) {
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch(`/api/admin/epc/${businessId}/extract-stakeholder`, {
        method: "POST", headers: authHeaders(), body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok || !j.fields) return;
      const f = j.fields as Record<string, string>;
      const cur = value.find((x) => x.id === s.id) ?? s;
      const patch: Partial<Stakeholder> = {};
      if (f.name && !cur.name) patch.name = f.name;
      if (f.father_name && !cur.father_name) patch.father_name = f.father_name;
      if (f.dob && !cur.dob) patch.dob = f.dob;
      if (f.aadhaar_number && !cur.aadhaar_number) patch.aadhaar_number = f.aadhaar_number;
      if (f.address && !cur.aadhaar_address) patch.aadhaar_address = f.address;
      if (Object.keys(patch).length === 0) return;
      await onSave(value.map((x) => (x.id === s.id ? { ...x, ...patch } : x)));
    } catch { /* non-fatal */ }
  }

  async function save() {
    // Minimum-count rule (LLP/Partnership = 2 partners, Pvt Ltd = 2 directors).
    if (draft.length < rule.min) {
      setError(`Please add at least ${rule.min} ${rule.role}${rule.min > 1 ? "s" : ""}.`);
      return;
    }
    await commit(() => onSave(draft));
  }

  if (value.length === 0 && !editing) {
    return (
      <div>
        <p className="text-[13px] text-text-muted mb-2">No members.</p>
        <button
          type="button"
          onClick={() => {
            setDraft([blankMember()]);
            setEditing(true);
          }}
          className="text-[12px] text-blue hover:underline"
        >
          + Add members
        </button>
      </div>
    );
  }

  if (!editing) {
    return (
      <div>
        {value.map((s) => (
          <div key={s.id} className="py-3 border-t border-line first:border-0 first:pt-0">
            <p className="text-[14px] font-semibold">
              {s.name} <span className="text-text-muted font-normal">— {s.designation}</span>
            </p>
            <p className="text-[12px] text-text-muted mt-0.5">
              {s.mobile ? `+91 ${s.mobile}` : "—"}
              {s.email ? ` · ${s.email}` : ""}
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mt-2">
              <AdminDocSlot businessId={businessId} stakeholderId={s.id} category="stakeholder_pan"            label="Member PAN card"            onUploadedFile={(file) => void ocrFill(s, "pan", file)} />
              <AdminDocSlot businessId={businessId} stakeholderId={s.id} category="stakeholder_aadhaar_front"  label="Member Aadhaar card (front)" onUploadedFile={(file) => void ocrFill(s, "aadhaar_front", file)} />
              <AdminDocSlot businessId={businessId} stakeholderId={s.id} category="stakeholder_aadhaar_back"   label="Member Aadhaar card (back)"  onUploadedFile={(file) => void ocrFill(s, "aadhaar_back", file)} />
              {/* Legacy category: shows only if a pre-split Aadhaar doc exists
                  for this member (40 legacy EPCs). Never renders an upload
                  affordance — admin can View / Replace / Remove only. */}
              <AdminDocSlot
                businessId={businessId}
                stakeholderId={s.id}
                category="stakeholder_aadhaar"
                label="Member Aadhaar card (legacy)"
                hideWhenEmpty
              />
            </div>
          </div>
        ))}
        <div className="mt-3">
          <button
            type="button"
            onClick={() => { setDraft(value); setEditing(true); }}
            className="text-[12px] text-blue hover:underline"
          >
            Edit members
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {draft.map((s, i) => (
        <div key={s.id} className="border border-line rounded-input p-3 bg-bg-soft">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] text-text-muted">{rule.role.charAt(0).toUpperCase() + rule.role.slice(1)} {i + 1}</p>
            <button
              type="button"
              onClick={() => setDraft(draft.filter((_, idx) => idx !== i))}
              className="text-[11px] text-red-500 hover:underline"
            >
              Remove
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={FIELD}
              placeholder="Name"
              value={s.name}
              onChange={(e) => setMember(i, "name", e.target.value)}
            />
            <input
              className={FIELD}
              placeholder="Designation"
              value={s.designation}
              onChange={(e) => setMember(i, "designation", e.target.value)}
            />
            <input
              className={FIELD}
              placeholder="Mobile (10 digits)"
              inputMode="numeric"
              maxLength={10}
              value={s.mobile}
              onChange={(e) => setMember(i, "mobile", e.target.value.replace(/\D/g, ""))}
            />
            <input
              className={FIELD}
              placeholder="Email (optional)"
              type="email"
              value={s.email}
              onChange={(e) => setMember(i, "email", e.target.value)}
            />
            {/* Father's Name / DOB / Address are captured in onboarding and shown
                on the profile — not editable here. Aadhaar No. stays editable. */}
            <input
              className={FIELD}
              placeholder="Aadhaar No. (12 digits)"
              inputMode="numeric"
              maxLength={12}
              value={s.aadhaar_number}
              onChange={(e) => setMember(i, "aadhaar_number", e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>
      ))}
      {draft.length < rule.max && (
        <button
          type="button"
          onClick={() =>
            setDraft([...draft, blankMember()])
          }
          className="text-[12px] text-blue hover:underline"
        >
          + Add {rule.role}
        </button>
      )}
      {rule.min > 1 && (
        <p className="text-[11px] text-text-muted">Minimum {rule.min} {rule.role}s required.</p>
      )}
      <SaveCancel label="Save members" saving={saving} error={error} onSave={save} onCancel={() => { setEditing(false); setError(null); }} />
    </div>
  );
}
