"use client";

// Team analytics — /admin/team-analytics. The CC team's figures (Manish,
// Malvika and the main admin): Residential and Commercial loan files, and EPC
// partners, for a chosen period. Figures only (components/analytics/TeamAnalytics).

import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar, { ACCENTS, SectionMark, themeStyle } from "@/components/AdminSidebar";
import TeamAnalytics, { loadTeamData, type TeamData, type TeamTab } from "@/components/analytics/TeamAnalytics";
import { computeWindows, PRESET_LABEL, type Preset } from "@/lib/periods";
import { useLenders } from "@/lib/lenders";

const ACCENT = ACCENTS.insights.color;
const TABS: { key: TeamTab; label: string }[] = [
  { key: "residential", label: "Residential" },
  { key: "commercial", label: "Commercial" },
  { key: "epc", label: "EPC partners" },
];

export default function TeamAnalyticsPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const [data, setData] = useState<TeamData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<TeamTab>("residential");
  const [preset, setPreset] = useState<Preset>("month");
  const [cs, setCs] = useState("");
  const [ce, setCe] = useState("");
  const lenders = useLenders();

  useEffect(() => { loadTeamData().then(setData, () => setFailed(true)); }, []);
  const w = useMemo(() => computeWindows(preset, new Date(), cs, ce), [preset, cs, ce]);

  return (
    <div className="min-h-screen lg:flex" style={themeStyle("insights")}>
      <AdminSidebar active="insights" />
      <div className="flex-1 min-w-0">
        <div className="sticky top-14 lg:top-0 z-20 bg-[var(--acc-page)] backdrop-blur border-b border-black/[0.06]">
          <div className="w-full px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3">
            <SectionMark k="insights" />
            <h1 className="font-display text-[24px] sm:text-[28px] font-bold mr-2" style={{ color: ACCENT }}>Team analytics</h1>
            <div className="inline-flex rounded-xl border border-black/[0.08] bg-white p-1 shadow-sm">
              {TABS.map((t) => {
                const on = tab === t.key;
                return (
                  <button key={t.key} type="button" onClick={() => setTab(t.key)}
                    className="px-4 py-1.5 rounded-[9px] text-[13px] font-semibold transition-colors"
                    style={on ? { background: ACCENT, color: "#fff" } : { color: "#475569" }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}
                className="rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-[13px] font-medium outline-none shadow-sm focus:border-[var(--acc)]">
                {(["today", "week", "month", "quarter", "year", "custom"] as Preset[]).map((p) => (
                  <option key={p} value={p}>{PRESET_LABEL[p]}</option>
                ))}
              </select>
              {preset === "custom" && (
                <>
                  <input type="date" value={cs} onChange={(e) => setCs(e.target.value)} aria-label="From"
                    className="rounded-xl border border-black/[0.08] bg-white px-2.5 py-2 text-[13px] outline-none focus:border-[var(--acc)]" />
                  <input type="date" value={ce} onChange={(e) => setCe(e.target.value)} aria-label="To"
                    className="rounded-xl border border-black/[0.08] bg-white px-2.5 py-2 text-[13px] outline-none focus:border-[var(--acc)]" />
                </>
              )}
            </div>
          </div>
        </div>

        <section className="w-full px-4 sm:px-6 py-6">
          {failed ? (
            <p className="text-[13px] text-red-600">Couldn&apos;t load the figures. Please refresh.</p>
          ) : !data ? (
            <p className="text-[13px] text-text-muted">Loading…</p>
          ) : (
            <TeamAnalytics data={data} tab={tab} w={w} lenders={lenders} />
          )}
        </section>
      </div>
    </div>
  );
}
