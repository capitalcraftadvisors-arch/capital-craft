"use client";

// Insurance — Step 2: three geo-tagged photos + plant address + invoice.
//
// The three photos (customer with panel / inverter / meter) reuse
// GeoOfficeUpload in UPLOAD-ONLY mode — no live camera. Each one must prove a
// location: the EXIF GPS is read off the ORIGINAL file client-side (before the
// server compresses it, which would strip EXIF), falling back to OCR of a
// burned-in GPS-camera stamp. No location → the upload is rejected with the
// same message as the loan/office photos.
//
// The invoice ("Final Invoice / Commission Certificate") is OCR'd for its final
// amount; the EPC re-enters it to confirm, mirroring the cheque reconfirm. That
// confirmed amount is what becomes Sum Insured.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import GeoOfficeUpload from "@/components/GeoOfficeUpload";
import InsuranceUpload from "@/components/InsuranceUpload";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
import InsuranceStepHeader from "@/components/InsuranceStepHeader";

type App = Record<string, any>;
type Gps = { lat: number; lng: number; captured_at: string };
type PhotoKind = "panel" | "inverter" | "meter";

// The three required site photos, in order.
const PHOTOS: { kind: PhotoKind; label: string; gpsCol: string }[] = [
  { kind: "panel",    label: "Customer with panel",    gpsCol: "photo_panel_gps" },
  { kind: "inverter", label: "Customer with inverter", gpsCol: "photo_inverter_gps" },
  { kind: "meter",    label: "Customer with meter",    gpsCol: "photo_meter_gps" },
];

function fmtRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
}

export default function InsuranceStep2() {
  return (
    <AuthGuard allow={["approved", "admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [app, setApp] = useState<App | null>(null);
  const [address, setAddress] = useState("");
  const [ocrAmount, setOcrAmount] = useState<number | null>(null);
  const [invoiceDone, setInvoiceDone] = useState(false);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [saving, setSaving] = useState(false);
  // Which of the three photos are in place.
  const [photos, setPhotos] = useState<Record<PhotoKind, boolean>>({ panel: false, inverter: false, meter: false });

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().from("insurance_applications").select("*").eq("id", params.id).maybeSingle();
      setApp(data);
      if (data?.plant_address) setAddress(data.plant_address);
      if (data?.invoice_amount != null) { setOcrAmount(Number(data.invoice_amount)); setInvoiceDone(!!data.invoice_path); }
      if (data?.invoice_confirmed_amount != null) setConfirmAmount(String(data.invoice_confirmed_amount));
      setPhotos({
        panel: !!data?.photo_panel_path,
        inverter: !!data?.photo_inverter_path,
        meter: !!data?.photo_meter_path,
      });
    })();
  }, [params.id]);

  // uploadFn per photo: GeoOfficeUpload has already proven + captured the GPS;
  // we just post the file + coords to the insurance upload route.
  function uploadPhoto(kind: PhotoKind) {
    return async (file: File, gps: Gps): Promise<{ ok: boolean; error?: string }> => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      fd.append("gps", JSON.stringify(gps));
      const res = await fetch(`/api/epc/insurance/${params.id}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) return { ok: false, error: d?.error || `Upload failed (HTTP ${res.status}).` };
      setPhotos((p) => ({ ...p, [kind]: true }));
      return { ok: true };
    };
  }

  const confirmNum = confirmAmount.trim() === "" ? null : Number(confirmAmount.replace(/[^\d.]/g, ""));
  const amountMismatch = ocrAmount != null && confirmNum != null && Math.round(confirmNum) !== Math.round(ocrAmount);

  async function saveContinue() {
    if (saving) return;
    const missing = PHOTOS.filter((p) => !photos[p.kind]).map((p) => p.label);
    if (missing.length) { alert("Please add these geo-tagged photos:\n\n" + missing.join("\n")); return; }
    if (!address.trim()) { alert("Please enter the plant address."); return; }
    if (!invoiceDone) { alert("Please upload the invoice."); return; }
    if (confirmNum == null || confirmNum <= 0) { alert("Please confirm the invoice amount."); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/epc/insurance/${params.id}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ step: 2, plant_address: address.trim(), invoice_confirmed_amount: confirmNum }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) { alert("Couldn't save: " + (d?.error || res.status)); return; }
      router.push(`/dashboard/insurance/${params.id}/step-3` as any);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <InsuranceStepHeader step={2} />
      <section className="max-w-2xl mx-auto px-5 sm:px-7 py-8">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold text-[#0f3d2e] mb-1">Plant &amp; invoice</h1>
        <p className="text-text-mid mb-6">Three geo-tagged site photos, the plant address, and the final invoice.</p>

        <div className="space-y-5">
          <Card className="p-6">
            <p className="text-[13px] font-semibold text-[#0f3d2e] mb-1">Site photos (all three required)</p>
            <p className="text-[12px] text-text-muted mb-4">
              Each photo must carry a location — taken with location on, or a GPS-camera stamp.
            </p>
            <div className="space-y-5">
              {PHOTOS.map((p) => (
                <GeoOfficeUpload
                  key={p.kind}
                  category={`insurance_photo_${p.kind}`}
                  label={p.label}
                  uploadOnly
                  uploadFn={uploadPhoto(p.kind)}
                  initialGps={(app?.[p.gpsCol] as Gps | null) ?? null}
                />
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <Input label="Plant address" placeholder="Where the plant is installed" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Card>

          <Card className="p-6">
            <InsuranceUpload
              endpoint={`/api/epc/insurance/${params.id}/extract-invoice`}
              label="Final Invoice / Commission Certificate (required)"
              hint="We'll read the final invoice amount — please confirm it below. This becomes the sum insured."
              initiallyDone={invoiceDone}
              onDone={(d) => { setOcrAmount((d.amount as number) ?? null); setInvoiceDone(true); }}
            />
            {invoiceDone && (
              <div className="mt-4 grid sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-[12px] text-text-muted mb-1">Detected amount</p>
                  <div className="border border-line rounded-input px-3.5 py-2.5 text-[15px] bg-[#f7fcfa] text-[#0f3d2e] font-semibold">
                    {fmtRupees(ocrAmount)}
                  </div>
                </div>
                <Input
                  label="Confirm invoice amount"
                  inputMode="decimal"
                  placeholder="Re-enter the amount"
                  value={confirmAmount}
                  onChange={(e) => setConfirmAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  error={amountMismatch ? "Doesn't match the detected amount — check the invoice." : undefined}
                  hint={!amountMismatch && confirmNum != null ? "Confirmed." : undefined}
                />
              </div>
            )}
          </Card>
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="outline" onClick={() => router.push(`/dashboard/insurance/${params.id}/step-1` as any)}>Back</Button>
          <Button variant="primary" onClick={() => void saveContinue()} loading={saving}>Save &amp; continue</Button>
        </div>
      </section>
    </main>
  );
}
