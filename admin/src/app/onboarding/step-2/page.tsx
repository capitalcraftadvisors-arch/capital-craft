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
import { extractPan } from "@/lib/ocr";
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
  const [panOcrToast, setPanOcrToast] = useState<string | null>(null);

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

  // Triggered by FileUpload's onUploaded for the PAN document. Runs Vision
  // OCR on the original file (cleaner bytes than the compressed JPEG that
  // landed in GCS), auto-fills the PAN field on success, leaves it
  // untouched on failure. PAN field stays editable in both cases.
  async function handlePanUploaded({ file }: { file: File }) {
    setPanOcrToast("Reading PAN…");
    const r = await extractPan(file);
    if (!r.ok) {
      setPanOcrToast("Couldn't read PAN automatically — please type it in.");
      return;
    }
    if (r.pan) {
      setValue("pan_number", r.pan, { shouldValidate: true });
      setPanOcrToast("PAN auto-filled — verify and edit if needed.");
    } else {
      setPanOcrToast(
        "We read the document but couldn't find a PAN number — please type it in.",
      );
    }
  }

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
      <button
        type="button"
        onClick={() => router.push("/onboarding/step-1" as any)}
        className="inline-flex items-center gap-1 text-[13px] text-text-mid hover:text-text mb-4"
      >
        <span aria-hidden>←</span> Back
      </button>
      <div className="mb-8"><WizardProgress current={2} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">Business details</h1>
        <p className="text-text-mid mt-1">
          Tell us about your EPC entity. Document uploads are optional.
        </p>
      </div>

      <Card className="p-6 sm:p-7">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* 1. Business type — unchanged */}
          <Select
            label="Business type"
            placeholder="Select…"
            options={BUSINESS_OPTIONS}
            {...register("business_type", { required: "Pick a business type" })}
            error={errors.business_type?.message}
          />

          {businessId && (
            <>
              {/* 2. PAN document upload — triggers OCR on success */}
              <div className="p-4 bg-bg-soft rounded-input border border-line">
                <FileUpload
                  businessId={businessId}
                  table="epc_documents"
                  category="pan_business"
                  maxFiles={1}
                  label="PAN card (optional)"
                  hint="Upload a clear scan or photo. We'll read the PAN number for you."
                  onUploaded={handlePanUploaded}
                />
                {panOcrToast && (
                  <div className="mt-3 px-3.5 py-2.5 rounded-input bg-blue-50 border border-blue/15 text-[12px] text-text-mid">
                    {panOcrToast}
                  </div>
                )}
              </div>

              {/* 3. GSTIN document upload */}
              <div className="p-4 bg-bg-soft rounded-input border border-line">
                <FileUpload
                  businessId={businessId}
                  table="epc_documents"
                  category="gstin"
                  maxFiles={1}
                  label="GST registration document (optional)"
                  hint="Skip if you don't have GSTIN."
                />
              </div>
            </>
          )}

          {/* 4. PAN number — auto-filled by OCR, stays editable */}
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
            hint="Auto-filled from the PAN document if you uploaded one. Edit if needed."
          />

          {/* 5. Extra doc (conditional on business type) */}
          {businessId && extraLabel && (
            <div className="p-4 bg-bg-soft rounded-input border border-line">
              <FileUpload
                businessId={businessId}
                table="epc_documents"
                category="extra_doc"
                maxFiles={1}
                label={`${extraLabel} (optional)`}
              />
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button type="submit" variant="primary" loading={saving}>
              Save &amp; continue
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
