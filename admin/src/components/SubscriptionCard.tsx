"use client";

// Admin EPC profile → "Subscription" (0128 / 0129): the paid features CC switches
// on for this EPC — WhatsApp (one-tap share, reminders) and Invoices — on a plain
// On / Off switch (the user, 23/11; switched off, old invoices stay downloadable,
// nothing new is made or sent). The main admin changes it; everyone else sees
// where it stands. Reads once, when opened.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { hasFeature, type Feature, type Subscription } from "@/lib/subscription";

const FEATURES: [Feature, string][] = [["whatsapp", "WhatsApp"], ["invoices", "Invoices"]];

export default function SubscriptionCard({ businessId }: { businessId: string }) {
  const admin = isMainAdmin(getBusiness());
  const [sub, setSub] = useState<Subscription | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase().from("epc_subscriptions").select("whatsapp, invoices, valid_until").eq("business_id", businessId).maybeSingle()
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        setSub((data as Subscription | null) ?? { whatsapp: false, invoices: false, valid_until: null });
      });
  }, [businessId]);

  async function save(patch: Partial<Subscription>) {
    if (!sub) return;
    const next = { ...sub, ...patch };
    setBusy(true); setError(null);
    const { error: e } = await supabase().from("epc_subscriptions")
      .upsert({ business_id: businessId, ...next, updated_at: new Date().toISOString() }, { onConflict: "business_id" });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setSub(next);
  }

  if (!sub) return <div className="pt-1 text-[13px] text-text-muted">{error ?? "Loading…"}</div>;
  return (
    <div className="pt-1 flex flex-col gap-2.5">
      {FEATURES.map(([f, label]) => (
        <div key={f} className="flex items-center justify-between gap-2">
          <span className={["text-[13px] font-semibold", hasFeature(sub, f) ? "text-[#178a5c]" : "text-[#0f3d2e]"].join(" ")}>
            {label} · {hasFeature(sub, f) ? "On" : sub[f] ? "Ended" : "Off"}
          </span>
          {admin && (
            <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-[#0f3d2e] cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 accent-[#178a5c]" checked={sub[f]} disabled={busy} onChange={(e) => void save({ [f]: e.target.checked })} />
              On
            </label>
          )}
        </div>
      ))}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
