"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import GeoOfficeUpload from "@/components/GeoOfficeUpload";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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

  async function advance() {
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
          Three photos, all optional. If you upload one, it must be geo-tagged.
        </p>
      </div>

      {/* Formal notice — sits between heading and the 3 cards. */}
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
        <Button type="button" variant="outline" onClick={advance} loading={saving}>Skip</Button>
        <Button type="button" variant="primary" onClick={advance} loading={saving}>Save & continue</Button>
      </div>
    </>
  );
}
