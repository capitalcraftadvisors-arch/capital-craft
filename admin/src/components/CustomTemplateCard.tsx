"use client";

// Admin EPC profile → "Custom quotation" (0122): the sample quotation(s) the EPC
// uploaded, where its custom template stands, and — for the main admin — Mark
// ready (the EPC is told it's ready and to buy the premium subscription) and the
// Unlocked switch (the EPC can use it — once it pays). The template itself is built in code and
// added as an epc_quotation_templates row, as for Bijlee / Sarvatra Energy / RVS.
// Reads once, when the card is opened.

import { useEffect, useState } from "react";
import FileUpload from "@/components/FileUpload";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { askConfirm } from "@/lib/confirm";
import { customState, READY_CONFIRM } from "@/lib/custom-template";
import { HAction } from "@/components/view/ViewKit";

export type Tpl = { id: string; name: string | null; ready_at: string | null; unlocked: boolean | null };

/** Saves Ready / Unlock on a template (main admin; RLS 0122). Answers the error, or null. */
export async function saveCustomTemplate(id: string, patch: Partial<Pick<Tpl, "ready_at" | "unlocked">>): Promise<string | null> {
  const { error } = await supabase().from("epc_quotation_templates").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? error.message : null;
}

export default function CustomTemplateCard({ businessId }: { businessId: string }) {
  const admin = isMainAdmin(getBusiness());
  const [tpl, setTpl] = useState<Tpl | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase().from("epc_quotation_templates").select("id, name, ready_at, unlocked")
      .eq("epc_business_id", businessId).order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data, error: e }) => { if (e) setError(e.message); setTpl((data as Tpl | null) ?? null); });
  }, [businessId]);

  async function save(patch: Partial<Tpl>) {
    if (!tpl || busy) return;
    setBusy(true); setError(null);
    const e = await saveCustomTemplate(tpl.id, patch);
    setBusy(false);
    if (e) { setError(e); return; }
    setTpl({ ...tpl, ...patch });
  }
  const markReady = async () => {
    if (await askConfirm(READY_CONFIRM)) void save({ ready_at: new Date().toISOString() });
  };

  const state = tpl ? customState(tpl) : null;
  const line =
    tpl === undefined ? "Loading…" :
    !tpl ? "Not built yet" :
    state === "making" ? `${tpl.name || "Template"} · not marked ready` :
    state === "ready" ? `${tpl.name || "Template"} · unlocked` :
    `${tpl.name || "Template"} · ready · locked`;
  const tone = state === "locked" ? "text-warn-ink" : state === "ready" ? "text-cc-green" : "text-cc-ink";

  return (
    <div className="pt-1 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={["text-[13px] font-semibold", tone].join(" ")}>{line}</span>
        {admin && tpl && state === "making" && (
          <HAction small variant="primary" disabled={busy} onClick={markReady}>{busy ? "Saving…" : "Mark ready"}</HAction>
        )}
        {admin && tpl?.ready_at && (
          <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-cc-ink cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4 accent-cc-green" checked={!!tpl.unlocked} disabled={busy}
              onChange={(e) => void save({ unlocked: e.target.checked })} />
            Unlocked
          </label>
        )}
      </div>
      {tpl?.ready_at && <div className="text-[12px] text-cc-muted">Ready {fmtDate(tpl.ready_at)}</div>}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
      <FileUpload table="epc_documents" category="custom_quote_sample" businessId={businessId} uploadedBy="admin"
        maxFiles={3} label="Sample quotation" uploadHint="PDF or photo" />
    </div>
  );
}
