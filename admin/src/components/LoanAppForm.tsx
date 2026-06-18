"use client";

import { useForm } from "react-hook-form";
import { useState } from "react";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Select from "./ui/Select";
import Card from "./ui/Card";
import FileUpload from "./FileUpload";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { EMAIL_RE, MOBILE_RE, PAN_RE, PINCODE_RE } from "@/lib/validators";

type Form = {
  borrower_name: string; borrower_mobile: string; borrower_email?: string;
  borrower_pan?: string; borrower_dob?: string; borrower_address?: string;
  borrower_pincode?: string; borrower_city?: string; borrower_state?: string;
  loan_amount: number | "";
  tenure_months?: number | ""; system_capacity_kw?: number | "";
  system_cost?: number | ""; down_payment?: number | "";
  install_address?: string;
  monthly_income?: number | ""; employment_type?: string;
};

const DOC_CATEGORIES = [
  { value: "borrower_pan",      label: "Borrower PAN",     max: 1 },
  { value: "borrower_aadhaar",  label: "Borrower Aadhaar", max: 5 },
  { value: "borrower_photo",    label: "Borrower Photo",   max: 1 },
  { value: "bank_statement",    label: "Bank Statement",   max: 5 },
  { value: "income_proof",      label: "Income Proof",     max: 5 },
  { value: "electricity_bill",  label: "Electricity Bill", max: 5 },
  { value: "property_doc",      label: "Property Document",max: 5 },
  { value: "quotation",         label: "Solar Quotation",  max: 5 },
  { value: "other",             label: "Other",            max: 5 },
] as const;

type Mode = "create" | "edit";

export default function LoanAppForm({
  epcBusinessId,
  createdBy = "epc",
  existing,
  mode = "create",
}: {
  epcBusinessId: string;
  createdBy?: "epc" | "admin";
  existing?: Partial<Form> & { id?: string };
  mode?: Mode;
}) {
  const router = useRouter();
  const [appId, setAppId] = useState<string | null>(existing?.id ?? null);
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    defaultValues: { ...emptyForm(), ...existing } as Form,
  });

  async function onSubmit(values: Form, submit: boolean) {
    setSaving(true);
    const payload: Record<string, unknown> = {
      epc_business_id: epcBusinessId,
      created_by: createdBy,
      borrower_name: values.borrower_name,
      borrower_mobile: values.borrower_mobile,
      borrower_email: values.borrower_email || null,
      borrower_pan: values.borrower_pan ? values.borrower_pan.toUpperCase() : null,
      borrower_dob: values.borrower_dob || null,
      borrower_address: values.borrower_address || null,
      borrower_pincode: values.borrower_pincode || null,
      borrower_city: values.borrower_city || null,
      borrower_state: values.borrower_state || null,
      loan_amount: values.loan_amount ? Number(values.loan_amount) : null,
      tenure_months: values.tenure_months ? Number(values.tenure_months) : null,
      system_capacity_kw: values.system_capacity_kw ? Number(values.system_capacity_kw) : null,
      system_cost: values.system_cost ? Number(values.system_cost) : null,
      down_payment: values.down_payment ? Number(values.down_payment) : null,
      install_address: values.install_address || null,
      monthly_income: values.monthly_income ? Number(values.monthly_income) : null,
      employment_type: values.employment_type || null,
      status: submit ? "submitted" : "draft",
      submitted_at: submit ? new Date().toISOString() : null,
    };
    let id = appId;
    if (id) {
      const { error } = await supabase().from("epc_applications").update(payload).eq("id", id);
      if (error) { setSaving(false); return alert(error.message); }
    } else {
      const { data, error } = await supabase().from("epc_applications").insert(payload).select("id").single();
      if (error || !data) { setSaving(false); return alert(error?.message || "Create failed"); }
      id = (data as { id: string }).id;
      setAppId(id);
    }
    setSaving(false);
    if (submit) router.push("/dashboard");
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 sm:p-7">
        <h3 className="font-display font-semibold text-[18px] mb-4">Borrower</h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="Name" {...register("borrower_name", { required: "Required" })} error={errors.borrower_name?.message} />
          <Input label="Mobile" inputMode="numeric" maxLength={10}
                 {...register("borrower_mobile", { required: "Required", pattern: { value: MOBILE_RE, message: "Invalid mobile" } })}
                 error={errors.borrower_mobile?.message} />
          <Input label="Email (optional)" {...register("borrower_email", { validate: (v) => !v || EMAIL_RE.test(v) || "Invalid email" })}
                 error={errors.borrower_email?.message} />
          <Input label="PAN (optional)" maxLength={10}
                 {...register("borrower_pan", { validate: (v) => !v || PAN_RE.test(v.toUpperCase()) || "Invalid PAN" })}
                 error={errors.borrower_pan?.message} />
          <Input label="DOB (optional)" type="date" {...register("borrower_dob")} />
          <Input label="Pincode (optional)" maxLength={6}
                 {...register("borrower_pincode", { validate: (v) => !v || PINCODE_RE.test(v) || "6 digits" })}
                 error={errors.borrower_pincode?.message} />
          <Input label="City (optional)" {...register("borrower_city")} />
          <Input label="State (optional)" {...register("borrower_state")} />
          <div className="sm:col-span-2">
            <Input label="Address (optional)" {...register("borrower_address")} />
          </div>
        </div>
      </Card>

      <Card className="p-6 sm:p-7">
        <h3 className="font-display font-semibold text-[18px] mb-4">Loan &amp; system</h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="Loan amount (₹)" type="number" inputMode="numeric"
                 {...register("loan_amount", { required: "Required", min: { value: 1, message: "Must be > 0" } })}
                 error={errors.loan_amount?.message} />
          <Input label="Tenure (months)" type="number" {...register("tenure_months")} />
          <Input label="System capacity (kW)" type="number" step="0.01" {...register("system_capacity_kw")} />
          <Input label="System cost (₹)" type="number" {...register("system_cost")} />
          <Input label="Down payment (₹)" type="number" {...register("down_payment")} />
          <Input label="Install address (optional)" {...register("install_address")} />
        </div>
      </Card>

      <Card className="p-6 sm:p-7">
        <h3 className="font-display font-semibold text-[18px] mb-4">Credit context (optional)</h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="Monthly income (₹)" type="number" {...register("monthly_income")} />
          <Select label="Employment type" placeholder="Select…" options={[
            { value: "salaried", label: "Salaried" },
            { value: "self_employed", label: "Self-Employed" },
            { value: "business", label: "Business" },
          ]} {...register("employment_type")} />
        </div>
      </Card>

      <Card className="p-6 sm:p-7">
        <h3 className="font-display font-semibold text-[18px] mb-2">Documents</h3>
        <p className="text-[12px] text-text-muted mb-4">
          {appId ? "Upload now or after saving as draft." : "Save the form first to enable uploads."}
        </p>
        {appId && (
          <div className="grid gap-5 sm:grid-cols-2">
            {DOC_CATEGORIES.map((c) => (
              <div key={c.value} className="p-4 bg-bg-soft rounded-input border border-line">
                <FileUpload
                  applicationId={appId}
                  table="user_application_docs"
                  category={c.value as any}
                  maxFiles={c.max}
                  uploadedBy={createdBy}
                  label={c.label}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
        <Button type="button" variant="outline" loading={saving} onClick={handleSubmit((v) => onSubmit(v, false))}>
          Save as draft
        </Button>
        <Button type="button" variant="primary" loading={saving} onClick={handleSubmit((v) => onSubmit(v, true))}>
          Submit
        </Button>
      </div>
    </div>
  );
}

function emptyForm(): Form {
  return {
    borrower_name: "", borrower_mobile: "", borrower_email: "", borrower_pan: "",
    borrower_dob: "", borrower_address: "", borrower_pincode: "", borrower_city: "", borrower_state: "",
    loan_amount: "", tenure_months: "", system_capacity_kw: "", system_cost: "", down_payment: "",
    install_address: "", monthly_income: "", employment_type: "",
  };
}
