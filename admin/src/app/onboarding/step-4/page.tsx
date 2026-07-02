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

// Bank details.
//
// New-onboarding (status='draft') rules:
//   - Cancelled cheque doc is REQUIRED.
//   - Account number + IFSC + Bank name + confirm-account-number match REQUIRED.
//   - No Skip button — the EPC must complete before advancing.
// Legacy / self-edit EPCs remain optional: Skip and empty fields allowed.
//
// OCR runs silently — no user-facing "reading…" / "auto-filled…" strings.
// Fields simply appear populated a moment after the upload; the EPC verifies
// and can edit anything wrong.

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
  const [ocrRaw, setOcrRaw] = useState<unknown>(null);

  const isDraft = getBusiness()?.status === "draft";

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
        confirm_account_number: data?.bank_account_number ?? "",
        bank_ifsc: data?.bank_ifsc ?? "",
        bank_name: data?.bank_name ?? "",
      });
    })();
  }, [reset]);

  // OCR runs silently in the background. No user-facing feedback strings.
  async function handleChequeUploaded({ file }: { file: File }) {
    try {
      const r = await extractCheque(file);
      if (!r.ok) return;
      if (r.ifsc) setValue("bank_ifsc", r.ifsc);
      if (r.accountNumber) {
        setValue("bank_account_number", r.accountNumber);
        // OCR auto-fill should NOT auto-confirm — the point is the EPC
        // re-types it as a verification step. Clear confirm so they have to.
        setValue("confirm_account_number", "");
      }
      if (r.bankName) setValue("bank_name", r.bankName);
      setOcrRaw(r);
    } catch (e) {
      console.warn("[step-4] cheque OCR silent failure:", e);
    }
  }

  async function chequeUploaded(): Promise<boolean> {
    if (!businessId) return false;
    const { data } = await supabase()
      .from("epc_documents")
      .select("id")
      .eq("business_id", businessId)
      .eq("category", "cancelled_cheque")
      .limit(1);
    return (data?.length ?? 0) > 0;
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
        // Branch input removed from the form; clear any stale value on save.
        bank_branch: null,
        bank_name: values.bank_name || null,
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

  const onNext = handleSubmit(async (v) => {
    if (isDraft) {
      if (!(await chequeUploaded())) {
        return alert("Please upload the cancelled cheque to continue.");
      }
      if (!v.bank_account_number || !ACCOUNT_RE.test(v.bank_account_number)) {
        return alert("Please enter a valid account number (9-18 digits).");
      }
      if (v.bank_account_number !== v.confirm_account_number) {
        return alert("The re-confirm account number doesn't match.");
      }
      if (!v.bank_ifsc || !IFSC_RE.test(v.bank_ifsc.toUpperCase())) {
        return alert("Please enter a valid IFSC code.");
      }
      if (!v.bank_name.trim()) {
        return alert("Please enter the bank name.");
      }
    } else {
      // Non-draft path: if the account number is present it must match confirm.
      if (v.bank_account_number && v.bank_account_number !== v.confirm_account_number) return;
    }
    save(v, 5);
  });

  // Non-draft only.
  const onSkip = handleSubmit((v) => save(v, 5));

  const continueDisabled = isDraft
    ? saving
    : (acct.length > 0 && !acctMatches) || saving;

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
          like to receive payment, then confirm the details below.
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
              label="Cancelled cheque"
              hint="JPG, PNG, WEBP, or PDF. Make sure all details are clearly visible."
              onUploaded={handleChequeUploaded}
            />
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
            />
          </form>
        </Card>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
        {!isDraft && (
          <Button type="button" variant="outline" onClick={onSkip} loading={saving}>
            Skip
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          onClick={onNext}
          loading={saving}
          disabled={continueDisabled}
        >
          Save &amp; continue
        </Button>
      </div>
    </>
  );
}
