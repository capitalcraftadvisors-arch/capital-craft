"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { EMAIL_RE } from "@/lib/validators";

// Designation choices for the dropdown. "Other" reveals a free-text field
// below the dropdown; the typed value goes into contact_designation (NOT
// the literal word "Other"). All non-"Other" choices save themselves
// verbatim into contact_designation.
const DESIGNATION_OPTIONS = [
  { value: "Partner",    label: "Partner" },
  { value: "Director",   label: "Director" },
  { value: "Proprietor", label: "Proprietor" },
  { value: "Owner",      label: "Owner" },
  { value: "Manager",    label: "Manager" },
  { value: "Other",      label: "Other" },
];

const STANDARD_DESIGNATIONS = new Set(
  DESIGNATION_OPTIONS.filter((o) => o.value !== "Other").map((o) => o.value),
);

type Form = {
  contact_name: string;
  contact_email: string;
  contact_mobile: string;       // read-only, set from login
  designation_choice: string;   // one of DESIGNATION_OPTIONS' values, or ""
  designation_custom: string;   // only used when designation_choice === "Other"
};

export default function Step1Page() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const {
    register, handleSubmit, reset, watch,
    formState: { errors },
  } = useForm<Form>({
    defaultValues: {
      contact_name: "",
      contact_email: "",
      contact_mobile: "",
      designation_choice: "",
      designation_custom: "",
    },
  });

  // Watch the dropdown so we can conditionally render + validate the
  // "Specify designation" field as soon as Other is picked.
  const designationChoice = watch("designation_choice");
  const showCustom = designationChoice === "Other";

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select(
          "contact_name, contact_email, contact_mobile, contact_designation",
        )
        .eq("id", biz.id)
        .maybeSingle();

      // Resume logic for designation:
      //   - blank in DB           → dropdown shows the placeholder, no custom field
      //   - exact standard match  → dropdown set, no custom field
      //   - anything else         → dropdown set to "Other", custom field pre-filled
      // This means a legacy free-text value like "Cluster Head" surfaces in the
      // "Other" + custom-text path; admin sees it and can edit or keep.
      const stored = data?.contact_designation ?? "";
      const isStandard = STANDARD_DESIGNATIONS.has(stored);

      reset({
        contact_name: data?.contact_name ?? "",
        contact_email: data?.contact_email ?? "",
        contact_mobile: data?.contact_mobile ?? "",
        designation_choice:
          stored === "" ? "" : isStandard ? stored : "Other",
        designation_custom: isStandard ? "" : stored,
      });
    })();
  }, [reset]);

  async function onSubmit(values: Form) {
    const biz = getBusiness();
    if (!biz) return;

    // Resolve final designation: when "Other" is picked, the typed custom
    // value is what persists. The literal string "Other" never reaches the
    // DB — that would be useless to a downstream admin reviewer.
    const designation =
      values.designation_choice === "Other"
        ? values.designation_custom.trim()
        : values.designation_choice;

    setSaving(true);
    const { error } = await supabase()
      .from("epc_business")
      .update({
        contact_name: values.contact_name.trim(),
        contact_email: values.contact_email.trim(),
        contact_designation: designation,
        current_step: 2,
      })
      .eq("id", biz.id);
    setSaving(false);
    if (error) return alert(error.message);
    setBusiness({ ...biz, current_step: 2 });
    router.push("/onboarding/step-2");
  }

  return (
    <>
      <div className="mb-8"><WizardProgress current={1} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">
          Personal details
        </h1>
        <p className="text-text-mid mt-1">
          Tell us who we&rsquo;ll be working with.
        </p>
      </div>

      <Card className="p-6 sm:p-7">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <Input
            label="Point of contact"
            placeholder="Your full name"
            {...register("contact_name", {
              required: "Point of contact is required",
              minLength: { value: 2, message: "Name is too short" },
              maxLength: { value: 80, message: "Name is too long" },
            })}
            error={errors.contact_name?.message}
          />

          <Input
            label="Email ID"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            {...register("contact_email", {
              required: "Email is required",
              pattern: { value: EMAIL_RE, message: "Enter a valid email address" },
              maxLength: { value: 120, message: "Email is too long" },
            })}
            error={errors.contact_email?.message}
          />

          <Input
            label="Mobile number"
            readOnly
            value={undefined}
            {...register("contact_mobile")}
            hint="This is the number you logged in with."
            className="bg-bg-soft cursor-not-allowed"
          />

          <Select
            label="Designation"
            placeholder="Select…"
            options={DESIGNATION_OPTIONS}
            {...register("designation_choice", {
              required: "Designation is required",
            })}
            error={errors.designation_choice?.message}
          />

          {showCustom && (
            <Input
              label="Specify designation"
              placeholder="Type your designation"
              {...register("designation_custom", {
                validate: (v) => {
                  if (designationChoice !== "Other") return true;
                  if (!v || !v.trim()) return "Please specify the designation";
                  if (v.trim().length > 80) return "Too long";
                  return true;
                },
              })}
              error={errors.designation_custom?.message}
            />
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
