"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type Form = {
  contact_name: string;
  contact_mobile: string; // read-only
  contact_designation: string;
};

export default function Step1Page() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<Form>({
    defaultValues: { contact_name: "", contact_mobile: "", contact_designation: "" },
  });

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("contact_name, contact_mobile, contact_designation")
        .eq("id", biz.id)
        .maybeSingle();
      reset({
        contact_name: data?.contact_name ?? "",
        contact_mobile: data?.contact_mobile ?? "",
        contact_designation: data?.contact_designation ?? "",
      });
    })();
  }, [reset]);

  async function onSubmit(values: Form) {
    const biz = getBusiness();
    if (!biz) return;
    setSaving(true);
    const { error } = await supabase()
      .from("epc_business")
      .update({
        contact_name: values.contact_name.trim(),
        contact_designation: values.contact_designation.trim(),
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
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">Personal details</h1>
        <p className="text-text-mid mt-1">Tell us who we&rsquo;ll be working with.</p>
      </div>

      <Card className="p-6 sm:p-7">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <Input
            label="Contact name"
            placeholder="Your full name"
            {...register("contact_name", {
              required: "Name is required",
              minLength: { value: 2, message: "Name is too short" },
              maxLength: { value: 80, message: "Name is too long" },
            })}
            error={errors.contact_name?.message}
          />

          <Input
            label="Mobile number"
            readOnly
            value={undefined}
            {...register("contact_mobile")}
            hint="This is the number you logged in with."
            className="bg-bg-soft cursor-not-allowed"
          />

          <Input
            label="Designation"
            placeholder="e.g. Director, Proprietor"
            {...register("contact_designation", { required: "Designation is required" })}
            error={errors.contact_designation?.message}
          />

          <div className="flex justify-end pt-2">
            <Button type="submit" variant="primary" loading={saving}>Save & continue</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
