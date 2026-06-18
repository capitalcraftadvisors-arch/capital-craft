"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PAN_RE } from "@/lib/validators";

type BizFull = {
  contact_name: string | null;
  contact_mobile: string | null;
  contact_designation: string | null;
  business_type: string | null;
  pan_number: string | null;
  stakeholders: { id: string; name: string; designation: string }[] | null;
  business_references: { type: string; name: string; mobile: string }[] | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_branch: string | null;
  bank_account_holder: string | null;
};

export default function ReviewPage() {
  const router = useRouter();
  const [biz, setBiz] = useState<BizFull | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const b = getBusiness();
    if (!b) return;
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select(
          "contact_name, contact_mobile, contact_designation, business_type, pan_number, stakeholders, business_references, bank_account_number, bank_ifsc, bank_branch, bank_account_holder",
        )
        .eq("id", b.id)
        .maybeSingle();
      setBiz(data as BizFull);
    })();
  }, []);

  function missingRequired(b: BizFull): string[] {
    const out: string[] = [];
    if (!b.contact_name?.trim()) out.push("Contact name");
    if (!b.contact_mobile?.trim()) out.push("Mobile");
    if (!b.contact_designation?.trim()) out.push("Designation");
    if (!b.business_type) out.push("Business type");
    if (!b.pan_number || !PAN_RE.test(b.pan_number)) out.push("Valid PAN");
    const sh = b.stakeholders ?? [];
    const validSH = sh.filter((s) => s.name?.trim() && s.designation?.trim());
    if (validSH.length === 0) out.push("At least one member");
    return out;
  }

  async function submit() {
    if (!biz) return;
    const missing = missingRequired(biz);
    if (missing.length) {
      alert(`Please complete: ${missing.join(", ")}.`);
      return;
    }
    const b = getBusiness();
    if (!b) return;
    setSubmitting(true);
    const { error } = await supabase()
      .from("epc_business")
      .update({ status: "under_review", submitted_at: new Date().toISOString() })
      .eq("id", b.id);
    setSubmitting(false);
    if (error) return alert(error.message);
    setBusiness({ ...b, status: "under_review" });
    router.push("/status");
  }

  if (!biz) {
    return <p className="text-text-muted">Loading…</p>;
  }

  const missing = missingRequired(biz);

  return (
    <>
      <div className="mb-8"><WizardProgress current={7} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">Review &amp; submit</h1>
        <p className="text-text-mid mt-1">
          Check everything before you send your profile for verification.
        </p>
      </div>

      {missing.length > 0 && (
        <Card className="p-5 mb-5 border-red-200 bg-red-50">
          <p className="text-[13px] text-red-700">
            Missing required fields: {missing.join(", ")}.
          </p>
        </Card>
      )}

      <div className="space-y-5">
        <Section title="Personal">
          <Row k="Name" v={biz.contact_name} />
          <Row k="Mobile" v={biz.contact_mobile} />
          <Row k="Designation" v={biz.contact_designation} />
        </Section>

        <Section title="Business">
          <Row k="Type" v={biz.business_type} />
          <Row k="PAN" v={biz.pan_number} />
        </Section>

        <Section title="Members">
          {(biz.stakeholders ?? []).length === 0 ? <Empty /> : (biz.stakeholders ?? []).map((s) => (
            <Row key={s.id} k={s.name} v={s.designation} />
          ))}
        </Section>

        <Section title="Bank">
          <Row k="Account" v={biz.bank_account_number} />
          <Row k="IFSC" v={biz.bank_ifsc} />
          <Row k="Branch" v={biz.bank_branch} />
          <Row k="Holder" v={biz.bank_account_holder} />
        </Section>

        <Section title="References">
          {(biz.business_references ?? []).length === 0 ? <Empty /> : (biz.business_references ?? []).map((r, i) => (
            <Row key={i} k={`${r.type} — ${r.name}`} v={r.mobile} />
          ))}
        </Section>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
        <Button type="button" variant="outline" onClick={() => router.push("/onboarding/step-1")}>
          Edit details
        </Button>
        <Button type="button" variant="grad" loading={submitting} onClick={submit}>
          Submit for verification
        </Button>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h3 className="font-display font-semibold text-[16px] mb-3">{title}</h3>
      <dl className="grid gap-1.5">{children}</dl>
    </Card>
  );
}
function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex gap-4 text-[13px]">
      <dt className="text-text-muted min-w-[100px]">{k}</dt>
      <dd className="text-text">{v || <span className="text-text-muted">—</span>}</dd>
    </div>
  );
}
function Empty() { return <p className="text-[13px] text-text-muted">Nothing added.</p>; }
