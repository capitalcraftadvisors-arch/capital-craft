"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Card from "@/components/ui/Card";
import FieldGroup from "@/components/ui/FieldGroup";
import OcrStatus from "@/components/ui/OcrStatus";
import WizardProgress from "@/components/WizardProgress";
import FileUpload from "@/components/FileUpload";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { extractPan, extractGstLegalName } from "@/lib/ocr";
import { PAN_RE } from "@/lib/validators";

type SuryaGhar = "yes" | "no" | "other" | "";
type OcrState = null | { state: "reading" | "success" | "warn" | "error"; text: string };

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

type Form = {
  business_type: "proprietorship" | "pvt_ltd" | "partnership" | "llp" | "";
  pan_number: string;
  legal_name: string;
  trade_name: string;
  gstin_number: string;
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

// ── Icons (inline SVG) ──────────────────────────────────────────────
const IconBriefcase = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);
const IconSun = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);
const IconIdCard = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="9" cy="12" r="2" /><path d="M14 10h5M14 14h5M6 16.5a3 3 0 0 1 6 0" />
  </svg>
);
const IconReceipt = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 2h16v20l-4-2-4 2-4-2-4 2V2z" /><path d="M8 7h8M8 11h8M8 15h5" />
  </svg>
);
const IconHash = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </svg>
);
const IconTag = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12 12 4H4v8l8 8 8-8z" /><circle cx="7.5" cy="7.5" r="1.5" />
  </svg>
);

export default function Step2Page() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [panOcr, setPanOcr] = useState<OcrState>(null);
  const [gstOcr, setGstOcr] = useState<OcrState>(null);

  const {
    register, handleSubmit, reset, watch, setValue,
    formState: { errors },
  } = useForm<Form>({
    defaultValues: {
      business_type: "",
      pan_number: "",
      legal_name: "",
      trade_name: "",
      gstin_number: "",
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
          "business_type, pan_number, legal_name, trade_name, gstin_number, pm_surya_ghar, pm_surya_ghar_other",
        )
        .eq("id", biz.id)
        .maybeSingle();
      reset({
        business_type: (data?.business_type as Form["business_type"]) ?? "",
        pan_number: data?.pan_number ?? "",
        legal_name: data?.legal_name ?? "",
        trade_name: data?.trade_name ?? "",
        gstin_number: data?.gstin_number ?? "",
        pm_surya_ghar: ((data?.pm_surya_ghar as SuryaGhar) ?? "") as SuryaGhar,
        pm_surya_ghar_other: data?.pm_surya_ghar_other ?? "",
      });
    })();
  }, [reset]);

  async function handlePanUploaded({ file }: { file: File }) {
    setPanOcr({ state: "reading", text: "Reading your PAN card…" });
    const r = await extractPan(file);
    if (!r.ok) {
      setPanOcr({ state: "error", text: "Couldn't read the PAN automatically — please type the number below." });
      return;
    }
    if (r.pan) {
      setValue("pan_number", r.pan, { shouldValidate: true });
      setPanOcr({ state: "success", text: "PAN number auto-filled from your card. Please verify below." });
    } else {
      setPanOcr({ state: "warn", text: "We read the card but couldn't detect a PAN number — please type it below." });
    }
  }

  async function handleGstUploaded({ docId, file }: { docId: string; storagePath: string; file: File }) {
    setGstOcr({ state: "reading", text: "Reading your GST registration…" });
    const r = await extractGstLegalName(file);
    if (!r.ok) {
      setGstOcr({ state: "error", text: "Couldn't read the GST document automatically — please fill the fields below." });
      return;
    }
    if (r.legal_name) setValue("legal_name", r.legal_name, { shouldValidate: true });
    if (r.trade_name) setValue("trade_name", r.trade_name, { shouldValidate: true });
    if (r.gstin)      setValue("gstin_number", r.gstin,      { shouldValidate: true });

    // Persist OCR audit trail on the gstin doc row for future debugging.
    try {
      await supabase()
        .from("epc_documents")
        .update({
          metadata: {
            ocr_raw_text: r.raw_text ?? null,
            gstin: r.gstin ?? null,
            legal_name: r.legal_name ?? null,
            trade_name: r.trade_name ?? null,
          },
        })
        .eq("id", docId);
    } catch (e) {
      console.warn("[step-2] gstin metadata write failed:", e);
    }

    const filled: string[] = [];
    if (r.legal_name) filled.push("legal name");
    if (r.trade_name) filled.push("trade name");
    if (r.gstin)      filled.push("GSTIN");
    if (filled.length > 0) {
      setGstOcr({
        state: "success",
        text: `${cap(filled.join(", "))} auto-filled from your document. Please verify below.`,
      });
    } else {
      setGstOcr({
        state: "warn",
        text: "We read the document but couldn't detect the fields — please type them below.",
      });
    }
  }

  async function onSubmit(values: Form) {
    const biz = getBusiness();
    if (!biz) return;
    if (!values.business_type) return alert("Please pick a business type.");

    const isDraft = biz.status === "draft";

    // ── Draft-only required checks. Legacy/self-edit never re-checked. ──
    if (isDraft) {
      // GST doc present
      const { data: gstDocs } = await supabase()
        .from("epc_documents")
        .select("id")
        .eq("business_id", biz.id)
        .eq("category", "gstin")
        .limit(1);
      if (!gstDocs || gstDocs.length === 0) {
        return alert("Please upload the GST registration document to continue.");
      }
      // PAN card doc present
      const { data: panDocs } = await supabase()
        .from("epc_documents")
        .select("id")
        .eq("business_id", biz.id)
        .eq("category", "pan_business")
        .limit(1);
      if (!panDocs || panDocs.length === 0) {
        return alert("Please upload the PAN card to continue.");
      }
      // Legal + trade + GSTIN fields
      if (!values.legal_name.trim()) return alert("Please enter the Legal name.");
      if (!values.trade_name.trim()) return alert("Please enter the Trade name.");
      if (!values.gstin_number.trim()) return alert("Please enter the GSTIN.");
      if (!GSTIN_RE.test(values.gstin_number.trim().toUpperCase())) {
        return alert("The GSTIN doesn't look valid (expected 15 characters, e.g. 08ATMPS8478D1ZY).");
      }
      // PM Surya Ghar
      if (!values.pm_surya_ghar) return alert("Please answer the PM Surya Ghar question.");
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
        trade_name: values.trade_name.trim() || null,
        gstin_number: values.gstin_number.trim().toUpperCase() || null,
        pm_surya_ghar: values.pm_surya_ghar || null,
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
          Tell us about your EPC entity. {isDraft ? "PAN and GST documents are required." : "Document uploads are optional."}
        </p>
      </div>

      <Card className="p-6 sm:p-7">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* 1. Business type */}
          <Select
            label="Business type"
            placeholder="Select…"
            options={BUSINESS_OPTIONS}
            leftIcon={IconBriefcase}
            {...register("business_type", { required: "Pick a business type" })}
            error={errors.business_type?.message}
          />

          {/* 2. PM Surya Ghar */}
          <Select
            label="Are you registered with PM Surya Ghar?"
            placeholder="Select…"
            options={SURYA_GHAR_OPTIONS}
            leftIcon={IconSun}
            {...register("pm_surya_ghar", {
              required: isDraft ? "Please answer this question" : false,
            })}
            error={errors.pm_surya_ghar?.message}
          />
          {suryaGhar === "other" && (
            <Input
              label="Which entity are you registered with?"
              placeholder="Entity name"
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

          {/* 3. PAN GROUP — upload on top, number below, one highlighted box. */}
          {businessId && (
            <FieldGroup
              title="PAN card"
              subtitle="We'll read your PAN number from the card automatically."
              leftIcon={IconIdCard}
              required={isDraft}
            >
              <FileUpload
                businessId={businessId}
                table="epc_documents"
                category="pan_business"
                maxFiles={1}
                label={isDraft ? "Upload PAN card (required)" : "Upload PAN card"}
                onUploaded={handlePanUploaded}
              />
              {panOcr && <OcrStatus state={panOcr.state}>{panOcr.text}</OcrStatus>}
              <Input
                label="PAN number"
                placeholder="ABCDE1234F"
                maxLength={10}
                leftIcon={IconHash}
                {...register("pan_number", {
                  required: isDraft ? "PAN is required" : false,
                  pattern: { value: PAN_RE, message: "Invalid PAN format (AAAAA9999A)" },
                  onChange: (e) => setValue("pan_number", e.target.value.toUpperCase()),
                })}
                error={errors.pan_number?.message}
                hint="Auto-filled from the card. Edit if needed."
              />
            </FieldGroup>
          )}

          {/* 4. GST GROUP — upload on top, then Legal + Trade + GSTIN. */}
          {businessId && (
            <FieldGroup
              title="GST registration"
              subtitle="We'll read the Legal name, Trade name, and GSTIN from your document."
              leftIcon={IconReceipt}
              required={isDraft}
            >
              <FileUpload
                businessId={businessId}
                table="epc_documents"
                category="gstin"
                maxFiles={1}
                label={isDraft ? "Upload GST registration document (required)" : "Upload GST registration document"}
                onUploaded={handleGstUploaded}
              />
              {gstOcr && <OcrStatus state={gstOcr.state}>{gstOcr.text}</OcrStatus>}
              <Input
                label={isDraft ? "Legal name of business (required)" : "Legal name of business"}
                placeholder="e.g. Acme Solar Pvt Ltd"
                leftIcon={IconTag}
                {...register("legal_name", {
                  required: isDraft ? "Legal name is required" : false,
                  maxLength: { value: 120, message: "Too long" },
                })}
                error={errors.legal_name?.message}
              />
              <Input
                label={isDraft ? "Trade name (required)" : "Trade name (optional)"}
                placeholder="e.g. Acme Solar"
                leftIcon={IconTag}
                {...register("trade_name", {
                  required: isDraft ? "Trade name is required" : false,
                  maxLength: { value: 120, message: "Too long" },
                })}
                error={errors.trade_name?.message}
              />
              <Input
                label={isDraft ? "GSTIN (required)" : "GSTIN"}
                placeholder="08ATMPS8478D1ZY"
                maxLength={15}
                leftIcon={IconHash}
                {...register("gstin_number", {
                  required: isDraft ? "GSTIN is required" : false,
                  validate: (v) => {
                    if (!isDraft && !v) return true;
                    if (!v) return "GSTIN is required";
                    if (!GSTIN_RE.test(v.trim().toUpperCase())) return "Invalid GSTIN (15 chars)";
                    return true;
                  },
                  onChange: (e) => setValue("gstin_number", e.target.value.toUpperCase()),
                })}
                error={errors.gstin_number?.message}
                hint="Auto-filled from the GST document."
              />
            </FieldGroup>
          )}

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

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
