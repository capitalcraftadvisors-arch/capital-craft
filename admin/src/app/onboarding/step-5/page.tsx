"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import FileUpload from "@/components/FileUpload";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function Step5Page() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const biz = getBusiness();
    if (biz) setBusinessId(biz.id);
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
          Three photos, all optional. We&rsquo;ll capture your location when you upload.
        </p>
      </div>

      {businessId && (
        <div className="grid gap-5 sm:grid-cols-3">
          <Card className="p-5">
            <FileUpload
              businessId={businessId}
              table="epc_documents"
              category="office_exterior"
              maxFiles={1}
              label="Exterior (signboard)"
              captureGps
            />
          </Card>
          <Card className="p-5">
            <FileUpload
              businessId={businessId}
              table="epc_documents"
              category="office_interior"
              maxFiles={1}
              label="Interior"
              captureGps
            />
          </Card>
          <Card className="p-5">
            <FileUpload
              businessId={businessId}
              table="epc_documents"
              category="office_selfie"
              maxFiles={1}
              label="Selfie at office"
              captureGps
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
