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
import { extractPan, extractGstLegalName } from "@/lib/ocr";
import { PAN_RE } from "@/lib/validators";

type SuryaGhar = "yes" | "no" | "other" | "";

type Form = {
  business_type: "proprietorship" | "pvt_ltd" | "partnership" | "llp" | "";
  pan_number: string;
  legal_name: string;
  pm_surya_ghar: SuryaGhar;
  pm_surya_ghar_other: string;
};

const BUSINESS_OPTIONS = [
  { value: "proprietorship", label: "Proprietorship" },
  { value: "pvt_ltd",        label: "Private Limited" },
  { value: "partnership",    label: "Partnership" },
  { value: "llp",            label: "LLP" },
];

const SURYA_GHAR_OPTIONS = [
  { value: "yes",   label: "Yes" },
  { value: "no",    label: "No" },
  { value: "other", label: "Other" },
];

function extraDocLabel(bt: Form["business_type"]): string | null {
  if (bt === "partnership") return "Partnership Deed";
  if (bt === "pvt_ltd")     return "Certificate of Incorporation (COI)";
  if (bt === "llp")         return "LLP Agreement";
  return null;
}

export default function Step2Page() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [panOcrToast, setPanOcrToast] = useState<string | null>(null);
  const [gstOcrToast, setGstOcrToast] = useState<string | null>(null);

  const {
    register, handleSubmit, reset, watch, setValue,
    formState: { errors },
  } = useForm<Form>({
    defaultValues: {
      business_type: "",
      pan_number: "",
      legal_name: "",
      pm_surya_ghar: "",
      pm_surya_ghar_other: "",
    },
  });

  const bt = watch("business_type");
  const suryaGhar = watch("pm_surya_ghar");

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    setBusinessId(biz.id);
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select(
          "business_type, pan_number, legal_name, pm_surya_ghar, pm_surya_ghar_other",
        )
        .eq("id", biz.id)
        .maybeSingle();
      reset({
        business_type: (data?.business_type as Form["business_type"]) ?? "",
        pan_number: data?.pan_number ?? "",
        legal_name: data?.legal_name ?? "",
        pm_surya_ghar: ((data?.pm_surya_ghar as SuryaGhar) ?? "") as SuryaGhar,
        pm_surya_ghar_other: data?.pm_surya_ghar_other ?? "",
      });
    })();
  }, [reset]);

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

  async function handleGstUploaded({ file }: { file: File }) {
    setGstOcrToast("Reading GST registration…");
    const r = await extractGstLegalName(file);
    if (!r.ok) {
      setGstOcrToast("Couldn't read the GST document automatically — please type the legal name.");
      return;
    }
    if (r.legal_name) {
      setValue("legal_name", r.legal_name, { shouldValidate: true });
      setGstOcrToast("Legal name auto-filled — verify and edit if needed.");
    } else {
      setGstOcrToast(
        "We read the document but couldn't find a Legal Name — please type it.",
      );
    }
  }

  async function onSubmit(values: Form) {
    const biz = getBusiness();
    if (!biz) return;
    if (!values.business_type) return alert("Please pick a business type.");

    const isDraft = biz.status === "draft";

    // GST registration required for new onboarding only.
    if (isDraft) {
      const { data: gstDocs } = await supabase()
        .from("epc_documents")
        .select("id")
        .eq("business_id", biz.id)
        .eq("category", "gstin")
        .limit(1);
      if (!gstDocs || gstDocs.length === 0) {
        return alert("Please upload the GST registration document to continue.");
      }
    }

    // PM Surya Ghar required for new onboarding only.
    if (isDraft) {
      if (!values.pm_surya_ghar) {
        return alert("Please answer the PM Surya Ghar Yojana question.");
      }
      if (values.pm_surya_ghar === "other" && !values.pm_surya_ghar_other.trim()) {
        return alert("Please specify which entity you're registered with.");
      }
    }

    setSaving(true);
    const { error } = await supabase()
      .from("epc_business")
      .update({
        business_type: values.business_type,
        pan_number: values.pan_number.toUpperCase(),
        legal_name: values.legal_name.trim() || null,
        pm_surya_ghar: values.pm_surya_ghar || null,
        // Only persist the "Other" text when Other is the choice; clear it otherwise.
        pm_surya_ghar_other:
          values.pm_surya_ghar === "other"
            ? values.pm_surya_ghar_other.trim() || null
            : null,
        current_step: 3,
      })
      .eq("id", biz.id);
    setSaving(false);
    if (error) return alert(error.message);
    setBusiness({ ...biz, current_step: 3 });
    router.push("/onboarding/step-3");
  }

  const extraLabel = extraDocLabel(bt);
  const isDraft = getBusiness()?.status === "draft";

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
          Tell us about your EPC entity. {isDraft ? "GST registration is required." : "Document uploads are optional."}
        </p>
      </div>

      <Card className="p-6 sm:p-7">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* 1. Business type */}
          <Select
            label="Business type"
            placeholder="Select…"
            options={BUSINESS_OPTIONS}
            {...register("business_type", { required: "Pick a business type" })}
            error={errors.business_type?.message}
          />

          {/* 2. PM Surya Ghar Yojana (REQUIRED for draft) */}
          <Select
            label="Are you registered with PM Surya Ghar Yojana?"
            placeholder="Select…"
            options={SURYA_GHAR_OPTIONS}
            {...register("pm_surya_ghar", {
              required: isDraft ? "Please answer this question" : false,
            })}
            error={errors.pm_surya_ghar?.message}
          />
          {suryaGhar === "other" && (
            <Input
              label="Which entity are you registered with?"
              placeholder="Entity / scheme name"
              {...register("pm_surya_ghar_other", {
                validate: (v) => {
                  if (!isDraft) return true;
                  if (suryaGhar !== "other") return true;
                  if (!v || !v.trim()) return "Please specify the entity";
                  if (v.trim().length > 120) return "Too long";
                  return true;
                },
              })}
              error={errors.pm_surya_ghar_other?.message}
            />
          )}

          {businessId && (
            <>
              {/* 3. PAN card upload */}
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

              {/* 4. GST registration document — REQUIRED for draft */}
              <div className="p-4 bg-bg-soft rounded-input border border-line">
                <FileUpload
                  businessId={businessId}
                  table="epc_documents"
                  category="gstin"
                  maxFiles={1}
                  label={isDraft ? "GST registration document (required)" : "GST registration document (optional)"}
                  hint="We'll read your business's legal name from this document."
                  onUploaded={handleGstUploaded}
                />
                {gstOcrToast && (
                  <div className="mt-3 px-3.5 py-2.5 rounded-input bg-blue-50 border border-blue/15 text-[12px] text-text-mid">
                    {gstOcrToast}
                  </div>
                )}
              </div>
            </>
          )}

          {/* 5. Legal name — auto-filled from GST OCR, editable */}
          <Input
            label="Legal name of business"
            placeholder="e.g. Acme Solar Pvt Ltd"
            {...register("legal_name", {
              maxLength: { value: 120, message: "Too long" },
            })}
            error={errors.legal_name?.message}
            hint="Auto-filled from the GST registration document. Edit if needed."
          />

          {/* 6. PAN number — auto-filled from PAN OCR, editable */}
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
            hint="Auto-filled from the PAN card if you uploaded one. Edit if needed."
          />

          {/* 7. Extra doc (conditional on business type) */}
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
