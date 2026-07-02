"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import GeoOfficeUpload from "@/components/GeoOfficeUpload";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// Step 5 — Office verification.
//
// New-onboarding (status='draft') rules:
//   - ALL THREE photos required: exterior, interior, selfie.
//   - No Skip button.
// Legacy / self-edit EPCs remain optional (Skip enabled).
//
// Photos must be geo-tagged (unchanged): live GPS via camera capture, or
// EXIF-GPS via file upload; photos without location are rejected.

type BusinessType = "proprietorship" | "pvt_ltd" | "partnership" | "llp" | null;

function selfieLabel(bt: BusinessType): string {
  switch (bt) {
    case "proprietorship":         return "Selfie of proprietor at office";
    case "partnership":
    case "llp":                    return "Selfie of at least 1 partner at office";
    case "pvt_ltd":                return "Selfie of at least 1 director at office";
    default:                       return "Selfie of at least 1 partner or at least 1 director at office";
  }
}

export default function Step5Page() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessType, setBusinessType] = useState<BusinessType>(null);
  const [saving, setSaving] = useState(false);

  const isDraft = getBusiness()?.status === "draft";

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    setBusinessId(biz.id);
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("business_type")
        .eq("id", biz.id)
        .maybeSingle();
      setBusinessType((data?.business_type as BusinessType) ?? null);
    })();
  }, []);

  async function missingPhotos(): Promise<string[]> {
    if (!businessId) return [];
    const { data } = await supabase()
      .from("epc_documents")
      .select("category")
      .eq("business_id", businessId)
      .in("category", ["office_exterior", "office_interior", "office_selfie"]);
    const have = new Set((data ?? []).map((d) => (d as { category: string }).category));
    const missing: string[] = [];
    if (!have.has("office_exterior")) missing.push("Exterior photo");
    if (!have.has("office_interior")) missing.push("Interior photo");
    if (!have.has("office_selfie"))   missing.push("Selfie at office");
    return missing;
  }

  async function advance() {
    const biz = getBusiness();
    if (!biz) return;
    if (isDraft) {
      const missing = await missingPhotos();
      if (missing.length > 0) {
        alert("Please upload the following photos:\n\n" + missing.join("\n"));
        return;
      }
    }
    setSaving(true);
    await supabase().from("epc_business").update({ current_step: 6 }).eq("id", biz.id);
    setSaving(false);
    setBusiness({ ...biz, current_step: 6 });
    router.push("/onboarding/step-6");
  }

  async function skip() {
    const biz = getBusiness();
    if (!biz) return;
    setSaving(true);
    await supabase().from("epc_business").update({ current_step: 6 }).eq("id", biz.id);
    setSaving(false);
    setBusiness({ ...biz, current_step: 6 });
    router.push("/onboarding/step-6");
  }

  const selfie = selfieLabel(businessType);

  return (
    <>
      <button
        type="button"
        onClick={() => router.push("/onboarding/step-4" as any)}
        className="inline-flex items-center gap-1 text-[13px] text-text-mid hover:text-text mb-4"
      >
        <span aria-hidden>←</span> Back
      </button>
      <div className="mb-8"><WizardProgress current={5} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">Office verification</h1>
        <p className="text-text-mid mt-1">
          {isDraft
            ? "Upload all three photos below. Each photo must be geo-tagged."
            : "Update your office photos as needed. Each photo must be geo-tagged."}
        </p>
      </div>

      <div className="mb-5 px-4 py-3 rounded-input bg-blue-50 border border-blue/15 text-[13px] text-text-mid">
        <p className="font-medium text-text mb-1">Office photos must be geo-tagged.</p>
        <p>
          Use your device camera to capture your location automatically, or upload an image
          that already contains location metadata. Photos without a location cannot be accepted.
        </p>
      </div>

      {businessId && (
        <div className="grid gap-5 sm:grid-cols-3">
          <Card className="p-5">
            <GeoOfficeUpload
              businessId={businessId}
              category="office_exterior"
              label="Exterior photo (signboard should be visible)"
            />
          </Card>
          <Card className="p-5">
            <GeoOfficeUpload
              businessId={businessId}
              category="office_interior"
              label="Interior photo"
            />
          </Card>
          <Card className="p-5">
            <GeoOfficeUpload
              businessId={businessId}
              category="office_selfie"
              label={selfie}
            />
          </Card>
        </div>
      )}

      <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
        {!isDraft && (
          <Button type="button" variant="outline" onClick={skip} loading={saving}>Skip</Button>
        )}
        <Button type="button" variant="primary" onClick={advance} loading={saving}>Save & continue</Button>
      </div>
    </>
  );
}
