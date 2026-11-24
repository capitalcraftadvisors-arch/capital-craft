"use client";

// Admin EPC profile → "Subscription" (0128 / 0129 / 0133), every On / Off switch
// CC holds for this EPC:
//   New partner portal — Partner Portal v2 (leads, projects, dashboard, payments,
//                        vault, …); switching it on also makes a project of every
//                        filed loan (epc_projects_from_loans)
//   WhatsApp, Invoices — the paid features (switched off, old invoices stay
//                        downloadable, nothing new is made or sent)
// The main admin changes them; everyone else sees where they stand. Reads once, when opened.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { hasFeature, type Feature, type Subscription } from "@/lib/subscription";

type Sub = Subscription & { portal_v2: boolean };
type Switch = "portal_v2" | Feature;
const SWITCHES: [Switch, string][] = [["portal_v2", "New partner portal"], ["whatsapp", "WhatsApp"], ["invoices", "Invoices"]];

export default function SubscriptionCard({ businessId }: { businessId: string }) {
  const admin = isMainAdmin(getBusiness());
  const [sub, setSub] = useState<Sub | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase().from("epc_subscriptions").select("portal_v2, whatsapp, invoices, valid_until").eq("business_id", businessId).maybeSingle()
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        setSub((data as Sub | null) ?? { portal_v2: false, whatsapp: false, invoices: false, valid_until: null });
      });
  }, [businessId]);

  async function save(patch: Partial<Sub>) {
    if (!sub) return;
    const next = { ...sub, ...patch };
    setBusy(true); setError(null);
    const { error: e } = await supabase().from("epc_subscriptions")
      .upsert({ business_id: businessId, ...next, updated_at: new Date().toISOString() }, { onConflict: "business_id" });
    // The new portal starts with a project for each filed loan (only the missing ones).
    const p = !e && patch.portal_v2 ? await supabase().rpc("epc_projects_from_loans", { p_business: businessId }) : null;
    setBusy(false);
    if (e || p?.error) { setError((e ?? p?.error)!.message); if (e) return; }
    setSub(next);
  }

  if (!sub) return <div className="pt-1 text-[13px] text-text-muted">{error ?? "Loading…"}</div>;
  const isOn = (k: Switch) => (k === "portal_v2" ? sub.portal_v2 : hasFeature(sub, k));
  return (
    <div className="pt-1 flex flex-col gap-2.5">
      {SWITCHES.map(([k, label]) => (
        <div key={k} className="flex items-center justify-between gap-2">
          <span className={["text-[13px] font-semibold", isOn(k) ? "text-cc-green" : "text-cc-ink"].join(" ")}>
            {label} · {isOn(k) ? "On" : sub[k] ? "Ended" : "Off"}
          </span>
          {admin && (
            <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-cc-ink cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 accent-cc-green" checked={sub[k]} disabled={busy} onChange={(e) => void save({ [k]: e.target.checked })} />
              On
            </label>
          )}
        </div>
      ))}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
