"use client";

// Admin-only "EPC business info" section on the EPC detail page.
//
// Four fields the admin fills during review:
//   1. Total Team Size (Technical and Non-Technical) — text (freeform).
//   2. Total Installed Capacity (Residential)       — numeric + KW|MW.
//   3. Total Installed Capacity (Commercial)        — numeric + KW|MW.
//   4. Total Turnover (last FY)                     — text (freeform).
//
// Storage: `epc_admin_info` table (admin-only RLS; invisible to EPCs by
// design). One row per EPC keyed by business_id. Row is LAZY — created
// on first Save via upsert.
//
// UX: single Save button for all 4 fields. Local draft state; commits
// on Save. Neutral inline status ("Saving…", "Saved", "Save failed").
//
// Placed BEFORE GstR3bSection on the EPC detail page. Modeled loosely
// on GstR3bSection but simpler (no OCR, no file uploads, no legacy
// migration path).

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import { supabase } from "@/lib/supabase";

type Unit = "KW" | "MW";

type Row = {
  team_size: string;
  capacity_residential: string;       // held as string; parsed to numeric on save
  capacity_residential_unit: Unit;
  capacity_commercial: string;
  capacity_commercial_unit: Unit;
  turnover_last_fy: string;
};

const EMPTY: Row = {
  team_size: "",
  capacity_residential: "",
  capacity_residential_unit: "KW",
  capacity_commercial: "",
  capacity_commercial_unit: "KW",
  turnover_last_fy: "",
};

type SaveState = "idle" | "saving" | "saved" | "error";

export default function EpcAdminInfoSection({ businessId }: { businessId: string }) {
  const [draft, setDraft] = useState<Row>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase()
        .from("epc_admin_info")
        .select("*")
        .eq("business_id", businessId)
        .maybeSingle();
      if (error) {
        // Table may not exist yet in a dev/staging environment — surface
        // the raw error so it's obvious what's missing.
        console.warn("[epc_admin_info] load failed:", error.message);
      }
      if (data) {
        setDraft({
          team_size: (data.team_size as string) ?? "",
          capacity_residential:
            data.capacity_residential != null ? String(data.capacity_residential) : "",
          capacity_residential_unit:
            (data.capacity_residential_unit as Unit) ?? "KW",
          capacity_commercial:
            data.capacity_commercial != null ? String(data.capacity_commercial) : "",
          capacity_commercial_unit:
            (data.capacity_commercial_unit as Unit) ?? "KW",
          turnover_last_fy: (data.turnover_last_fy as string) ?? "",
        });
      }
      setLoaded(true);
    })();
  }, [businessId]);

  function set<K extends keyof Row>(key: K, value: Row[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (state !== "idle") setState("idle");
  }

  function parseNum(s: string): number | null {
    const t = s.trim();
    if (!t) return null;
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  }

  async function save() {
    setErrorMsg(null);

    // Validate: if a capacity number is present, it must parse. Unit stays
    // regardless — user can type a value first, choose unit next, or vice versa.
    for (const [rawKey, label] of [
      ["capacity_residential", "Residential capacity"],
      ["capacity_commercial",  "Commercial capacity"],
    ] as const) {
      const raw = draft[rawKey];
      if (raw.trim() && parseNum(raw) === null) {
        setErrorMsg(`${label} must be a number.`);
        setState("error");
        return;
      }
    }

    setState("saving");
    // upsert onto business_id (the PK). Lazy row creation on first save.
    const row = {
      business_id: businessId,
      team_size: draft.team_size.trim() || null,
      capacity_residential: parseNum(draft.capacity_residential),
      capacity_residential_unit: draft.capacity_residential_unit,
      capacity_commercial: parseNum(draft.capacity_commercial),
      capacity_commercial_unit: draft.capacity_commercial_unit,
      turnover_last_fy: draft.turnover_last_fy.trim() || null,
    };
    const { error } = await supabase()
      .from("epc_admin_info")
      .upsert(row, { onConflict: "business_id" });
    if (error) {
      setErrorMsg(error.message);
      setState("error");
      return;
    }
    setState("saved");
  }

  if (!loaded) return null;

  const inputCls =
    "w-full border border-line rounded-input px-3 py-2 text-[13px] " +
    "focus:border-blue outline-none bg-white";
  const selectCls = inputCls;

  return (
    <Card className="p-6">
      <h3 className="font-display font-semibold text-[16px] mb-1">EPC business info</h3>
      <p className="text-[12px] text-text-muted mb-4">
        Admin-only. These fields are never visible to the EPC.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* 1. Team size */}
        <Field label="Total team size (Technical + Non-Technical)">
          <input
            className={inputCls}
            placeholder='e.g. "50" or "50 (30T + 20NT)"'
            value={draft.team_size}
            onChange={(e) => set("team_size", e.target.value)}
          />
        </Field>

        {/* 4. Turnover — kept next to team size for tidy 2-col layout */}
        <Field label="Total turnover (last FY)">
          <input
            className={inputCls}
            placeholder='e.g. "₹5 Cr" or "50000000"'
            value={draft.turnover_last_fy}
            onChange={(e) => set("turnover_last_fy", e.target.value)}
          />
        </Field>

        {/* 2. Residential capacity */}
        <Field label="Total installed capacity (Residential)">
          <div className="flex gap-2">
            <input
              className={inputCls}
              inputMode="decimal"
              placeholder="Number"
              value={draft.capacity_residential}
              onChange={(e) => set("capacity_residential", e.target.value)}
            />
            <select
              className={selectCls + " w-[80px] shrink-0"}
              value={draft.capacity_residential_unit}
              onChange={(e) => set("capacity_residential_unit", e.target.value as Unit)}
            >
              <option value="KW">KW</option>
              <option value="MW">MW</option>
            </select>
          </div>
        </Field>

        {/* 3. Commercial capacity */}
        <Field label="Total installed capacity (Commercial)">
          <div className="flex gap-2">
            <input
              className={inputCls}
              inputMode="decimal"
              placeholder="Number"
              value={draft.capacity_commercial}
              onChange={(e) => set("capacity_commercial", e.target.value)}
            />
            <select
              className={selectCls + " w-[80px] shrink-0"}
              value={draft.capacity_commercial_unit}
              onChange={(e) => set("capacity_commercial_unit", e.target.value as Unit)}
            >
              <option value="KW">KW</option>
              <option value="MW">MW</option>
            </select>
          </div>
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving"}
          className="px-4 py-2 bg-blue text-white rounded text-[13px] font-semibold hover:bg-blue-dark disabled:opacity-60"
        >
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && (
          <span className="text-[12px] text-green-700">Saved</span>
        )}
        {state === "error" && errorMsg && (
          <span className="text-[12px] text-red-500">{errorMsg}</span>
        )}
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[12px] text-text-muted mb-1">{label}</p>
      {children}
    </div>
  );
}
