"use client";

// Admin-only "EPC Projects" section on the EPC Edit Profile page.
//
// A 2×5 grid the admin fills during review:
//   columns : Residential | Commercial
//   rows    : Applications submitted / Applications rejected /
//             Sanction amount / Disbursed / Pending disbursal
//
// Storage: epc_admin_info.epc_projects (jsonb). That table is admin-only
// (RLS: "admin_all_epc_admin_info", NO EPC policy) so this is invisible to
// EPCs — same guarantee as the EPC business-info fields. The row is LAZY
// (created on first Save via upsert); the upsert only sets business_id +
// epc_projects, so it never clobbers the other admin-info columns.
//
// UX mirrors EpcAdminInfoSection: local draft, single Save button, neutral
// inline status.

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import { supabase } from "@/lib/supabase";

type Segment = "residential" | "commercial";
type Metric =
  | "applications_submitted"
  | "applications_rejected"
  | "sanction_amount"
  | "disbursed"
  | "pending_disbursal";

// Row order + labels shared with the read-only View table.
export const EPC_PROJECT_ROWS: { key: Metric; label: string; money: boolean }[] = [
  { key: "applications_submitted", label: "Applications submitted", money: false },
  { key: "applications_rejected",  label: "Applications rejected",  money: false },
  { key: "sanction_amount",        label: "Sanction amount",        money: true },
  { key: "disbursed",              label: "Disbursed",              money: true },
  { key: "pending_disbursal",      label: "Pending disbursal",      money: true },
];

type SegDraft = Record<Metric, string>;
type Draft = Record<Segment, SegDraft>;

const EMPTY_SEG: SegDraft = {
  applications_submitted: "",
  applications_rejected: "",
  sanction_amount: "",
  disbursed: "",
  pending_disbursal: "",
};
const EMPTY: Draft = { residential: { ...EMPTY_SEG }, commercial: { ...EMPTY_SEG } };

type SaveState = "idle" | "saving" | "saved" | "error";

function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Reads a stored jsonb value into the string-draft shape (tolerant of
// missing keys / partial data).
function fromStored(raw: unknown): Draft {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seg = (name: Segment): SegDraft => {
    const s = (src[name] && typeof src[name] === "object" ? src[name] : {}) as Record<string, unknown>;
    const out = { ...EMPTY_SEG };
    for (const { key } of EPC_PROJECT_ROWS) {
      const v = s[key];
      out[key] = typeof v === "number" && Number.isFinite(v) ? String(v) : "";
    }
    return out;
  };
  return { residential: seg("residential"), commercial: seg("commercial") };
}

export default function EpcProjectsSection({ businessId }: { businessId: string }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase()
        .from("epc_admin_info")
        .select("epc_projects")
        .eq("business_id", businessId)
        .maybeSingle();
      if (error) console.warn("[epc_projects] load failed:", error.message);
      if (data?.epc_projects) setDraft(fromStored(data.epc_projects));
      setLoaded(true);
    })();
  }, [businessId]);

  function set(seg: Segment, metric: Metric, value: string) {
    // Digits, optional decimal point, optional leading minus — kept as a
    // string while typing; parsed to a number on save.
    const cleaned = value.replace(/[^\d.]/g, "");
    setDraft((d) => ({ ...d, [seg]: { ...d[seg], [metric]: cleaned } }));
    if (state !== "idle") setState("idle");
  }

  async function save() {
    setErrorMsg(null);
    setState("saving");

    const toSeg = (seg: Segment) => {
      const out: Record<Metric, number | null> = {} as Record<Metric, number | null>;
      for (const { key } of EPC_PROJECT_ROWS) out[key] = parseNum(draft[seg][key]);
      return out;
    };
    const epc_projects = { residential: toSeg("residential"), commercial: toSeg("commercial") };

    // Upsert ONLY business_id + epc_projects — leaves the other admin-info
    // columns (team_size, capacities, turnover) untouched on an existing row.
    const { error } = await supabase()
      .from("epc_admin_info")
      .upsert({ business_id: businessId, epc_projects }, { onConflict: "business_id" });
    if (error) {
      setErrorMsg(error.message);
      setState("error");
      return;
    }
    setState("saved");
  }

  if (!loaded) return null;

  const inputCls =
    "w-full border border-line rounded-input px-3 py-2 text-[14px] " +
    "focus:border-blue outline-none bg-white text-right";

  return (
    <Card className="p-6">
      <h3 className="font-display font-semibold text-[16px] mb-1">EPC Projects</h3>
      <p className="text-[12px] text-text-muted mb-5">
        Admin-only. These figures are never visible to the EPC.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-[14px] border-collapse">
          <thead>
            <tr className="text-[12px] uppercase tracking-wide text-text-muted">
              <th className="text-left font-medium pb-2 pr-3 w-[42%]"></th>
              <th className="text-center font-medium pb-2 px-2">Residential</th>
              <th className="text-center font-medium pb-2 px-2">Commercial</th>
            </tr>
          </thead>
          <tbody>
            {EPC_PROJECT_ROWS.map((row) => (
              <tr key={row.key} className="border-t border-line/70">
                <td className="py-2 pr-3 text-[13px] text-text-mid font-medium">
                  {row.label}
                  {row.money && <span className="text-text-muted font-normal"> (₹)</span>}
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    inputMode={row.money ? "decimal" : "numeric"}
                    className={inputCls}
                    placeholder="0"
                    value={draft.residential[row.key]}
                    onChange={(e) => set("residential", row.key, e.target.value)}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    inputMode={row.money ? "decimal" : "numeric"}
                    className={inputCls}
                    placeholder="0"
                    value={draft.commercial[row.key]}
                    onChange={(e) => set("commercial", row.key, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        {state === "saved" && <span className="text-[12px] text-green-700">Saved</span>}
        {state === "error" && errorMsg && (
          <span className="text-[12px] text-red-500">{errorMsg}</span>
        )}
      </div>
    </Card>
  );
}
