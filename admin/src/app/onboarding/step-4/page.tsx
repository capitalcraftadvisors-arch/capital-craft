"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import FileUpload from "@/components/FileUpload";
import { getBusiness, setBusiness, getToken } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
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

  // Mismatch is shown only after the user "commits" the re-entry — either
  // by blurring the box or by typing to/past the account length — not on
  // every keystroke. It clears the INSTANT the two boxes match, so a
  // corrected value lets the EPC continue immediately with no page refresh.
  const [acctConfirmBlurred, setAcctConfirmBlurred] = useState(false);
  const acctConfirmComplete =
    acctConfirmBlurred ||
    (acct.length > 0 && acctConfirm.length >= acct.length);
  const acctMismatch =
    acctConfirmComplete && acctConfirm.length > 0 && acct !== acctConfirm;

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
  //
  // We also persist the OCR audit trail (raw Vision text + extracted values)
  // onto the just-inserted cancelled_cheque doc row's `metadata`. This lets
  // an admin later run `select metadata->>'ocr_raw_text'…` to see exactly
  // what Vision saw on a cheque whose account number came back wrong —
  // same debug pattern used for gstin uploads.
  async function handleChequeUploaded({ docId, file }: { docId: string; storagePath: string; file: File }) {
    try {
      // OCR on the SAME Cloud Run Google Vision setup the loan-applicant
      // PAN/Aadhaar OCR uses (working GOOGLE_VISION_API_KEY), not the
      // Supabase Edge Function.
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/epc/extract-cheque", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r?.ok) return; // silent — the EPC fills the fields manually
      if (r.ifsc) setValue("bank_ifsc", r.ifsc);
      if (r.accountNumber) {
        setValue("bank_account_number", r.accountNumber);
        // Auto-fill must NOT auto-confirm — the EPC re-types it as a
        // verification step. Clear confirm so they have to.
        setValue("confirm_account_number", "");
      }
      if (r.bankName) setValue("bank_name", r.bankName);
      setOcrRaw(r.raw_text ?? null);

      // Persist audit trail on the doc row. Best-effort.
      try {
        await supabase()
          .from("epc_documents")
          .update({
            metadata: {
              ocr_raw_text: r.raw_text ?? null,
              accountNumber: r.accountNumber ?? null,
              ifsc: r.ifsc ?? null,
              bankName: r.bankName ?? null,
            },
          })
          .eq("id", docId);
      } catch (e) {
        console.warn("[step-4] cheque metadata write failed:", e);
      }
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
        return alert("OCR may have read the wrong value — please edit the account number so both boxes match.");
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
              label="Empty cheque copy / picture"
              hint="JPG, PNG, WEBP, or PDF. No pen marks. Make sure all details are clearly visible."
              onUploaded={handleChequeUploaded}
            />
          </Card>
        )}

        <Card className="p-6 sm:p-7">
          <form className="grid gap-5 sm:grid-cols-2">
            {/* Plain editable field — digits only. Prefilled from cheque
                OCR when detected; always editable so any-length account
                number can be typed/corrected without getting locked. */}
            <Input
              label="Account number"
              placeholder=""
              inputMode="numeric"
              value={acct}
              onChange={(e) => setValue("bank_account_number", e.target.value.replace(/\D/g, ""))}
              error={errors.bank_account_number?.message}
              hint={
                acctMismatch
                  ? "Doesn't match the re-entered number — please check both boxes."
                  : undefined
              }
            />
            {/* Bottom box: user re-enters, always visible, always editable. */}
            {/* Mismatch is not shown until the user commits their re-entry  */}
            {/* (blur, or length matches/exceeds the fetched value) — no    */}
            {/* red error on every keystroke.                                */}
            {(() => {
              const confirmReg = register("confirm_account_number");
              return (
                <Input
                  label="Re-enter account number"
                  placeholder=""
                  inputMode="numeric"
                  {...confirmReg}
                  onChange={(e) => {
                    // A new keystroke means the user is typing again — reset
                    // the "blurred" commit flag so we hide any stale error.
                    setAcctConfirmBlurred(false);
                    void confirmReg.onChange(e);
                  }}
                  onBlur={(e) => {
                    setAcctConfirmBlurred(true);
                    void confirmReg.onBlur(e);
                  }}
                  error={
                    acctMismatch
                      ? "Account numbers don't match — please check both boxes."
                      : undefined
                  }
                  hint={
                    !acctMismatch && acctMatches
                      ? "Matches."
                      : !acctMismatch && acct.length > 0 && acctConfirm.length === 0
                      ? "Please type the account number again to confirm."
                      : undefined
                  }
                />
              );
            })()}

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
