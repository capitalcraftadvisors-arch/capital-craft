"use client";

// EPC onboarding chat · the references dock (Step 6): customer + supplier
// references and "How did they hear about us?".

import { useState } from "react";
import { REFERRAL_OPTIONS, type EpcReference as Ref } from "@/lib/epc-stakeholders";

// ── References dock — mirrors classic onboarding step-6. ──
function seedRefs(init: Ref[], type: Ref["type"]): Ref[] {
  return init.length ? init : [{ type, name: "", mobile: "" }, { type, name: "", mobile: "" }];
}
export default function ReferencesDock({ initCustomers, initSuppliers, initReferral, initReferralOther, onContinue }: {
  initCustomers: Ref[]; initSuppliers: Ref[]; initReferral: string; initReferralOther: string;
  onContinue: (p: { references: Ref[]; referral_source: string; referral_source_other: string }) => void;
}) {
  const [customers, setCustomers] = useState<Ref[]>(() => seedRefs(initCustomers, "customer"));
  const [suppliers, setSuppliers] = useState<Ref[]>(() => seedRefs(initSuppliers, "supplier"));
  const [referral, setReferral] = useState(initReferral);
  const [referralOther, setReferralOther] = useState(initReferralOther);

  function upd(which: Ref["type"], i: number, key: "name" | "mobile", value: string) {
    const setter = which === "customer" ? setCustomers : setSuppliers;
    setter((arr) => arr.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }
  function add(which: Ref["type"]) {
    const setter = which === "customer" ? setCustomers : setSuppliers;
    setter((arr) => [...arr, { type: which, name: "", mobile: "" }]);
  }
  function remove(which: Ref["type"], i: number) {
    const setter = which === "customer" ? setCustomers : setSuppliers;
    setter((arr) => arr.filter((_, idx) => idx !== i));
  }
  function cont() {
    const clean = (arr: Ref[], t: Ref["type"]) => arr.filter((r) => r.name.trim() || r.mobile.trim()).map((r) => ({ type: t, name: r.name.trim(), mobile: r.mobile.trim() }));
    onContinue({ references: [...clean(customers, "customer"), ...clean(suppliers, "supplier")], referral_source: referral, referral_source_other: referralOther.trim() });
  }

  return (
    <div className="flex flex-col gap-3 max-h-[56vh] overflow-y-auto pr-0.5">
      <RefBlock title="Customer references" which="customer" refs={customers} onUpd={upd} onAdd={add} onRemove={remove} />
      <RefBlock title="Supplier references" which="supplier" refs={suppliers} onUpd={upd} onAdd={add} onRemove={remove} />
      <div>
        <div className="text-[12px] text-text-muted mb-1">How did they hear about us?</div>
        <select value={referral} onChange={(e) => setReferral(e.target.value)} className="w-full border border-line rounded-lg px-2.5 py-2 text-[13px] bg-white outline-none focus:border-[#185fa5]">
          <option value="">Select…</option>
          {REFERRAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {referral === "others" && <input value={referralOther} onChange={(e) => setReferralOther(e.target.value)} placeholder="Please specify" className="mt-2 w-full border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />}
      </div>
      <button onClick={cont} className="self-end px-4 py-2 rounded-lg bg-[#185fa5] text-white text-[13px] font-semibold hover:bg-[#124a82]">Save references & continue →</button>
    </div>
  );
}
function RefBlock({ title, which, refs, onUpd, onAdd, onRemove }: {
  title: string; which: Ref["type"]; refs: Ref[];
  onUpd: (w: Ref["type"], i: number, k: "name" | "mobile", v: string) => void; onAdd: (w: Ref["type"]) => void; onRemove: (w: Ref["type"], i: number) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="text-[13px] font-semibold text-text mb-2">{title}</div>
      <div className="flex flex-col gap-2">
        {refs.map((r, i) => (
          <div key={i} className="grid grid-cols-2 gap-2">
            <input value={r.name} onChange={(e) => onUpd(which, i, "name", e.target.value)} placeholder="Name" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <div className="flex items-center gap-1">
              <input value={r.mobile} onChange={(e) => onUpd(which, i, "mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="Mobile" className="flex-1 border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
              {refs.length > 2 && <button onClick={() => onRemove(which, i)} className="text-text-muted hover:text-red-500 text-[15px] px-1">×</button>}
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => onAdd(which)} className="mt-2 text-[12px] font-semibold text-[#185fa5] hover:underline">+ Add {which} reference</button>
    </div>
  );
}
