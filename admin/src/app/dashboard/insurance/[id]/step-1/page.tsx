"use client";

// Insurance — Step 1: PAN + Aadhaar (mandatory), GST (optional).
//
// PAN and Aadhaar are OCR'd server-side (same lib/pan-parser + lib/aadhaar the
// loan flow uses) and their paths + parsed fields are persisted straight onto
// the insurance row by the extract routes. This page just drives the uploads,
// shows what was read, and advances.

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import InsuranceUpload from "@/components/InsuranceUpload";
import InsuranceStepHeader from "@/components/InsuranceStepHeader";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";

type App = Record<string, any>;

export default function InsuranceStep1() {
  return (
    <AuthGuard allow={["approved", "admin"]}>
      <Inner />
    </AuthGuard>
  );
}

// What the OCR read, shown back to the EPC — same idea as the loan Step-2 KYC
// review and the EPC onboarding OCR fields.
type Kyc = {
  name: string | null;
  dob: string | null;
  gender: string | null;
  masked: string | null;
  care_of: string | null;
  address: string | null;
};

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [app, setApp] = useState<App | null>(null);
  const [pan, setPan] = useState<string | null>(null);
  const [panName, setPanName] = useState<string | null>(null);
  const [kyc, setKyc] = useState<Kyc | null>(null);
  const [aadhaarDone, setAadhaarDone] = useState(false);
  const [aadhaarBusy, setAadhaarBusy] = useState(false);
  const [aadhaarErr, setAadhaarErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().from("insurance_applications").select("*").eq("id", params.id).maybeSingle();
      setApp(data);
      if (data?.pan_number) setPan(data.pan_number);
      if (data?.aadhaar_front_path) {
        setAadhaarDone(true);
        setKyc({
          name: data.aadhaar_name ?? null,
          dob: data.aadhaar_dob ?? null,
          gender: data.aadhaar_gender ?? null,
          masked: data.aadhaar_number_masked ?? null,
          care_of: data.aadhaar_care_of ?? null,
          address: data.aadhaar_address ?? null,
        });
      }
    })();
  }, [params.id]);

  async function readAadhaar() {
    const front = frontRef.current?.files?.[0];
    const back = backRef.current?.files?.[0];
    if (!front || !back) { setAadhaarErr("Upload both the front and back of the Aadhaar."); return; }
    setAadhaarBusy(true);
    setAadhaarErr(null);
    try {
      const fd = new FormData();
      fd.append("front", front);
      fd.append("back", back);
      const res = await fetch(`/api/epc/insurance/${params.id}/extract-aadhaar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) { setAadhaarErr(d?.error || `Failed (HTTP ${res.status}).`); return; }
      const f = (d.fields ?? {}) as Record<string, string | null>;
      setKyc({
        name: f.name ?? null,
        dob: f.dob ?? null,
        gender: f.gender ?? null,
        masked: f.aadhaar_masked ?? null,
        care_of: f.care_of ?? null,
        address: f.address ?? null,
      });
      setAadhaarDone(true);
    } catch (e) {
      setAadhaarErr((e as Error).message);
    } finally {
      setAadhaarBusy(false);
    }
  }

  async function saveContinue() {
    if (saving) return;
    if (!pan) { alert("Please upload the PAN card."); return; }
    if (!aadhaarDone) { alert("Please upload and read the Aadhaar (front + back)."); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/epc/insurance/${params.id}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ step: 1 }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) { alert("Couldn't save: " + (d?.error || res.status)); return; }
      router.push(`/dashboard/insurance/${params.id}/step-2` as any);
    } finally {
      setSaving(false);
    }
  }

  const fileCls = "block w-full text-[13px] text-text-mid file:mr-3 file:py-2 file:px-3 file:rounded-input file:border-0 file:bg-[#f0faf5] file:text-[#178a5c] file:font-semibold";

  // One extracted field. Blank values read "—" rather than vanishing, so a
  // gap in the OCR is visible instead of silent.
  function Row({ k, v, mono }: { k: string; v: string | null; mono?: boolean }) {
    return (
      <div className="flex justify-between gap-3 text-[13px] py-[3px]">
        <span className="text-[#5a8a76] shrink-0">{k}</span>
        <span className={["text-right min-w-0 font-medium text-[#0f3d2e]", mono ? "font-mono" : ""].join(" ")}>
          {v || "—"}
        </span>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <InsuranceStepHeader step={1} />
      <section className="max-w-2xl mx-auto px-5 sm:px-7 py-8">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold text-[#0f3d2e] mb-1">Insurance — your details</h1>
        <p className="text-text-mid mb-6">Upload the PAN and Aadhaar. We&rsquo;ll read the details automatically.</p>

        <div className="space-y-5">
          <Card className="p-6">
            <InsuranceUpload
              endpoint={`/api/epc/insurance/${params.id}/extract-pan`}
              label="PAN card (required)"
              hint="JPG, PNG, WEBP or PDF."
              initiallyDone={!!pan}
              onDone={(d) => {
                const f = (d.fields ?? {}) as Record<string, string | null>;
                setPan(f.pan ?? null);
                setPanName(f.name ?? null);
              }}
            />
            {/* What the OCR read back — shown for the EPC to eyeball. */}
            {pan && (
              <div className="mt-3 rounded-input border border-[#cdeadd] bg-[#f7fcfa] p-3">
                <p className="text-[11px] font-semibold text-[#5a8a76] uppercase tracking-wider mb-1.5">Read from PAN</p>
                <Row k="PAN number" v={pan} mono />
                {panName && <Row k="Name" v={panName} />}
              </div>
            )}
          </Card>

          <Card className="p-6">
            <p className="text-[13px] font-medium text-text-mid mb-2">Aadhaar card (required)</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[12px] text-text-muted mb-1">Front</p>
                <input ref={frontRef} type="file" accept="image/*,application/pdf" className={fileCls} />
              </div>
              <div>
                <p className="text-[12px] text-text-muted mb-1">Back</p>
                <input ref={backRef} type="file" accept="image/*,application/pdf" className={fileCls} />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button variant="outline" onClick={() => void readAadhaar()} loading={aadhaarBusy}>
                {aadhaarDone ? "Re-read Aadhaar" : "Read Aadhaar"}
              </Button>
              {aadhaarDone && <span className="text-[12px] text-[#178a5c] font-medium">✓ Details read</span>}
            </div>
            {aadhaarErr && <p className="text-[12px] text-red-500 mt-2">{aadhaarErr}</p>}

            {/* Extracted Aadhaar details, shown back for review. */}
            {kyc && (
              <div className="mt-3 rounded-input border border-[#cdeadd] bg-[#f7fcfa] p-3">
                <p className="text-[11px] font-semibold text-[#5a8a76] uppercase tracking-wider mb-1.5">Read from Aadhaar</p>
                <Row k="Name" v={kyc.name} />
                <Row k="Date of birth" v={kyc.dob} />
                <Row k="Gender" v={kyc.gender} />
                <Row k="Aadhaar number" v={kyc.masked} mono />
                <Row k="Care of" v={kyc.care_of} />
                <Row k="Address" v={kyc.address} />
              </div>
            )}
          </Card>

          <Card className="p-6">
            <InsuranceUpload
              endpoint={`/api/epc/insurance/${params.id}/upload`}
              label="GST certificate (optional)"
              hint="JPG, PNG, WEBP or PDF."
              extra={{ kind: "gst" }}
              initiallyDone={!!app?.gst_path}
            />
          </Card>
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="primary" onClick={() => void saveContinue()} loading={saving}>Save &amp; continue</Button>
        </div>
      </section>
    </main>
  );
}
