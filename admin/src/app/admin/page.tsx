"use client";

// Admin console shell: section header (title, period picker, greeting, bell),
// the main admin's KPI strip, and tab switching. Each tab lives in _console/,
// except Loan Leads (components/LoanLeadsTab).

import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar, { ACCENTS, SectionMark, themeStyle } from "@/components/AdminSidebar";
import { getBusiness, allowedModules, greetingName, isMainAdmin as isMainAdminUser } from "@/lib/auth";
import NotificationBell from "@/components/NotificationBell";
import LoginWelcome from "@/components/LoginWelcome";
import LoanLeadsTab from "@/components/LoanLeadsTab";
import { PeriodPicker, type Period, type TabPeriodProps } from "./_console/console-period";
import DashboardKpis, { type EpcKpis, type KpiRow } from "./_console/DashboardKpis";
import EpcsTab from "./_console/EpcsTab";
import AppsTab from "./_console/AppsTab";
import InsuranceTab from "./_console/InsuranceTab";
import OtherInsuranceTab from "./_console/OtherInsuranceTab";
import LeadsTab from "./_console/LeadsTab";

type Tab = "epcs" | "apps" | "loanleads" | "insurance" | "otherins" | "leads";

export default function AdminHomePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

const CONSOLE_TABS: Tab[] = ["epcs", "apps", "loanleads", "insurance", "leads"];

function Inner() {
  // Console tabs are scoped to the user's allowed modules (hierarchy). Today
  // every admin has all five; this keeps it correct for future users granted a
  // narrower set. Analytics is gated separately (its own route). Lazy init is
  // safe: AuthGuard has already set the fresh business before Inner mounts.
  const [allowedTabs] = useState<Tab[]>(() => {
    const mods = allowedModules(getBusiness()) as string[];
    const t = CONSOLE_TABS.filter((k) => mods.includes(k));
    const tabs = t.length ? t : [...CONSOLE_TABS];
    // Other Insurance (general, non-solar) — the main admin's only.
    if (isMainAdminUser(getBusiness())) tabs.push("otherins");
    return tabs;
  });
  // Initialise to the LAST tab the user was on (persisted below), so returning
  // to the console from anywhere lands where they left — not the default tab.
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = sessionStorage.getItem("adminList.activeTab") as Tab | null;
      if (saved && allowedTabs.includes(saved)) return saved;
    } catch { /* sessionStorage may be unavailable */ }
    return allowedTabs[0];
  });
  // Summary period is owned here so the picker can sit in the section header
  // (top-right). Default is per-tab: EPCs = This Year, all others = This Month.
  const [period, setPeriod] = useState<Period>("year");
  const [epcKpis, setEpcKpis] = useState<EpcKpis | null>(null); // EPC tab's counts → the KPI strip
  const [loanRows, setLoanRows] = useState<KpiRow[] | null>(null); // Loan tab's loaded list → the KPI strip
  const [pFrom, setPFrom] = useState("");
  const [pTo, setPTo] = useState("");

  // Coming back from a loan/insurance View should land on the right tab (the
  // list then restores scroll + highlights the row you came from). Consumed
  // once, so a fresh visit still defaults to EPCs. (Return from an EPC View
  // doesn't set this key, so it correctly stays on the EPCs tab.)
  // The ⌘K palette also signals it ("adminList.tab" event) when already on /admin.
  useEffect(() => {
    const consume = () => {
      const t = sessionStorage.getItem("adminList.tab") as Tab | null;
      if (t && allowedTabs.includes(t)) setTab(t);
      sessionStorage.removeItem("adminList.tab");
    };
    consume();
    window.addEventListener("adminList.tab", consume);
    return () => window.removeEventListener("adminList.tab", consume);
  }, [allowedTabs]);

  // Remember the active tab across navigation so every "back to console" button
  // (many of which just push /admin) returns to the tab the user was last on,
  // instead of always snapping to the default EPCs tab.
  useEffect(() => {
    try { sessionStorage.setItem("adminList.activeTab", tab); } catch { /* ignore */ }
  }, [tab]);

  // Restore the saved period for this tab (persists the user's choice across
  // navigation — opening a case and returning keeps it, until they change it),
  // else fall back to the tab default (EPCs = This Year, others = This Month).
  useEffect(() => {
    const def: Period = tab === "epcs" ? "year" : "month";
    try {
      const raw = localStorage.getItem(`adminPeriod.${tab}`);
      if (raw) {
        const s = JSON.parse(raw) as { period?: Period; from?: string; to?: string };
        setPeriod(s.period ?? def); setPFrom(s.from ?? ""); setPTo(s.to ?? "");
        return;
      }
    } catch { /* ignore */ }
    setPeriod(def); setPFrom(""); setPTo("");
  }, [tab]);

  // Persist the picker choice so it sticks per tab until changed again.
  const persistPeriod = (p: Period, from: string, to: string) => {
    try { localStorage.setItem(`adminPeriod.${tab}`, JSON.stringify({ period: p, from, to })); } catch { /* ignore */ }
  };
  const changePeriod = (p: Period) => { setPeriod(p); persistPeriod(p, pFrom, pTo); };
  const changeFrom = (v: string) => { setPFrom(v); persistPeriod(period, v, pTo); };
  const changeTo = (v: string) => { setPTo(v); persistPeriod(period, pFrom, v); };

  // The KPI strip is a business-wide money snapshot — shown to the MAIN_ADMIN
  // only (managers/RMs get the per-tab stage bar, not the top-line figures).
  const kpiBiz = getBusiness();
  const isMainAdmin = isMainAdminUser(kpiBiz);
  const section = ACCENTS[tab];
  // Tabs that carry summary cards + a period picker (loanleads/analytics don't).
  const showPeriod = tab === "epcs" || tab === "apps" || tab === "insurance" || tab === "otherins" || tab === "leads";
  const periodProps: TabPeriodProps = { period, pFrom, pTo };

  return (
    <div className="min-h-screen lg:flex transition-colors duration-300" style={themeStyle(tab)}>
      <LoginWelcome />
      <AdminSidebar active={tab} onSelectTab={setTab} />
      <div className="flex-1 min-w-0">
        <section className="w-full px-4 sm:px-6 py-8">
          {/* One header row: the section (its mark + title) on the left; the
              period picker, who is signed in and notifications on the right. */}
          <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <SectionMark k={tab} />
              <h1 className="font-display text-[24px] sm:text-[28px] font-bold" style={{ color: section.color }}>{section.label}</h1>
            </div>
            <div className="ml-auto flex items-center justify-end gap-3 flex-wrap">
              {showPeriod && (
                <PeriodPicker period={period} onPeriod={changePeriod} from={pFrom} onFrom={changeFrom} to={pTo} onTo={changeTo} />
              )}
              <span className="text-[13px] text-text-muted">Hi <span className="font-semibold text-[#178a5c]">{greetingName(getBusiness())}</span></span>
              <NotificationBell />
            </div>
          </div>
          {/* At-a-glance loan KPIs — MAIN_ADMIN only, compact. Driven by the
              period picker above, and a loan-money set on apps. */}
          {isMainAdmin && <DashboardKpis tab={tab} period={period} pFrom={pFrom} pTo={pTo} epc={epcKpis} loans={loanRows} />}

          {tab === "epcs" ? <EpcsTab {...periodProps} onKpis={setEpcKpis} />
            : tab === "apps" ? <AppsTab {...periodProps} onRows={setLoanRows} />
            : tab === "loanleads" ? <LoanLeadsTab />
            : tab === "insurance" ? <InsuranceTab {...periodProps} />
            : tab === "otherins" ? <OtherInsuranceTab {...periodProps} />
            : <LeadsTab {...periodProps} />}
        </section>
      </div>
    </div>
  );
}
