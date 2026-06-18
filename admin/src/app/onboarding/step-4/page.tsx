"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import FileUpload from "@/components/FileUpload";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { extractCheque } from "@/lib/ocr";
import { ACCOUNT_RE, IFSC_RE } from "@/lib/validators";

type Form = {
  bank_account_number: string;
  bank_ifsc: string;
  bank_branch: string;
  bank_account_holder: string;
};

export default function Step4Page() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ocrToast, setOcrToast] = useState<string | null>(null);
  const [ocrRaw, setOcrRaw] = useState<unknown>(null);

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<Form>({
    defaultValues: {
      bank_account_number: "",
      bank_ifsc: "",
      bank_branch: "",
      bank_account_holder: "",
    },
  });

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    setBusinessId(biz.id);
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("bank_account_number, bank_ifsc, bank_branch, bank_account_holder")
        .eq("id", biz.id)
        .maybeSingle();
      reset({
        bank_account_number: data?.bank_account_number ?? "",
        bank_ifsc: data?.bank_ifsc ?? "",
        bank_branch: data?.bank_branch ?? "",
        bank_account_holder: data?.bank_account_holder ?? "",
      });
    })();
  }, [reset]);

  async function handleChequeUploaded({ file }: { file: File }) {
    setOcrToast("Reading cheque…");
    const r = await extractCheque(file);
    if (!r.ok) {
      setOcrToast("Couldn't read cheque automatically — please type the fields manually.");
      return;
    }
    if (r.ifsc) setValue("bank_ifsc", r.ifsc);
    if (r.accountNumber) setValue("bank_account_number", r.accountNumber);
    setOcrRaw(r);
    setOcrToast("We pre-filled what we could — verify and edit if needed.");
  }

  async function save(values: Form, nextStep: number) {
    const biz = getBusiness();
    if (!biz) return;
    setSaving(true);
    const { error } = await supabase()
      .from("epc_business")
      .update({
        bank_account_number: values.bank_account_number || null,
        bank_ifsc: values.bank_ifsc ? values.bank_ifsc.toUpperCase() : null,
        bank_branch: values.bank_branch || null,
        bank_account_holder: values.bank_account_holder || null,
        cheque_ocr_raw: ocrRaw,
        current_step: nextStep,
      })
      .eq("id", biz.id);
    setSaving(false);
    if (error) return alert(error.message);
    setBusiness({ ...biz, current_step: nextStep });
    router.push(`/onboarding/step-${nextStep}` as any);
  }

  const onNext = handleSubmit((v) => save(v, 5));
  const onSkip = handleSubmit((v) => save(v, 5));

  return (
    <>
      <div className="mb-8"><WizardProgress current={4} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">Bank details</h1>
        <p className="text-text-mid mt-1">
          Upload a cancelled cheque — we&rsquo;ll try to read it automatically. Optional, you can skip.
        </p>
      </div>

      <div className="space-y-5">
        {businessId && (
          <Card className="p-6 sm:p-7">
            <FileUpload
              businessId={businessId}
              table="epc_documents"
              category="cancelled_cheque"
              maxFiles={1}
              label="Cancelled cheque (optional)"
              hint="JPG/PNG/WEBP/PDF. We&rsquo;ll read the IFSC + account number with OCR."
              onUploaded={handleChequeUploaded}
            />
            {ocrToast && (
              <div className="mt-3 px-3.5 py-2.5 rounded-input bg-blue-50 border border-blue/15 text-[12px] text-text-mid">
                {ocrToast}
              </div>
            )}
          </Card>
        )}

        <Card className="p-6 sm:p-7">
          <form className="grid gap-5 sm:grid-cols-2">
            <Input
              label="Account number"
              placeholder="9 to 18 digits"
              inputMode="numeric"
              {...register("bank_account_number", {
                validate: (v) => !v || ACCOUNT_RE.test(v) || "9-18 digits",
              })}
              error={errors.bank_account_number?.message}
            />
            <Input
              label="IFSC code"
              placeholder="ABCD0123456"
              maxLength={11}
              {...register("bank_ifsc", {
                validate: (v) => !v || IFSC_RE.test(v.toUpperCase()) || "Invalid IFSC",
                onChange: (e) => setValue("bank_ifsc", e.target.value.toUpperCase()),
              })}
              error={errors.bank_ifsc?.message}
            />
            <Input label="Branch" placeholder="Branch name" {...register("bank_branch")} />
            <Input label="Account holder / business name" placeholder="As per cheque" {...register("bank_account_holder")} />
          </form>
        </Card>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
        <Button type="button" variant="outline" onClick={onSkip} loading={saving}>Skip</Button>
        <Button type="button" variant="primary" onClick={onNext} loading={saving}>Save & continue</Button>
      </div>
    </>
  );
}
