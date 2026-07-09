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
  // Business Expectation lives on epc_business (not epc_admin_info) per
  // spec — loaded/saved separately but presented in this same card and
  // committed by the same Save button.
  const [expectation, setExpectation] = useState<"" | "crores" | "lakhs">("");

  useEffect(() => {
    (async () => {
      const { data: bizRow } = await supabase()
        .from("epc_business")
        .select("business_expectation")
        .eq("id", businessId)
        .maybeSingle();
      if (bizRow?.business_expectation === "crores" || bizRow?.business_expectation === "lakhs") {
        setExpectation(bizRow.business_expectation);
      }

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

    // Business Expectation → epc_business (admin RLS permits the write).
    const { error: bizErr } = await supabase()
      .from("epc_business")
      .update({ business_expectation: expectation || null })
      .eq("id", businessId);
    if (bizErr) {
      setErrorMsg(bizErr.message);
      setState("error");
      return;
    }

    setState("saved");
  }

  if (!loaded) return null;

  // Base classes with NO width class — width is applied per-usage so
  // capacity rows can use flex-1 (input) + fixed-width (select) without
  // fighting a w-full on the base class.
  const inputBase =
    "border border-line rounded-input px-3.5 py-2.5 text-[14px] " +
    "focus:border-blue outline-none bg-white";
  const fullInputCls = inputBase + " w-full";

  // Dropdown labels display full words per spec ("Kilowatt" / "Megawatt").
  // DB values stay "KW" / "MW" so backfills, the ZIP Excel formatter, and
  // the View page's fmtCapacity all keep working unchanged.
  return (
    <Card className="p-6">
      <h3 className="font-display font-semibold text-[16px] mb-1">EPC business info</h3>
      <p className="text-[12px] text-text-muted mb-5">
        Admin-only. These fields are never visible to the EPC.
      </p>

      {/* Row 1 — Team size + Turnover side by side (both short freeform) */}
      <div className="grid gap-4 sm:grid-cols-2 mb-4">
        <Field label="Total team size (Technical + Non-Technical)">
          <input
            type="text"
            className={fullInputCls}
            placeholder='e.g. "50" or "50 (30T + 20NT)"'
            value={draft.team_size}
            onChange={(e) => set("team_size", e.target.value)}
          />
        </Field>

        <Field label="Total turnover (last FY)">
          <input
            type="text"
            className={fullInputCls}
            placeholder='e.g. "₹5 Cr" or "50000000"'
            value={draft.turnover_last_fy}
            onChange={(e) => set("turnover_last_fy", e.target.value)}
          />
        </Field>
      </div>

      {/* Row 2 — Residential capacity: WIDE number input + small unit select. */}
      {/* Neither element uses `w-full` — that would collide with flex sizing. */}
      <div className="mb-4">
        <Field label="Total installed capacity (Residential)">
          <div className="flex gap-3 items-stretch">
            <input
              type="text"
              className={inputBase + " flex-1 min-w-0"}
              inputMode="decimal"
              placeholder="e.g. 850"
              value={draft.capacity_residential}
              onChange={(e) => set("capacity_residential", e.target.value)}
            />
            <select
              className={inputBase + " w-[130px] shrink-0"}
              value={draft.capacity_residential_unit}
              onChange={(e) => set("capacity_residential_unit", e.target.value as Unit)}
            >
              <option value="KW">Kilowatt</option>
              <option value="MW">Megawatt</option>
            </select>
          </div>
        </Field>
      </div>

      {/* Row 3 — Commercial capacity: same shape. */}
      <div className="mb-4">
        <Field label="Total installed capacity (Commercial)">
          <div className="flex gap-3 items-stretch">
            <input
              type="text"
              className={inputBase + " flex-1 min-w-0"}
              inputMode="decimal"
              placeholder="e.g. 2"
              value={draft.capacity_commercial}
              onChange={(e) => set("capacity_commercial", e.target.value)}
            />
            <select
              className={inputBase + " w-[130px] shrink-0"}
              value={draft.capacity_commercial_unit}
              onChange={(e) => set("capacity_commercial_unit", e.target.value as Unit)}
            >
              <option value="KW">Kilowatt</option>
              <option value="MW">Megawatt</option>
            </select>
          </div>
        </Field>
      </div>

      {/* Row 4 — Business Expectation (scale only: Crores / Lakhs).
          Stored on epc_business.business_expectation. */}
      <div className="mb-4 max-w-[300px]">
        <Field label="Business Expectation">
          <select
            value={expectation}
            onChange={(e) => {
              setExpectation(e.target.value as "" | "crores" | "lakhs");
              if (state !== "idle") setState("idle");
            }}
            className={
              fullInputCls +
              " pr-9 appearance-none bg-[url('data:image/svg+xml;utf8,<svg fill=%22%236B8294%22 viewBox=%220 0 20 20%22 xmlns=%22http://www.w3.org/2000/svg%22><path d=%22M5 8l5 5 5-5z%22/></svg>')] bg-no-repeat bg-[length:20px] bg-[right_10px_center]"
            }
          >
            <option value="">Select…</option>
            <option value="crores">Crores</option>
            <option value="lakhs">Lakhs</option>
          </select>
        </Field>
      </div>

      <div className="mt-5 flex items-center gap-3">
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
