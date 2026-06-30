"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import FileUpload from "@/components/FileUpload";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type BusinessType = "proprietorship" | "pvt_ltd" | "partnership" | "llp" | null;
type Gps = { lat: number; lng: number; captured_at: string };

function selfieLabel(bt: BusinessType): string {
  switch (bt) {
    case "proprietorship":         return "Selfie of Proprietor at office";
    case "partnership":
    case "llp":                    return "Selfie of Partner 1 at office";
    case "pvt_ltd":                return "Selfie of Director at office";
    default:                       return "Selfie at office";
  }
}

export default function Step5Page() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessType, setBusinessType] = useState<BusinessType>(null);
  const [saving, setSaving] = useState(false);
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsState, setGpsState] = useState<"idle" | "capturing" | "denied" | "unsupported">("idle");

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

  function captureLocation() {
    if (!("geolocation" in navigator)) {
      setGpsState("unsupported");
      return;
    }
    setGpsState("capturing");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGps({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          captured_at: new Date().toISOString(),
        });
        setGpsState("idle");
      },
      () => setGpsState("denied"),
      { timeout: 8000, enableHighAccuracy: true },
    );
  }

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
  const extraMeta = gps ? { gps } : undefined;

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
          Three photos, all optional. Tap “Add location” once to tag every upload below with your office GPS.
        </p>
      </div>

      {/* Optional one-tap geo-tag */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <Button
          type="button"
          variant={gps ? "outline" : "primary"}
          onClick={captureLocation}
          loading={gpsState === "capturing"}
        >
          {gps ? "Re-capture location" : "Add location (optional)"}
        </Button>
        {gps && (
          <span className="text-[12px] text-text-mid">
            Location captured · {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
          </span>
        )}
        {gpsState === "denied" && (
          <span className="text-[12px] text-red-500">
            Location permission denied — you can still upload without it.
          </span>
        )}
        {gpsState === "unsupported" && (
          <span className="text-[12px] text-red-500">
            Geolocation not available on this device.
          </span>
        )}
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
              extraMetadata={extraMeta}
            />
          </Card>
          <Card className="p-5">
            <FileUpload
              businessId={businessId}
              table="epc_documents"
              category="office_interior"
              maxFiles={1}
              label="Interior"
              extraMetadata={extraMeta}
            />
          </Card>
          <Card className="p-5">
            <FileUpload
              businessId={businessId}
              table="epc_documents"
              category="office_selfie"
              maxFiles={1}
              label={selfie}
              extraMetadata={extraMeta}
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
