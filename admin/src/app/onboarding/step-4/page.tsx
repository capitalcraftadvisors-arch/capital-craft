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
  confirm_account_number: string; // UI-only; not persisted
  bank_ifsc: string;
  bank_name: string;
};

export default function Step4Page() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ocrToast, setOcrToast] = useState<string | null>(null);
  const [ocrRaw, setOcrRaw] = useState<unknown>(null);

  const {
    register, handleSubmit, reset, setValue, watch,
    formState: { errors },
  } = useForm<Form>({
    defaultValues: {
      bank_account_number: "",
      confirm_account_number: "",
      bank_ifsc: "",
      bank_name: "",
    },
  });

  // Watch both account-number fields so the Continue button reacts in real time.
  const acct = watch("bank_account_number");
  const acctConfirm = watch("confirm_account_number");
  const acctMatches =
    acct.length > 0 && acctConfirm.length > 0 && acct === acctConfirm;
  const acctMismatch =
    acctConfirm.length > 0 && acct !== acctConfirm;

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    setBusinessId(biz.id);
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("bank_account_number, bank_ifsc, bank_name")
        .eq("id", biz.id)
        .maybeSingle();
      reset({
        bank_account_number: data?.bank_account_number ?? "",
        // On resume, pre-fill confirm with the stored value so the EPC isn't
        // forced to re-type if they already verified it last session.
        confirm_account_number: data?.bank_account_number ?? "",
        bank_ifsc: data?.bank_ifsc ?? "",
        bank_name: data?.bank_name ?? "",
      });
    })();
  }, [reset]);

  async function handleChequeUploaded({ file }: { file: File }) {
    setOcrToast("Reading cheque…");
    const r = await extractCheque(file);
    if (!r.ok) {
      setOcrToast(
        "Couldn't read cheque automatically — please type the fields manually.",
      );
      return;
    }
    if (r.ifsc) setValue("bank_ifsc", r.ifsc);
    if (r.accountNumber) {
      setValue("bank_account_number", r.accountNumber);
      // OCR auto-fill should NOT auto-confirm — the whole point is the EPC
      // re-types it as a verification step. Clear confirm so they have to.
      setValue("confirm_account_number", "");
    }
    if (r.bankName) setValue("bank_name", r.bankName);
    setOcrRaw(r);
    setOcrToast(
      "We pre-filled what we could — verify and re-confirm the account number below.",
    );
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
        // Branch input removed from the form; clear any stale value on save so
        // the admin view / summary don't show a value the EPC can no longer edit.
        bank_branch: null,
        bank_name: values.bank_name || null,
        // Account-holder field was removed from the form; clear any stale value.
        bank_account_holder: null,
        cheque_ocr_raw: ocrRaw,
        current_step: nextStep,
      })
      .eq("id", biz.id);
    setSaving(false);
    if (error) return alert(error.message);
    setBusiness({ ...biz, current_step: nextStep });
    router.push(`/onboarding/step-${nextStep}` as any);
  }

  // Skip is allowed even if confirm doesn't match — the entire step is optional.
  const onSkip = handleSubmit((v) => save(v, 5));

  // Continue requires the re-confirm field to match (when there's a value).
  const onNext = handleSubmit((v) => {
    if (v.bank_account_number && v.bank_account_number !== v.confirm_account_number) {
      // Should be blocked by the disabled state, but guard anyway.
      return;
    }
    save(v, 5);
  });

  // The Continue button is disabled when the EPC has typed an account number
  // but the confirm field doesn't match (or is empty). If the EPC hasn't
  // entered any account number, Continue stays enabled (the whole step is
  // optional — they can leave bank blank).
  const continueDisabled =
    acct.length > 0 && !acctMatches;

  return (
    <>
      <button
        type="button"
        onClick={() => router.push("/onboarding/step-3" as any)}
        className="inline-flex items-center gap-1 text-[13px] text-text-mid hover:text-text mb-4"
      >
        <span aria-hidden>←</span> Back
      </button>
      <div className="mb-8"><WizardProgress current={4} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">Bank details</h1>
        <p className="text-text-mid mt-1">
          Upload a clear picture or copy of a cheque for the account where you&rsquo;d
          like to receive payment. We&rsquo;ll read the account number, IFSC and bank
          name automatically. This step is optional — you can skip and add these later.
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
              hint="JPG, PNG, WEBP, or PDF. Make sure the account number, IFSC and bank name are legible."
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
              placeholder=""
              inputMode="numeric"
              {...register("bank_account_number", {
                validate: (v) => !v || ACCOUNT_RE.test(v) || "9-18 digits",
              })}
              error={errors.bank_account_number?.message}
            />
            <Input
              label="Re-confirm account number"
              placeholder=""
              inputMode="numeric"
              {...register("confirm_account_number")}
              error={acctMismatch ? "Account numbers don't match." : undefined}
              hint={
                !acctMismatch && acctMatches
                  ? "Matches."
                  : !acctMismatch && acct.length > 0 && acctConfirm.length === 0
                  ? "Please type the account number again to confirm."
                  : undefined
              }
            />

            <Input
              label="IFSC code"
              placeholder=""
              maxLength={11}
              {...register("bank_ifsc", {
                validate: (v) => !v || IFSC_RE.test(v.toUpperCase()) || "Invalid IFSC",
                onChange: (e) => setValue("bank_ifsc", e.target.value.toUpperCase()),
              })}
              error={errors.bank_ifsc?.message}
            />
            <Input
              label="Bank name"
              placeholder="e.g. HDFC Bank"
              {...register("bank_name")}
              hint="Auto-filled when the cheque is read. Edit if it looks wrong."
            />
          </form>
        </Card>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
        <Button type="button" variant="outline" onClick={onSkip} loading={saving}>
          Skip
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onNext}
          loading={saving}
          disabled={continueDisabled || saving}
        >
          Save &amp; continue
        </Button>
      </div>
    </>
  );
}
