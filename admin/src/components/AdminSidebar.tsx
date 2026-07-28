"use client";

// Left navigation for the admin console (replaces the old top tab bar).
//
// Solfin-style fixed sidebar: brand at the top, a vertical icon+label list,
// Log out pinned to the bottom. The active section is highlighted with its
// per-console accent (soft tint background + accent text/icon).
//
// Responsive:
//   - lg+  : full sidebar (icon + label).
//   - md   : icons-only rail.
//   - < md : hidden; a top bar with a hamburger opens a slide-in drawer.
//
// Routing is unchanged. On the console page the four list sections switch the
// in-page `tab` state (via onSelectTab) so scroll-restore + row-highlight keep
// working; Analytics is a separate route. On the Analytics page there is no
// onSelectTab, so a list section navigates back to /admin (seeding the tab via
// sessionStorage, the same key the console already restores from).

import { ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/auth";

export type ConsoleTab = "epcs" | "apps" | "insurance" | "leads";
export type SectionKey = ConsoleTab | "analytics";

// Per-console accent colors (C). Soft professional tints — accents only.
export const ACCENTS: Record<SectionKey, { label: string; color: string; tint: string }> = {
  epcs:      { label: "EPCs",              color: "#185fa5", tint: "#e8f1fb" },
  apps:      { label: "Loan applications", color: "#178a5c", tint: "#e7f5ee" },
  insurance: { label: "Insurance",         color: "#0e7490", tint: "#e0f2f4" },
  leads:     { label: "Leads (Non-EPC)",   color: "#b45309", tint: "#fbf0e0" },
  analytics: { label: "Analytics",         color: "#6d28d9", tint: "#efe9fb" },
};

const ICONS: Record<SectionKey, ReactNode> = {
  epcs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 21v-5h6v5M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01" /></svg>
  ),
  apps: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M9 13h6M9 17h4" /></svg>
  ),
  insurance: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
  ),
  leads: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
  ),
  analytics: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 14l3-3 4 4 6-6" /></svg>
  ),
};

const ORDER: SectionKey[] = ["epcs", "apps", "insurance", "leads", "analytics"];

export default function AdminSidebar({
  active,
  onSelectTab,
}: {
  active: SectionKey;
  onSelectTab?: (t: ConsoleTab) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false); // mobile drawer

  function go(key: SectionKey) {
    setOpen(false);
    if (key === active) return;
    if (key === "analytics") {
      router.push("/admin/analytics");
      return;
    }
    if (onSelectTab) {
      onSelectTab(key);
    } else {
      // Coming from a routed page (Analytics) → return to the console with the
      // chosen tab pre-selected (the console restores from this key on mount).
      sessionStorage.setItem("adminList.tab", key);
      router.push("/admin");
    }
  }

  function content(inDrawer: boolean) {
    const labelCls = inDrawer ? "" : "hidden lg:inline";
    return (
      <>
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-2 h-12 mb-2 shrink-0">
          <div
            className="w-8 h-8 rounded-lg grid place-items-center text-white font-display font-extrabold text-[15px] shrink-0"
            style={{ background: "linear-gradient(135deg,#185fa5,#178a5c)" }}
          >
            C
          </div>
          <span className={"font-display font-bold text-[16px] text-text whitespace-nowrap " + labelCls}>
            Capital&nbsp;Craft
          </span>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-1">
          {ORDER.map((key) => {
            const on = active === key;
            const a = ACCENTS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => go(key)}
                title={a.label}
                aria-current={on ? "page" : undefined}
                className={[
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-semibold transition-colors",
                  on ? "" : "text-text-mid hover:bg-bg-tint hover:text-text",
                ].join(" ")}
                style={on ? { backgroundColor: a.tint, color: a.color } : undefined}
              >
                <span className="shrink-0">{ICONS[key]}</span>
                <span className={"truncate " + labelCls}>{a.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Log out (bottom) */}
        <button
          type="button"
          onClick={() => { logout(); router.replace("/login"); }}
          title="Log out"
          className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-semibold text-text-mid hover:bg-bg-tint hover:text-text transition-colors"
        >
          <span className="shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>
          </span>
          <span className={"truncate " + labelCls}>Log out</span>
        </button>
      </>
    );
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-white px-4 h-14">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="p-2 -ml-2 text-text">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <span className="font-display font-bold text-[18px] grad-text">Capital Craft</span>
        <span className="w-8" />
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-0 h-full w-64 bg-white border-r border-line p-3 flex flex-col"
          >
            {content(true)}
          </aside>
        </div>
      )}

      {/* Static sidebar (md+) */}
      <aside className="hidden md:flex md:flex-col shrink-0 md:w-[68px] lg:w-[240px] border-r border-line bg-white sticky top-0 h-screen p-2 lg:p-3">
        {content(false)}
      </aside>
    </>
  );
}
