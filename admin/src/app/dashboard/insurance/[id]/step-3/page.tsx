"use client";

// Insurance — Step 3: Review & Submit. On submit, an attractive thank-you
// takeover (mirrors the loan Step-6 thank-you).

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
import InsuranceStepHeader from "@/components/InsuranceStepHeader";

type App = Record<string, any>;

function fmtRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
}

export default function InsuranceStep3() {
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
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().from("insurance_applications").select("*").eq("id", params.id).maybeSingle();
      setApp(data);
      // Anything past draft has been submitted (status is under_review once
      // submitted, then issued/hold/rejected as the admin works it).
      if (data?.status && data.status !== "draft") setDone(true);
    })();
  }, [params.id]);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/epc/insurance/${params.id}/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) { alert("Couldn't submit: " + (d?.error || res.status)); return; }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-[#f0faf5] to-white grid place-items-center px-5">
        <div className="max-w-md text-center py-16">
          <div className="w-20 h-20 rounded-full bg-[#178a5c] text-white grid place-items-center mx-auto mb-6" style={{ transform: "scale(1.1)" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
          </div>
          <h1 className="font-display text-[28px] font-bold text-[#0f3d2e] mb-2">Thank you!</h1>
          <p className="text-[15px] text-text-mid leading-relaxed">
            Your insurance application{app?.insurance_display_id ? ` (${app.insurance_display_id})` : ""} has been submitted.
            Our team will reach out to you soon.
          </p>
          <div className="mt-8">
            <Button variant="primary" onClick={() => router.push("/dashboard" as any)}>Back to dashboard</Button>
          </div>
        </div>
      </main>
    );
  }

  if (!app) {
    return <main className="min-h-screen grid place-items-center"><p className="text-text-muted">Loading…</p></main>;
  }

  const KV = ({ k, v }: { k: string; v: any }) => (
    <div className="flex justify-between text-[14px] py-1.5 gap-3">
      <span className="text-text-muted shrink-0">{k}</span>
      <span className="text-right font-medium text-[#0f3d2e] min-w-0 truncate">{v || "—"}</span>
    </div>
  );

  return (
    <main className="min-h-screen bg-bg-soft">
      <InsuranceStepHeader step={3} />
      <section className="max-w-2xl mx-auto px-5 sm:px-7 py-8">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold text-[#0f3d2e] mb-1">Review &amp; submit</h1>
        <p className="text-text-mid mb-6">Check the details below, then submit.</p>

        <Card className="p-6 mb-4">
          <p className="text-[13px] font-semibold text-[#178a5c] mb-2">Applicant</p>
          <KV k="PAN" v={app.pan_number} />
          <KV k="Aadhaar name" v={app.aadhaar_name} />
          <KV k="Aadhaar" v={app.aadhaar_number_masked} />
          <KV k="DOB" v={app.aadhaar_dob} />
          <KV k="GST" v={app.gst_path ? "Uploaded" : "—"} />
        </Card>

        <Card className="p-6 mb-4">
          <p className="text-[13px] font-semibold text-[#178a5c] mb-2">Plant &amp; invoice</p>
          <KV k="Plant address" v={app.plant_address} />
          <KV k="Plant photo" v={app.plant_photo_path ? "Geo-tagged · uploaded" : "—"} />
          <KV k="Final invoice amount" v={fmtRupees(app.invoice_confirmed_amount ?? app.invoice_amount)} />
          <KV k="Sum insured" v={fmtRupees(app.sum_insured ?? app.invoice_confirmed_amount)} />
        </Card>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => router.push(`/dashboard/insurance/${params.id}/step-2` as any)}>Back</Button>
          <Button variant="primary" onClick={() => void submit()} loading={submitting}>Submit application</Button>
        </div>
      </section>
    </main>
  );
}
