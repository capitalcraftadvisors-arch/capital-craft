"use client";

// Step 3 — Directors / Partners / Proprietor / generic Members.
//
// All labels and the section heading branch on epc_business.business_type
// (which was saved in Step 2):
//
//   proprietorship  → "Proprietor details"  + single editable row whose
//                     name + designation + mobile + email are pre-seeded
//                     from Step 1's contact_name / contact_designation /
//                     contact_mobile / contact_email. No add button.
//                     If the JSONB has multiple rows (e.g. user switched
//                     here from Pvt Ltd), we DESTRUCTIVELY TRIM to the
//                     first on save and delete the dropped rows' docs.
//   pvt_ltd         → "Director details"    + "Director N" rows, "+ Add Director"
//   partnership/llp → "Partner details"     + "Partner N" rows, "+ Add Partner"
//   null/unset      → "Member details"      + "Member N" rows, "+ Add Member"
//
// Stakeholders JSONB shape (v2): { id, name, designation, mobile, email }.
// Backward-compatible read: legacy rows without mobile/email surface as "".
// Mobile is REQUIRED (10-digit Indian mobile). Email is OPTIONAL but
// validated when non-empty (EMAIL_RE).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import FileUpload from "@/components/FileUpload";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { MOBILE_RE, EMAIL_RE } from "@/lib/validators";

type Stakeholder = {
  id: string;
  name: string;
  designation: string;
  mobile: string;
  email: string;
};

type BizType = "proprietorship" | "pvt_ltd" | "partnership" | "llp" | null;

type RoleConfig = {
  heading: string;
  roleLabel: string;
  addButtonLabel: string | null;
  defaultDesignation: string;
  maxRows: number;
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

// Backward-compat: coerce raw JSONB rows (which may be missing mobile/email
// on legacy EPCs) into the current Stakeholder shape.
function normalizeStakeholder(raw: unknown): Stakeholder {
  const r = raw as Record<string, unknown>;
  return {
    id: (r.id as string) ?? crypto.randomUUID(),
    name: (r.name as string) ?? "",
    designation: (r.designation as string) ?? "",
    mobile: (r.mobile as string) ?? "",
    email: (r.email as string) ?? "",
  };
}

export default function Step3Page() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessType, setBusinessType] = useState<BizType>(null);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const cfg = configFor(businessType);

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    setBusinessId(biz.id);
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select(
          "stakeholders, business_type, contact_name, contact_designation, contact_mobile, contact_email",
        )
        .eq("id", biz.id)
        .maybeSingle();

      const bt = ((data?.business_type as BizType) ?? null) as BizType;
      const c = configFor(bt);
      setBusinessType(bt);

      const rawExisting = (data?.stakeholders as unknown[] | null) ?? [];
      const existing = rawExisting.map(normalizeStakeholder);

      if (existing.length === 0) {
        // Seed first row:
        //   proprietorship → from Step 1 fields (editable)
        //   others         → empty name+mobile+email + role-default designation
        const seeded: Stakeholder =
          bt === "proprietorship"
            ? {
                id: crypto.randomUUID(),
                name: (data?.contact_name as string | null) ?? "",
                designation:
                  ((data?.contact_designation as string | null) ?? "") ||
                  c.defaultDesignation,
                mobile: (data?.contact_mobile as string | null) ?? "",
                email:  (data?.contact_email as string | null) ?? "",
              }
            : {
                id: crypto.randomUUID(),
                name: "",
                designation: c.defaultDesignation,
                mobile: "",
                email: "",
              };
        setStakeholders([seeded]);
      } else {
        setStakeholders(existing);
      }
    })();
  }, []);

  async function persistJsonb(next: Stakeholder[]) {
    if (!businessId) return;
    await supabase().from("epc_business").update({ stakeholders: next }).eq("id", businessId);
  }

  function updateField(id: string, key: keyof Omit<Stakeholder, "id">, value: string) {
    setStakeholders((arr) => {
      const next = arr.map((s) => (s.id === id ? { ...s, [key]: value } : s));
      void persistJsonb(next);
      return next;
    });
    // Clear that field's error on edit.
    if (errors[`${id}.${key}`]) {
      setErrors((e) => {
        const c = { ...e };
        delete c[`${id}.${key}`];
        return c;
      });
    }
  }

  function addPerson() {
    setStakeholders((arr) => {
      const next = [
        ...arr,
        { id: crypto.randomUUID(), name: "", designation: cfg.defaultDesignation, mobile: "", email: "" },
      ];
      void persistJsonb(next);
      return next;
    });
  }

  async function removePerson(id: string) {
    if (!businessId) return;
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

  const displayed = businessType === "proprietorship" ? stakeholders.slice(0, 1) : stakeholders;
  const trimmed   = businessType === "proprietorship" ? stakeholders.slice(1)   : [];

  function validateRows(rows: Stakeholder[]): Record<string, string> {
    const errs: Record<string, string> = {};
    rows.forEach((s) => {
      if (!s.name.trim())        errs[`${s.id}.name`]        = "Required";
      if (!s.designation.trim()) errs[`${s.id}.designation`] = "Required";
      if (!s.mobile.trim())      errs[`${s.id}.mobile`]      = "Required";
      else if (!MOBILE_RE.test(s.mobile)) errs[`${s.id}.mobile`] = "Invalid 10-digit mobile";
      if (s.email.trim() && !EMAIL_RE.test(s.email.trim())) {
        errs[`${s.id}.email`] = "Invalid email";
      }
    });
    return errs;
  }

  async function handleContinue() {
    const biz = getBusiness();
    if (!biz || !businessId) return;

    if (displayed.length === 0) {
      alert(`Please add ${businessType === "proprietorship" ? "the proprietor's" : "at least one " + cfg.roleLabel.toLowerCase() + "'s"} details.`);
      return;
    }

    const errs = validateRows(displayed);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      alert("Please fix the highlighted fields.");
      return;
    }

    setSaving(true);

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

    const cleaned = displayed.map((s) => ({
      ...s,
      name: s.name.trim(),
      designation: s.designation.trim(),
      mobile: s.mobile.trim(),
      email: s.email.trim(),
    }));

    const { error } = await supabase()
      .from("epc_business")
      .update({ stakeholders: cleaned, current_step: 4 })
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
                error={errors[`${s.id}.name`]}
              />
              <Input
                label="Designation"
                placeholder={`e.g. ${cfg.defaultDesignation || "Director, Partner"}`}
                value={s.designation}
                onChange={(e) => updateField(s.id, "designation", e.target.value)}
                error={errors[`${s.id}.designation`]}
              />
              <Input
                label="Mobile"
                placeholder="10-digit mobile"
                inputMode="numeric"
                maxLength={10}
                value={s.mobile}
                onChange={(e) => updateField(s.id, "mobile", e.target.value.replace(/\D/g, ""))}
                error={errors[`${s.id}.mobile`]}
              />
              <Input
                label="Email (optional)"
                type="email"
                placeholder="name@example.com"
                value={s.email}
                onChange={(e) => updateField(s.id, "email", e.target.value)}
                error={errors[`${s.id}.email`]}
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
          <span />
        )}
        <Button type="button" variant="primary" loading={saving} onClick={handleContinue}>
          Save & continue
        </Button>
      </div>
    </>
  );
}
