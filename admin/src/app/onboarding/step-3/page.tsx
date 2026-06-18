"use client";

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

export default function Step3Page() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    setBusinessId(biz.id);
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("stakeholders")
        .eq("id", biz.id)
        .maybeSingle();
      const existing = (data?.stakeholders as Stakeholder[] | null) ?? [];
      if (existing.length === 0) {
        setStakeholders([{ id: crypto.randomUUID(), name: "", designation: "" }]);
      } else {
        setStakeholders(existing);
      }
    })();
  }, []);

  // Persist the JSONB array on every edit so docs uploaded against a member id
  // never become orphans if the user closes the tab.
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

  function addMember() {
    setStakeholders((arr) => {
      const next = [...arr, { id: crypto.randomUUID(), name: "", designation: "" }];
      void persistJsonb(next);
      return next;
    });
  }

  async function removeMember(id: string) {
    if (!businessId) return;
    // Delete any docs tied to this stakeholder first
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

  async function handleContinue() {
    const biz = getBusiness();
    if (!biz) return;
    const valid = stakeholders.filter((s) => s.name.trim() && s.designation.trim());
    if (valid.length === 0) {
      alert("Add at least one member with a name and designation.");
      return;
    }
    setSaving(true);
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
      <div className="mb-8"><WizardProgress current={3} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">Directors / members</h1>
        <p className="text-text-mid mt-1">
          At least one member is required. Document uploads are optional.
        </p>
      </div>

      <div className="space-y-5">
        {stakeholders.map((s, i) => (
          <Card key={s.id} className="p-6 sm:p-7">
            <div className="flex items-start justify-between mb-5">
              <h3 className="font-display font-semibold text-[18px]">Member {i + 1}</h3>
              {stakeholders.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMember(s.id)}
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
                placeholder="e.g. Director, Partner"
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
                    label="Aadhaar document (optional)"
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
                    label="PAN document (optional)"
                  />
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="mt-5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <Button type="button" variant="outline" onClick={addMember}>+ Add member</Button>
        <Button type="button" variant="primary" loading={saving} onClick={handleContinue}>
          Save & continue
        </Button>
      </div>
    </>
  );
}
