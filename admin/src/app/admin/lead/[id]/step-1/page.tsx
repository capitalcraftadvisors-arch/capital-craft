"use client";

// Lead onboarding — Step 1 of 2 (contact details). Admin-only. Operates on a
// `loan_leads` draft row created by the "Add lead" button; updates it in place
// and advances to Step 2. Mirrors the loan-app step aesthetic (Card + brand).

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import { supabase } from "@/lib/supabase";

// dob column is a DATE (ISO); DatePicker speaks "DD/MM/YYYY".
function isoToDisplay(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
function displayToIso(d: string): string | null {
  const m = d.match(/^([0-3]?\d)\/([01]?\d)\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export default function LeadStep1Page() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [displayId, setDisplayId] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [dob, setDob] = useState(""); // DD/MM/YYYY
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("loan_leads")
        .select("lead_display_id, name, mobile, address, dob")
        .eq("id", params.id)
        .maybeSingle();
      if (data) {
        const d = data as Record<string, string | null>;
        setDisplayId(d.lead_display_id ?? "");
        setName(d.name ?? "");
        setMobile(d.mobile ?? "");
        setAddress(d.address ?? "");
        setDob(isoToDisplay(d.dob ?? null));
      }
      setLoading(false);
    })();
  }, [params.id]);

  async function saveNext() {
    setErr(null);
    if (!name.trim()) { setErr("Please enter the lead's name."); return; }
    if (!/^\d{10}$/.test(mobile)) { setErr("Enter a valid 10-digit contact number."); return; }
    setSaving(true);
    const { error } = await supabase()
      .from("loan_leads")
      .update({
        name: name.trim(),
        mobile: mobile.trim(),
        address: address.trim() || null,
        dob: dob ? displayToIso(dob) : null,
        current_step: 2,
      })
      .eq("id", params.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    router.push(`/admin/lead/${params.id}/step-2`);
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-text-muted">Loading…</p></main>;
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center">
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#4338ca] hover:opacity-80"
          >
            ← Back to Leads
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-[#4338ca]">
            Step 1 of 2 {displayId && <span className="text-text-muted">· {displayId}</span>}
          </div>
          <h1 className="font-display text-[26px] sm:text-[30px] font-bold text-[#0f3d2e] mt-1">
            New lead — contact details
          </h1>
        </div>

        <Card className="p-6 space-y-4">
          <Input label="Name of lead" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Contact number"
            placeholder="10-digit mobile"
            inputMode="numeric"
            maxLength={10}
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
          />
          <Input label="Address" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <DatePicker label="Date of birth" value={dob} onChange={setDob} />
        </Card>

        {err && <p className="text-[13px] text-red-600">{err}</p>}

        <div className="flex justify-end">
          <Button onClick={() => void saveNext()} loading={saving}>Next →</Button>
        </div>
      </div>
    </main>
  );
}
