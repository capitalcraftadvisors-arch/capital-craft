"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { MOBILE_RE } from "@/lib/validators";

type Ref = { type: "customer" | "supplier"; name: string; mobile: string };

export default function Step6Page() {
  const router = useRouter();
  const [refs, setRefs] = useState<{ customer: Ref; supplier: Ref }>({
    customer: { type: "customer", name: "", mobile: "" },
    supplier: { type: "supplier", name: "", mobile: "" },
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const biz = getBusiness();
    if (!biz) return;
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("business_references")
        .eq("id", biz.id)
        .maybeSingle();
      const arr = (data?.business_references as Ref[] | null) ?? [];
      const c = arr.find((r) => r.type === "customer");
      const s = arr.find((r) => r.type === "supplier");
      setRefs({
        customer: c ?? { type: "customer", name: "", mobile: "" },
        supplier: s ?? { type: "supplier", name: "", mobile: "" },
      });
    })();
  }, []);

  async function advance(_skip: boolean) {
    const biz = getBusiness();
    if (!biz) return;
    setError(null);
    const out: Ref[] = [];
    for (const r of [refs.customer, refs.supplier]) {
      if (r.name.trim() || r.mobile.trim()) {
        if (!r.name.trim() || !MOBILE_RE.test(r.mobile)) {
          setError(`Reference (${r.type}) needs both a name and a valid mobile, or leave both blank.`);
          return;
        }
        out.push({ type: r.type, name: r.name.trim(), mobile: r.mobile });
      }
    }
    setSaving(true);
    await supabase()
      .from("epc_business")
      .update({ business_references: out, current_step: 7 })
      .eq("id", biz.id);
    setSaving(false);
    setBusiness({ ...biz, current_step: 7 });
    router.push("/onboarding/review");
  }

  function update(which: "customer" | "supplier", key: "name" | "mobile", value: string) {
    setRefs((r) => ({ ...r, [which]: { ...r[which], [key]: value } }));
  }

  return (
    <>
      <div className="mb-8"><WizardProgress current={6} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">References</h1>
        <p className="text-text-mid mt-1">Optional. Skip if you don&rsquo;t want to share them right now.</p>
      </div>

      <div className="space-y-5">
        {(["customer", "supplier"] as const).map((which) => (
          <Card key={which} className="p-6 sm:p-7">
            <h3 className="font-display font-semibold text-[18px] capitalize mb-4">
              {which} reference
            </h3>
            <div className="grid gap-5 sm:grid-cols-2">
              <Input
                label="Name"
                value={refs[which].name}
                onChange={(e) => update(which, "name", e.target.value)}
              />
              <Input
                label="Mobile"
                inputMode="numeric"
                maxLength={10}
                value={refs[which].mobile}
                onChange={(e) => update(which, "mobile", e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </Card>
        ))}
      </div>

      {error && <p className="mt-4 text-[13px] text-red-500">{error}</p>}

      <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
        <Button type="button" variant="outline" onClick={() => advance(true)} loading={saving}>Skip</Button>
        <Button type="button" variant="primary" onClick={() => advance(false)} loading={saving}>Save & continue</Button>
      </div>
    </>
  );
}
