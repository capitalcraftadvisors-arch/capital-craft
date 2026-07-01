"use client";

// Step 6 — Business references.
//
// Storage shape is UNCHANGED: business_references is a JSONB array of
// { type: 'customer' | 'supplier', name, mobile }. The `type` field
// distinguishes them; we just render two sections and interleave save.
//
// Draft-only floor: at least 2 customer references AND at least 2 supplier
// references must be present with valid name + 10-digit mobile before the
// EPC can advance. Self-edit and legacy EPCs are never retroactively
// blocked (they can still skip Step 6, and existing sub-2 rows survive).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import WizardProgress from "@/components/WizardProgress";
import { getBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { MOBILE_RE } from "@/lib/validators";

type RefType = "customer" | "supplier";
type Ref = { type: RefType; name: string; mobile: string };

function isValid(r: Ref) {
  return !!r.name.trim() && MOBILE_RE.test(r.mobile);
}

export default function Step6Page() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Ref[]>([]);
  const [suppliers, setSuppliers] = useState<Ref[]>([]);
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
      const c = arr.filter((r) => r.type === "customer");
      const s = arr.filter((r) => r.type === "supplier");
      // Seed 2 empty rows per section for new EPCs so the min-2 target
      // is visible up front. Existing rows are preserved.
      setCustomers(c.length > 0 ? c : [emptyRef("customer"), emptyRef("customer")]);
      setSuppliers(s.length > 0 ? s : [emptyRef("supplier"), emptyRef("supplier")]);
    })();
  }, []);

  function emptyRef(t: RefType): Ref {
    return { type: t, name: "", mobile: "" };
  }

  function update(which: RefType, i: number, key: "name" | "mobile", value: string) {
    const setter = which === "customer" ? setCustomers : setSuppliers;
    setter((arr) => {
      const next = [...arr];
      next[i] = { ...next[i], [key]: value };
      return next;
    });
  }

  function add(which: RefType) {
    const setter = which === "customer" ? setCustomers : setSuppliers;
    setter((arr) => [...arr, emptyRef(which)]);
  }

  function remove(which: RefType, i: number) {
    const setter = which === "customer" ? setCustomers : setSuppliers;
    setter((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function advance() {
    const biz = getBusiness();
    if (!biz) return;
    setError(null);

    // Drop fully-empty rows; keep partially-filled rows so we can flag them.
    const filledCust = customers.filter((r) => r.name.trim() || r.mobile.trim());
    const filledSupp = suppliers.filter((r) => r.name.trim() || r.mobile.trim());

    for (const r of [...filledCust, ...filledSupp]) {
      if (!r.name.trim() || !MOBILE_RE.test(r.mobile)) {
        setError(`Each ${r.type} reference needs both a name and a valid 10-digit mobile.`);
        return;
      }
    }

    const isDraft = biz.status === "draft";
    if (isDraft) {
      const validCust = filledCust.filter(isValid).length;
      const validSupp = filledSupp.filter(isValid).length;
      if (validCust < 2) {
        setError("Add at least 2 customer references.");
        return;
      }
      if (validSupp < 2) {
        setError("Add at least 2 supplier references.");
        return;
      }
    }

    const out: Ref[] = [
      ...filledCust.map((r) => ({ type: "customer" as const, name: r.name.trim(), mobile: r.mobile })),
      ...filledSupp.map((r) => ({ type: "supplier" as const, name: r.name.trim(), mobile: r.mobile })),
    ];

    setSaving(true);
    await supabase()
      .from("epc_business")
      .update({ business_references: out, current_step: 7 })
      .eq("id", biz.id);
    setSaving(false);
    setBusiness({ ...biz, current_step: 7 });
    router.push("/onboarding/review");
  }

  const isDraft = getBusiness()?.status === "draft";

  return (
    <>
      <button
        type="button"
        onClick={() => router.push("/onboarding/step-5" as any)}
        className="inline-flex items-center gap-1 text-[13px] text-text-mid hover:text-text mb-4"
      >
        <span aria-hidden>←</span> Back
      </button>
      <div className="mb-8"><WizardProgress current={6} /></div>

      <div className="mb-6">
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold">References</h1>
        <p className="text-text-mid mt-1">
          {isDraft
            ? "Add at least 2 customer references and 2 supplier references."
            : "Update your references as needed."}
        </p>
      </div>

      <RefSection
        title="Customer references"
        which="customer"
        refs={customers}
        onUpdate={(i, k, v) => update("customer", i, k, v)}
        onAdd={() => add("customer")}
        onRemove={(i) => remove("customer", i)}
      />

      <div className="mt-5">
        <RefSection
          title="Supplier references"
          which="supplier"
          refs={suppliers}
          onUpdate={(i, k, v) => update("supplier", i, k, v)}
          onAdd={() => add("supplier")}
          onRemove={(i) => remove("supplier", i)}
        />
      </div>

      {error && <p className="mt-4 text-[13px] text-red-500">{error}</p>}

      <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
        {!isDraft && (
          <Button type="button" variant="outline" onClick={advance} loading={saving}>Skip</Button>
        )}
        <Button type="button" variant="primary" onClick={advance} loading={saving}>Save & continue</Button>
      </div>
    </>
  );
}

function RefSection({
  title, which, refs, onUpdate, onAdd, onRemove,
}: {
  title: string;
  which: RefType;
  refs: Ref[];
  onUpdate: (i: number, key: "name" | "mobile", value: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <Card className="p-6 sm:p-7">
      <h3 className="font-display font-semibold text-[18px] mb-4">{title}</h3>
      <div className="space-y-4">
        {refs.map((r, i) => (
          <div key={i} className="border border-line rounded-input p-3 bg-bg-soft">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[12px] text-text-muted capitalize">{which} {i + 1}</p>
              {refs.length > 2 && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="text-[12px] text-text-muted hover:text-red-500 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Name"
                value={r.name}
                onChange={(e) => onUpdate(i, "name", e.target.value)}
              />
              <Input
                label="Mobile"
                inputMode="numeric"
                maxLength={10}
                value={r.mobile}
                onChange={(e) => onUpdate(i, "mobile", e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Button type="button" variant="outline" onClick={onAdd}>+ Add {which} reference</Button>
      </div>
    </Card>
  );
}
