"use client";

// Admin-only "EPC business info" section on the EPC detail page.
//
// Fields the admin fills during review:
//   1. No. of Members (Technical) + (Non-Technical) — two integers.
//   2. Total Installed Capacity (Residential)       — numeric + kW|MW.
//   3. Total Installed Capacity (Commercial)        — numeric + kW|MW.
//   4. Total Turnover (last FY)                     — numeric, ₹ Lakhs.
//   5. Business Expectation                         — numeric, ₹ Lakhs.
//
// Storage:
//   - team_technical / team_non_technical / capacity_* / turnover_lakhs
//     live on the admin-only `epc_admin_info` table (invisible to EPCs).
//   - business_expectation_value lives on `epc_business` (admin RLS write);
//     unit is always 'lakhs' now (the Crores/Lakhs dropdown was removed).
//
// Legacy: the old free-text columns team_size and turnover_last_fy are kept
// UNTOUCHED for history. When the corresponding new fields are empty and a
// legacy value exists, it's shown as a read-only reference hint — never
// parsed into the new fields.
//
// UX: single Save button for all fields. Local draft; commits on Save.

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import { supabase } from "@/lib/supabase";

type Unit = "KW" | "MW";

type Row = {
  team_technical: string;             // integer as string
  team_non_technical: string;         // integer as string
  capacity_residential: string;       // numeric as string
  capacity_residential_unit: Unit;
  capacity_commercial: string;
  capacity_commercial_unit: Unit;
  turnover_lakhs: string;             // numeric (₹ Lakhs) as string
};

const EMPTY: Row = {
  team_technical: "",
  team_non_technical: "",
  capacity_residential: "",
  capacity_residential_unit: "KW",
  capacity_commercial: "",
  capacity_commercial_unit: "KW",
  turnover_lakhs: "",
};

// Legacy turnover_last_fy is free text in RUPEES. If it's a plain number
// (optionally with ₹/commas/spaces), convert ₹ → Lakhs (÷1,00,000) so the new
// Lakhs box can be pre-filled — e.g. "40000000" → 400. Anything non-numeric
// (e.g. "₹5 Cr approx") returns null and is left for the hint instead.
function rupeesTextToLakhs(raw: string): number | null {
  const cleaned = (raw || "").replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n < 0) return null;
  return +(n / 100000).toFixed(2);
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function EpcAdminInfoSection({ businessId }: { businessId: string }) {
  const [draft, setDraft] = useState<Row>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Business Expectation now lives as a single value in ₹ Lakhs on
  // epc_business (unit dropdown removed; unit is always 'lakhs').
  const [expectationValue, setExpectationValue] = useState<string>("");

  // Legacy free-text values (team_size, turnover_last_fy) shown only as
  // reference hints when the new structured fields are still empty.
  const [legacyTeam, setLegacyTeam] = useState<string>("");
  const [legacyTurnover, setLegacyTurnover] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: bizRow } = await supabase()
        .from("epc_business")
        .select("business_expectation_value")
        .eq("id", businessId)
        .maybeSingle();
      if (bizRow?.business_expectation_value != null) {
        setExpectationValue(String(bizRow.business_expectation_value));
      }

      const { data, error } = await supabase()
        .from("epc_admin_info")
        .select("*")
        .eq("business_id", businessId)
        .maybeSingle();
      if (error) {
        console.warn("[epc_admin_info] load failed:", error.message);
      }
      if (data) {
        // Pre-fill the Lakhs turnover box: prefer the saved numeric value; else
        // convert the legacy rupee text to Lakhs when it's a plain number.
        // Non-numeric legacy text leaves the box empty (a hint shows the raw
        // value instead).
        let turnoverPrefill =
          data.turnover_lakhs != null ? String(data.turnover_lakhs) : "";
        if (turnoverPrefill === "") {
          const lakhs = rupeesTextToLakhs((data.turnover_last_fy as string) ?? "");
          if (lakhs != null) turnoverPrefill = String(lakhs);
        }
        setDraft({
          team_technical:
            data.team_technical != null ? String(data.team_technical) : "",
          team_non_technical:
            data.team_non_technical != null ? String(data.team_non_technical) : "",
          capacity_residential:
            data.capacity_residential != null ? String(data.capacity_residential) : "",
          capacity_residential_unit:
            (data.capacity_residential_unit as Unit) ?? "KW",
          capacity_commercial:
            data.capacity_commercial != null ? String(data.capacity_commercial) : "",
          capacity_commercial_unit:
            (data.capacity_commercial_unit as Unit) ?? "KW",
          turnover_lakhs: turnoverPrefill,
        });
        setLegacyTeam((data.team_size as string) ?? "");
        setLegacyTurnover((data.turnover_last_fy as string) ?? "");
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

  // Whole-number count parser (team members). null = blank, undefined = invalid.
  function parseCount(s: string): number | null | undefined {
    const t = s.trim();
    if (!t) return null;
    if (!/^\d+$/.test(t)) return undefined;
    return parseInt(t, 10);
  }

  async function save() {
    setErrorMsg(null);

    // Team member counts must be whole numbers if present.
    for (const [rawKey, label] of [
      ["team_technical", "No. of Members (Technical)"],
      ["team_non_technical", "No. of Members (Non-Technical)"],
    ] as const) {
      if (parseCount(draft[rawKey]) === undefined) {
        setErrorMsg(`${label} must be a whole number.`);
        setState("error");
        return;
      }
    }

    // Capacities + turnover must parse as numbers if present.
    for (const [rawKey, label] of [
      ["capacity_residential", "Residential capacity"],
      ["capacity_commercial", "Commercial capacity"],
      ["turnover_lakhs", "Total turnover"],
    ] as const) {
      const raw = draft[rawKey];
      if (raw.trim() && parseNum(raw) === null) {
        setErrorMsg(`${label} must be a number.`);
        setState("error");
        return;
      }
    }
    if (expectationValue.trim() && parseNum(expectationValue) === null) {
      setErrorMsg("Business Expectation must be a number.");
      setState("error");
      return;
    }

    setState("saving");
    // upsert onto business_id (PK). Legacy team_size / turnover_last_fy are
    // intentionally omitted so the upsert leaves them untouched.
    const row = {
      business_id: businessId,
      team_technical: parseCount(draft.team_technical) ?? null,
      team_non_technical: parseCount(draft.team_non_technical) ?? null,
      capacity_residential: parseNum(draft.capacity_residential),
      capacity_residential_unit: draft.capacity_residential_unit,
      capacity_commercial: parseNum(draft.capacity_commercial),
      capacity_commercial_unit: draft.capacity_commercial_unit,
      turnover_lakhs: parseNum(draft.turnover_lakhs),
    };
    const { error } = await supabase()
      .from("epc_admin_info")
      .upsert(row, { onConflict: "business_id" });
    if (error) {
      setErrorMsg(error.message);
      setState("error");
      return;
    }

    // Business Expectation (₹ Lakhs) → epc_business. Unit is always 'lakhs'
    // when a value is present, null when cleared.
    const expVal = parseNum(expectationValue);
    const { error: bizErr } = await supabase()
      .from("epc_business")
      .update({
        business_expectation: expVal != null ? "lakhs" : null,
        business_expectation_value: expVal,
      })
      .eq("id", businessId);
    if (bizErr) {
      setErrorMsg(bizErr.message);
      setState("error");
      return;
    }

    setState("saved");
  }

  if (!loaded) return null;

  const inputBase =
    "border border-line rounded-input px-3.5 py-2.5 text-[14px] " +
    "focus:border-blue outline-none bg-white";
  const fullInputCls = inputBase + " w-full";
  // Compact, identical width for the two capacity number inputs + a narrow
  // unit select (kW / MW are short) so both rows line up exactly.
  const capInputCls = inputBase + " w-[150px]";
  const capSelectCls = inputBase + " w-[92px] shrink-0";

  const showTeamHint =
    legacyTeam.trim() !== "" &&
    draft.team_technical.trim() === "" &&
    draft.team_non_technical.trim() === "";
  const showTurnoverHint =
    legacyTurnover.trim() !== "" && draft.turnover_lakhs.trim() === "";

  return (
    <Card className="p-6">
      <h3 className="font-display font-semibold text-[16px] mb-1">EPC business info</h3>
      <p className="text-[12px] text-text-muted mb-5">
        Admin-only. These fields are never visible to the EPC.
      </p>

      {/* Row 1 — Team members: Technical + Non-Technical (two integers). */}
      <div className="mb-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="No. of Members (Technical)">
            <input
              type="text"
              inputMode="numeric"
              className={fullInputCls}
              placeholder="e.g. 30"
              value={draft.team_technical}
              onChange={(e) => set("team_technical", e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
          <Field label="No. of Members (Non-Technical)">
            <input
              type="text"
              inputMode="numeric"
              className={fullInputCls}
              placeholder="e.g. 20"
              value={draft.team_non_technical}
              onChange={(e) => set("team_non_technical", e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
        </div>
        {showTeamHint && (
          <p className="text-[11px] text-text-muted mt-1.5">
            Previously recorded (combined): <span className="text-text-mid">{legacyTeam}</span>
          </p>
        )}
      </div>

      {/* Row 2 — Residential capacity: compact number + narrow kW/MW select. */}
      <div className="mt-4 mb-4">
        <Field label="Total installed capacity (Residential)">
          <div className="flex gap-3 items-stretch">
            <input
              type="text"
              className={capInputCls}
              inputMode="decimal"
              placeholder="e.g. 850"
              value={draft.capacity_residential}
              onChange={(e) => set("capacity_residential", e.target.value)}
            />
            <select
              className={capSelectCls}
              value={draft.capacity_residential_unit}
              onChange={(e) => set("capacity_residential_unit", e.target.value as Unit)}
            >
              <option value="KW">kW</option>
              <option value="MW">MW</option>
            </select>
          </div>
        </Field>
      </div>

      {/* Row 3 — Commercial capacity: same compact shape. */}
      <div className="mb-4">
        <Field label="Total installed capacity (Commercial)">
          <div className="flex gap-3 items-stretch">
            <input
              type="text"
              className={capInputCls}
              inputMode="decimal"
              placeholder="e.g. 2"
              value={draft.capacity_commercial}
              onChange={(e) => set("capacity_commercial", e.target.value)}
            />
            <select
              className={capSelectCls}
              value={draft.capacity_commercial_unit}
              onChange={(e) => set("capacity_commercial_unit", e.target.value as Unit)}
            >
              <option value="KW">kW</option>
              <option value="MW">MW</option>
            </select>
          </div>
        </Field>
      </div>

      {/* Row 4 — Total turnover (₹ Lakhs, numeric). */}
      <div className="mb-4">
        <Field label="Total turnover (last FY)">
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              className={inputBase + " w-[200px]"}
              placeholder="e.g. 500"
              value={draft.turnover_lakhs}
              onChange={(e) => set("turnover_lakhs", e.target.value)}
            />
            <span className="text-[12px] text-text-muted">in Lakhs only</span>
          </div>
        </Field>
        {showTurnoverHint && (
          <p className="text-[11px] text-text-muted mt-1.5">
            Previously recorded: <span className="text-text-mid">{legacyTurnover}</span>
          </p>
        )}
      </div>

      {/* Row 5 — Monthly Expected Volume (₹ Lakhs, numeric; unit dropdown removed). */}
      <div className="mb-4">
        <Field label="Monthly Expected Volume">
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              className={inputBase + " w-[200px]"}
              placeholder="e.g. 500"
              value={expectationValue}
              onChange={(e) => {
                setExpectationValue(e.target.value);
                if (state !== "idle") setState("idle");
              }}
            />
            <span className="text-[12px] text-text-muted">in Lakhs only</span>
          </div>
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
