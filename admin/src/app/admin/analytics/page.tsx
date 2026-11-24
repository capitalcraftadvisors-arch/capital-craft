"use client";

// ============================================================================
// Management analytics dashboard — /admin/analytics
//
// Four sections (Residential | C&I | Insurance | EPC), a period switcher, and
// deterministic rule-based "intelligence" (NO LLM/AI calls anywhere — every
// insight is composed from computed numbers).
//
// Period model (approved): the current window runs from the period start to
// NOW (period-to-date); the previous window is the equivalent-length window
// immediately before, using the SAME elapsed duration, so comparisons are
// fair (e.g. month-to-date vs last-month-to-the-same-elapsed-point).
//
// Bucketing (approved):
//   - Applications / Sanctioned / Rejected → cohort by created_at.
//   - Disbursed count + Avg TAT           → activity by first_disbursement_date.
//
// Omitted — no data (deliberately NOT approximated):
//   - Insurance Avg TAT (created → policy issue): no policy-issue/upload
//     timestamp exists. Shows a clean empty state. FUTURE MIGRATION that would
//     enable it (do NOT write now): add insurance_applications.policy_uploaded_at
//     timestamptz, set when the admin uploads the policy document; then
//     TAT = policy_uploaded_at − created_at.
//   - Loans with NULL plant_use_type are in neither Res nor C&I — surfaced as a
//     small reconciling note so totals add up.
//   - regions / branches / teams / products / channels (no such data).
//
// Read-only: two extra SELECTs (loans, insurance) added alongside the existing
// EPC analytics queries. All existing EPC math is preserved.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar, { SectionMark, themeStyle } from "@/components/AdminSidebar";
import { supabase } from "@/lib/supabase";
import { computeWindows, PRESET_LABEL, type Preset } from "@/lib/periods";
import OverviewSection from "@/components/analytics/OverviewSection";
// The page's parts (./_parts): the numbers, the shared cards, and the section views.
import { computeLoanSection, computeInsSection, computeEpcSection, type Loan, type Insurance, type Biz, type LenderRow } from "./_parts/metrics";
import { ACCENT } from "./_parts/cards";
import { InsSectionView, EpcSectionView, GeographySectionView, CrossTable } from "./_parts/sections";

// ============================================================================
// PAGE
// ============================================================================
export default function AnalyticsPage() {
  return (
    <AuthGuard allow={["admin"]} requireModule="analytics">
      <Inner />
    </AuthGuard>
  );
}

type SectionKey = "overview" | "res" | "com" | "ins" | "epc" | "geo";
const SECTION_TABS: { key: SectionKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "res", label: "Residential" }, { key: "com", label: "C&I" },
  { key: "ins", label: "Insurance" }, { key: "epc", label: "EPC" },
  { key: "geo", label: "Geography" },
];

function Inner() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [ins, setIns] = useState<Insurance[]>([]);
  const [biz, setBiz] = useState<Biz[]>([]);
  const [lenders, setLenders] = useState<LenderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [section, setSection] = useState<SectionKey>("overview");
  const [preset, setPreset] = useState<Preset>("month");
  const [cs, setCs] = useState("");
  const [ce, setCe] = useState("");

  useEffect(() => {
    void (async () => {
      const [{ data: l }, { data: i }, { data: b }, { data: ls }] = await Promise.all([
        supabase().from("epc_applications")
          .select("id, created_at, status, plant_use_type, first_disbursement_amount, first_disbursement_date, install_city, install_district, install_state, install_pincode"),
        supabase().from("insurance_applications").select("id, created_at, status, policy_path"),
        supabase().from("epc_business")
          .select("id, source, status, created_at, submitted_at, reviewed_at, step_timestamps")
          .neq("business_type", "admin"),
        supabase().from("epc_lender_status").select("business_id, lender, docs_given_at, approved_at"),
      ]);
      setLoans((l ?? []) as Loan[]);
      setIns((i ?? []) as Insurance[]);
      setBiz((b ?? []) as Biz[]);
      setLenders((ls ?? []) as LenderRow[]);
      setLoading(false);
    })();
  }, []);

  // Recompute everything for the selected period. new Date() runs client-side.
  const w = useMemo(() => computeWindows(preset, new Date(), cs, ce), [preset, cs, ce]);

  const resLoans = useMemo(() => loans.filter((r) => r.plant_use_type === "residential"), [loans]);
  const comLoans = useMemo(() => loans.filter((r) => r.plant_use_type === "commercial"), [loans]);

  const res = useMemo(() => computeLoanSection(resLoans, w), [resLoans, w]);
  const com = useMemo(() => computeLoanSection(comLoans, w), [comLoans, w]);
  const insM = useMemo(() => computeInsSection(ins, w), [ins, w]);
  const epc = useMemo(() => computeEpcSection(biz, lenders, w), [biz, lenders, w]);

  return (
    <div className="min-h-screen lg:flex" style={themeStyle("analytics")}>
      <AdminSidebar active="analytics" />
      <div className="flex-1 min-w-0">
        {/* Sticky top bar: title + section switcher + period filter */}
        <div className="sticky top-14 lg:top-0 z-20 bg-[var(--acc-page)] backdrop-blur border-b border-line">
          <div className="w-full px-4 sm:px-6 py-4">
            <div className="flex items-center gap-3 mb-3">
              <SectionMark k="analytics" />
              <h1 className="font-display text-[24px] sm:text-[28px] font-bold" style={{ color: ACCENT }}>Analytics</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-input border border-line bg-white p-1">
                {SECTION_TABS.map((s) => {
                  const on = section === s.key;
                  return (
                    <button key={s.key} type="button" onClick={() => setSection(s.key)}
                      className="px-3.5 py-1.5 rounded-[8px] text-[13px] font-semibold transition-colors"
                      style={on ? { backgroundColor: ACCENT + "1a", color: ACCENT } : { color: "var(--muted)" }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}
                  className="rounded-input border border-line bg-white px-3 py-2 text-[13px] font-medium outline-none focus:border-blue">
                  {(["today", "week", "month", "quarter", "year", "custom"] as Preset[]).map((p) => (
                    <option key={p} value={p}>{PRESET_LABEL[p]}</option>
                  ))}
                </select>
                {preset === "custom" && (
                  <>
                    <input type="date" value={cs} onChange={(e) => setCs(e.target.value)} aria-label="From"
                      className="rounded-input border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-blue" />
                    <input type="date" value={ce} onChange={(e) => setCe(e.target.value)} aria-label="To"
                      className="rounded-input border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-blue" />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <section className="w-full px-4 sm:px-6 py-6">
          {loading ? (
            <p className="text-[13px] text-text-muted">Loading…</p>
          ) : (
            <div className="space-y-6">
              {section === "overview" && <OverviewSection win={w.cur} />}
              {section === "res" && <OverviewSection win={w.cur} segment="residential" />}
              {section === "com" && <OverviewSection win={w.cur} segment="commercial" />}
              {section === "ins" && <InsSectionView s={insM} w={w} />}
              {section === "epc" && <EpcSectionView s={epc} w={w} />}
              {section === "geo" && <GeographySectionView resLoans={resLoans} comLoans={comLoans} allLoans={loans} w={w} />}

              {/* Cross-business comparison — identical across sections (not on Overview / Geography) */}
              {section !== "geo" && section !== "overview" && <CrossTable res={res} com={com} ins={insM} epc={epc} />}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
