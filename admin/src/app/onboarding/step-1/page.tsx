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
// the literal word "Other").
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

// ── Inline SVG icons — no new dep. Kept small so imports don't balloon. ──
const IconUser = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const IconMail = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);
const IconPhone = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.92z" />
  </svg>
);
const IconBriefcase = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);

type Form = {
  first_name: string;
  last_name: string;
  contact_email: string;
  contact_mobile: string;       // read-only, set from login
  designation_choice: string;   // one of DESIGNATION_OPTIONS' values, or ""
  designation_custom: string;   // only used when designation_choice === "Other"
};

// Split "First Last Rest" into { first: "First", last: "Last Rest" }.
// A single-word legacy name goes entirely to first, with last blank.
function splitName(name: string): { first: string; last: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { first: "", last: "" };
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1).trim() };
}

function joinName(first: string, last: string): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f && l) return `${f} ${l}`;
  return f || l;
}

export default function Step1Page() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const {
    register, handleSubmit, reset, watch,
    formState: { errors },
  } = useForm<Form>({
    defaultValues: {
      first_name: "",
      last_name: "",
      contact_email: "",
      contact_mobile: "",
      designation_choice: "",
      designation_custom: "",
    },
  });

  const designationChoice = watch("designation_choice");
  const showCustom = designationChoice === "Other";

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("contact_name, contact_email, contact_mobile, contact_designation")
        .eq("id", biz.id)
        .maybeSingle();

      const stored = data?.contact_designation ?? "";
      const isStandard = STANDARD_DESIGNATIONS.has(stored);
      const { first, last } = splitName(data?.contact_name ?? "");

      reset({
        first_name: first,
        last_name: last,
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

    const designation =
      values.designation_choice === "Other"
        ? values.designation_custom.trim()
        : values.designation_choice;

    const contact_name = joinName(values.first_name, values.last_name);

    setSaving(true);
    const { error } = await supabase()
      .from("epc_business")
      .update({
        contact_name,
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

  const inSelfEdit = getBusiness()?.status === "under_review";

  return (
    <>
      {inSelfEdit && (
        <button
          type="button"
          onClick={() => router.push("/status")}
          className="inline-flex items-center gap-1 text-[13px] text-text-mid hover:text-text mb-4"
        >
          <span aria-hidden>←</span> Back to status
        </button>
      )}
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
          <div>
            <label className="block mb-1.5 text-[13px] font-medium text-text-mid">
              POC Name (Point of Contact)
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="First name"
                leftIcon={IconUser}
                {...register("first_name", {
                  required: "First name is required",
                  minLength: { value: 1, message: "Required" },
                  maxLength: { value: 40, message: "Too long" },
                })}
                error={errors.first_name?.message}
              />
              <Input
                placeholder="Last name"
                leftIcon={IconUser}
                {...register("last_name", {
                  required: "Last name is required",
                  minLength: { value: 1, message: "Required" },
                  maxLength: { value: 60, message: "Too long" },
                })}
                error={errors.last_name?.message}
              />
            </div>
          </div>

          <Input
            label="Email ID"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            leftIcon={IconMail}
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
            leftIcon={IconPhone}
            {...register("contact_mobile")}
            hint="This is the number you logged in with."
            className="bg-bg-soft cursor-not-allowed"
          />

          <Select
            label="Designation"
            placeholder="Select…"
            options={DESIGNATION_OPTIONS}
            leftIcon={IconBriefcase}
            {...register("designation_choice", {
              required: "Designation is required",
            })}
            error={errors.designation_choice?.message}
          />

          {showCustom && (
            <Input
              label="Specify designation"
              placeholder="Type your designation"
              leftIcon={IconBriefcase}
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
