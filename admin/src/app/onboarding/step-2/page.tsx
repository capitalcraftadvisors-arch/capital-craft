"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import FileUpload from "@/components/FileUpload";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PAN_RE } from "@/lib/validators";

type Form = {
  business_type: "proprietorship" | "pvt_ltd" | "partnership" | "llp" | "";
  pan_number: string;
};

const BUSINESS_OPTIONS = [
  { value: "proprietorship", label: "Proprietorship" },
  { value: "pvt_ltd",        label: "Private Limited" },
  { value: "partnership",    label: "Partnership" },
  { value: "llp",            label: "LLP" },
];

// Per spec §Step 2: the extra-doc label depends on business type.
function extraDocLabel(bt: Form["business_type"]): string | null {
  if (bt === "partnership") return "Partnership Deed";
  if (bt === "pvt_ltd")     return "Certificate of Incorporation (COI)";
  if (bt === "llp")         return "LLP Agreement";
  return null; // proprietorship -> hidden
}

export default function Step2Page() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<Form>({
    defaultValues: { business_type: "", pan_number: "" },
  });

  const bt = watch("business_type");

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    setBusinessId(biz.id);
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("business_type, pan_number")
        .eq("id", biz.id)
        .maybeSingle();
      reset({
        business_type: (data?.business_type as Form["business_type"]) ?? "",
        pan_number: data?.pan_number ?? "",
      });
    })();
  }, [reset]);

  async function onSubmit(values: Form) {
    const biz = getBusiness();
    if (!biz) return;
    if (!values.business_type) return alert("Please pick a business type.");
    setSaving(true);
    const { error } = await supabase()
      .from("epc_business")
      .update({
        business_type: values.business_type,
        pan_number: values.pan_number.toUpperCase(),
        current_step: 3,
      })
      .eq("id", biz.id);
    setSaving(false);
    if (error) return alert(error.message);
    setBusiness({ ...biz, current_step: 3 });
    router.push("/onboarding/step-3");
  }

  const extraLabel = extraDocLabel(bt);

  return (
    <>
      <div className="mb-8"><WizardProgress current={2} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">Business details</h1>
        <p className="text-text-mid mt-1">Tell us about your EPC entity. Document uploads are optional.</p>
      </div>

      <Card className="p-6 sm:p-7">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Select
            label="Business type"
            placeholder="Select…"
            options={BUSINESS_OPTIONS}
            {...register("business_type", { required: "Pick a business type" })}
            error={errors.business_type?.message}
          />

          <Input
            label="PAN number"
            placeholder="ABCDE1234F"
            maxLength={10}
            {...register("pan_number", {
              required: "PAN is required",
              pattern: { value: PAN_RE, message: "Invalid PAN format (AAAAA9999A)" },
              onChange: (e) => setValue("pan_number", e.target.value.toUpperCase()),
            })}
            error={errors.pan_number?.message}
          />

          {businessId && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="p-4 bg-bg-soft rounded-input border border-line">
                <FileUpload
                  businessId={businessId}
                  table="epc_documents"
                  category="pan_business"
                  maxFiles={1}
                  label="PAN document (optional)"
                  hint="Upload a clear scan or photo."
                />
              </div>
              <div className="p-4 bg-bg-soft rounded-input border border-line">
                <FileUpload
                  businessId={businessId}
                  table="epc_documents"
                  category="gstin"
                  maxFiles={1}
                  label="GSTIN document (optional)"
                  hint="Skip if you don't have GSTIN."
                />
              </div>
              {extraLabel && (
                <div className="p-4 bg-bg-soft rounded-input border border-line sm:col-span-2">
                  <FileUpload
                    businessId={businessId}
                    table="epc_documents"
                    category="extra_doc"
                    maxFiles={1}
                    label={`${extraLabel} (optional)`}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button type="submit" variant="primary" loading={saving}>Save & continue</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
