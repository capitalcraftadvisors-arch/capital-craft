"use client";

// Step 3 — Directors / Partners / Proprietor / generic Members.
//
// All labels and the section heading branch on epc_business.business_type
// (which was saved in Step 2):
//
//   proprietorship  → "Proprietor details"  + single editable row whose
//                     name + designation are pre-seeded from Step 1's
//                     contact_name / contact_designation. No add button.
//                     If the JSONB has multiple rows (e.g. user switched
//                     here from Pvt Ltd), we DESTRUCTIVELY TRIM to the
//                     first on save and delete the dropped rows' docs.
//   pvt_ltd         → "Director details"    + "Director N" rows, "+ Add Director"
//   partnership/llp → "Partner details"     + "Partner N" rows, "+ Add Partner"
//   null/unset      → "Member details"      + "Member N" rows, "+ Add Member"
//
// Stakeholders JSONB shape is UNCHANGED: { id, name, designation }.
// Existing saved data is preserved verbatim; auto-fill only happens on
// new rows or when seeding the proprietor row for the first time.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import FileUpload from "@/components/FileUpload";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type Stakeholder = { id: string; name: string; designation: string };
type BizType = "proprietorship" | "pvt_ltd" | "partnership" | "llp" | null;

type RoleConfig = {
  heading: string;
  roleLabel: string;        // for per-row title: "Director 1"
  addButtonLabel: string | null; // null = hide
  defaultDesignation: string;
  maxRows: number;          // Infinity for unlimited
};

function configFor(bt: BizType): RoleConfig {
  switch (bt) {
    case "proprietorship":
      return { heading: "Proprietor details", roleLabel: "Proprietor", addButtonLabel: null, defaultDesignation: "Proprietor", maxRows: 1 };
    case "pvt_ltd":
      return { heading: "Director details", roleLabel: "Director", addButtonLabel: "+ Add Director", defaultDesignation: "Director", maxRows: Infinity };
    case "partnership":
    case "llp":
      return { heading: "Partner details", roleLabel: "Partner", addButtonLabel: "+ Add Partner", defaultDesignation: "Partner", maxRows: Infinity };
    default:
      return { heading: "Member details", roleLabel: "Member", addButtonLabel: "+ Add Member", defaultDesignation: "", maxRows: Infinity };
  }
}

export default function Step3Page() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessType, setBusinessType] = useState<BizType>(null);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [saving, setSaving] = useState(false);

  const cfg = configFor(businessType);

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    setBusinessId(biz.id);
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("stakeholders, business_type, contact_name, contact_designation")
        .eq("id", biz.id)
        .maybeSingle();

      const bt = ((data?.business_type as BizType) ?? null) as BizType;
      const c = configFor(bt);
      setBusinessType(bt);

      const existing = (data?.stakeholders as Stakeholder[] | null) ?? [];

      if (existing.length === 0) {
        // Seed first row:
        //   proprietorship → from Step 1 fields (editable)
        //   others         → empty name + role-default designation (editable)
        const seeded: Stakeholder =
          bt === "proprietorship"
            ? {
                id: crypto.randomUUID(),
                name: (data?.contact_name as string | null) ?? "",
                designation:
                  ((data?.contact_designation as string | null) ?? "") ||
                  c.defaultDesignation,
              }
            : {
                id: crypto.randomUUID(),
                name: "",
                designation: c.defaultDesignation,
              };
        setStakeholders([seeded]);
      } else {
        setStakeholders(existing);
      }
    })();
  }, []);

  // Persist on every keystroke so docs uploaded against a stakeholder.id are
  // never orphans if the user closes the tab.
  async function persistJsonb(next: Stakeholder[]) {
    if (!businessId) return;
    await supabase().from("epc_business").update({ stakeholders: next }).eq("id", businessId);
  }

  function updateField(id: string, key: "name" | "designation", value: string) {
    setStakeholders((arr) => {
      const next = arr.map((s) => (s.id === id ? { ...s, [key]: value } : s));
      void persistJsonb(next);
      return next;
    });
  }

  function addPerson() {
    setStakeholders((arr) => {
      const next = [...arr, { id: crypto.randomUUID(), name: "", designation: cfg.defaultDesignation }];
      void persistJsonb(next);
      return next;
    });
  }

  async function removePerson(id: string) {
    if (!businessId) return;
    // Delete this stakeholder's docs (rows + GCS) first to avoid orphans.
    const { data: docs } = await supabase()
      .from("epc_documents")
      .select("storage_path")
      .eq("business_id", businessId)
      .eq("stakeholder_id", id);
    if (docs && docs.length) {
      const paths = (docs as { storage_path: string }[]).map((d) => d.storage_path);
      await supabase().storage.from("epc-docs").remove(paths);
      await supabase().from("epc_documents").delete().eq("business_id", businessId).eq("stakeholder_id", id);
    }
    setStakeholders((arr) => {
      const next = arr.filter((s) => s.id !== id);
      void persistJsonb(next);
      return next;
    });
  }

  // Proprietorship view: render only the first row; trim the rest on save.
  const displayed = businessType === "proprietorship" ? stakeholders.slice(0, 1) : stakeholders;
  const trimmed   = businessType === "proprietorship" ? stakeholders.slice(1)   : [];

  async function handleContinue() {
    const biz = getBusiness();
    if (!biz || !businessId) return;

    const valid = displayed.filter((s) => s.name.trim() && s.designation.trim());
    if (valid.length === 0) {
      alert(`Please add ${businessType === "proprietorship" ? "the proprietor's" : "at least one " + cfg.roleLabel.toLowerCase() + "'s"} name and designation.`);
      return;
    }

    setSaving(true);

    // Destructive trim for proprietorship — delete dropped stakeholders' docs.
    for (const t of trimmed) {
      const { data: docs } = await supabase()
        .from("epc_documents")
        .select("storage_path")
        .eq("business_id", businessId)
        .eq("stakeholder_id", t.id);
      if (docs && docs.length) {
        const paths = (docs as { storage_path: string }[]).map((d) => d.storage_path);
        await supabase().storage.from("epc-docs").remove(paths);
        await supabase().from("epc_documents").delete().eq("business_id", businessId).eq("stakeholder_id", t.id);
      }
    }

    const { error } = await supabase()
      .from("epc_business")
      .update({ stakeholders: valid, current_step: 4 })
      .eq("id", biz.id);
    setSaving(false);
    if (error) return alert(error.message);
    setBusiness({ ...biz, current_step: 4 });
    router.push("/onboarding/step-4");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => router.push("/onboarding/step-2" as any)}
        className="inline-flex items-center gap-1 text-[13px] text-text-mid hover:text-text mb-4"
      >
        <span aria-hidden>←</span> Back
      </button>
      <div className="mb-8"><WizardProgress current={3} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">{cfg.heading}</h1>
        <p className="text-text-mid mt-1">
          {businessType === "proprietorship"
            ? "Confirm or correct the proprietor's details. Document uploads are optional."
            : `At least one ${cfg.roleLabel.toLowerCase()} is required. Document uploads are optional.`}
        </p>
      </div>

      <div className="space-y-5">
        {displayed.map((s, i) => (
          <Card key={s.id} className="p-6 sm:p-7">
            <div className="flex items-start justify-between mb-5">
              <h3 className="font-display font-semibold text-[18px]">
                {businessType === "proprietorship" ? cfg.roleLabel : `${cfg.roleLabel} ${i + 1}`}
              </h3>
              {/* Delete row: only shown when there's >1 row AND we're not in
                  proprietorship mode (proprietor is a single-row slot). */}
              {displayed.length > 1 && businessType !== "proprietorship" && (
                <button
                  type="button"
                  onClick={() => removePerson(s.id)}
                  className="text-[13px] text-text-muted hover:text-red-500 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Input
                label="Name"
                placeholder="Full name"
                value={s.name}
                onChange={(e) => updateField(s.id, "name", e.target.value)}
              />
              <Input
                label="Designation"
                placeholder={`e.g. ${cfg.defaultDesignation || "Director, Partner"}`}
                value={s.designation}
                onChange={(e) => updateField(s.id, "designation", e.target.value)}
              />
            </div>

            {businessId && (
              <div className="grid gap-5 sm:grid-cols-2 mt-5">
                <div className="p-4 bg-bg-soft rounded-input border border-line">
                  <FileUpload
                    businessId={businessId}
                    stakeholderId={s.id}
                    table="epc_documents"
                    category="stakeholder_aadhaar"
                    maxFiles={4}
                    label="Aadhaar card (optional)"
                    hint="One or many."
                  />
                </div>
                <div className="p-4 bg-bg-soft rounded-input border border-line">
                  <FileUpload
                    businessId={businessId}
                    stakeholderId={s.id}
                    table="epc_documents"
                    category="stakeholder_pan"
                    maxFiles={1}
                    label="PAN card (optional)"
                  />
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="mt-5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        {cfg.addButtonLabel && stakeholders.length < cfg.maxRows ? (
          <Button type="button" variant="outline" onClick={addPerson}>{cfg.addButtonLabel}</Button>
        ) : (
          <span /> /* spacer to keep Continue right-aligned on desktop */
        )}
        <Button type="button" variant="primary" loading={saving} onClick={handleContinue}>
          Save & continue
        </Button>
      </div>
    </>
  );
}
