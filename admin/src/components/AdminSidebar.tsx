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

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { logout, getBusiness, allowedModules, canAccessModule, isMainAdmin, type ModuleKey } from "@/lib/auth";
import { pendingCount } from "@/lib/review";

export type ConsoleTab = "epcs" | "apps" | "loanleads" | "insurance" | "otherins" | "leads";
export type SectionKey = ConsoleTab | "analytics" | "board" | "pendings" | "team" | "pri";

// Per-console accent colors (C). Soft professional tints — accents only.
export const ACCENTS: Record<SectionKey, { label: string; color: string; tint: string }> = {
  epcs:      { label: "EPCs",              color: "#185fa5", tint: "#e8f1fb" },
  apps:      { label: "Loan applications", color: "#178a5c", tint: "#e7f5ee" },
  loanleads: { label: "Leads",             color: "#4338ca", tint: "#e8e7fb" },
  insurance: { label: "Solar Insurance",   color: "#0e7490", tint: "#e0f2f4" },
  otherins:  { label: "Other Insurance",   color: "#be185d", tint: "#fce7f3" },
  leads:     { label: "Leads (Non-EPC)",   color: "#b45309", tint: "#fbf0e0" },
  analytics: { label: "Analytics",         color: "#6d28d9", tint: "#efe9fb" },
  board:     { label: "Task Manager",      color: "#0f766e", tint: "#dcf3ef" },
  pendings:  { label: "Pendings",          color: "#b91c1c", tint: "#fdecec" },
  team:      { label: "Team",              color: "#334155", tint: "#eef1f5" },
  pri:       { label: "Pri portal",        color: "#7c2d12", tint: "#fbece4" },
};

const ICONS: Record<SectionKey, ReactNode> = {
  epcs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 21v-5h6v5M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01" /></svg>
  ),
  apps: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M9 13h6M9 17h4" /></svg>
  ),
  loanleads: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
  ),
  insurance: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
  ),
  otherins: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12a10 10 0 0 0-20 0z" /><path d="M12 12v7a2 2 0 0 0 4 0" /><path d="M12 2v1" /></svg>
  ),
  leads: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
  ),
  analytics: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 14l3-3 4 4 6-6" /></svg>
  ),
  board: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="6" height="18" rx="1"/><rect x="10.5" y="3" width="6" height="12" rx="1"/><rect x="18" y="3" width="3" height="9" rx="1"/></svg>
  ),
  pri: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /><rect x="9.5" y="10.5" width="5" height="4" rx="0.8" /><path d="M10.5 10.5V9a1.5 1.5 0 0 1 3 0v1.5" /></svg>
  ),
  team: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="4.5" /><path d="M10.7 12.3 21 2M16 7l3 3M19 4l2 2" /></svg>
  ),
  pendings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="M9 14l2 2 4-4" /></svg>
  ),
};

const ORDER: SectionKey[] = ["epcs", "apps", "loanleads", "insurance", "leads", "analytics"];

export default function AdminSidebar({
  active,
  onSelectTab,
  pendings,
  onPendingsClick,
}: {
  active: SectionKey;
  onSelectTab?: (t: ConsoleTab) => void;
  /** Live Pendings count from the Pendings page itself (overrides the cached badge). */
  pendings?: number;
  /** On the Pendings page: clicking Pendings again re-checks the list + badge. */
  onPendingsClick?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false); // mobile drawer

  // The nav list is scoped to the current user's allowed modules (hierarchy).
  // AuthGuard shows "Loading…" until it has re-fetched the row and called
  // setBusiness, so by the time this sidebar mounts getBusiness() is populated
  // and authoritative — a lazy init is safe (no SSR/hydration mismatch).
  const [navKeys] = useState<SectionKey[]>(() => {
    const biz = getBusiness();
    const mods = allowedModules(biz);                      // e.g. ['epcs','apps',...]
    const keys: SectionKey[] = ORDER.filter((k): k is ModuleKey => (mods as string[]).includes(k));
    // Ops Board is the primary work view — available to EVERY admin-type user
    // (MAIN_ADMIN sees all cases + RM tabs; an OPERATIONS_USER sees only their
    // own, enforced by RLS). Pinned to the top.
    if (biz?.business_type === "admin") keys.unshift("board");
    // Pendings — the main admin's checker queue (maker-checker, lib/review) —
    // and Other Insurance (general, non-solar) are the main admin's only.
    if (isMainAdmin(biz)) {
      keys.splice(1, 0, "pendings");
      const at = keys.indexOf("insurance");
      keys.splice(at >= 0 ? at + 1 : keys.length, 0, "otherins");
      keys.push("team"); // team logins (passwords)
    }
    // Pri portal — the owner's private console (0096); no one else sees it.
    if (biz?.is_owner) keys.push("pri");
    return keys;
  });
  const [cachedPending, setPending] = useState(0);
  useEffect(() => {
    // The Pendings page passes its own live count — no separate count query there.
    if (pendings == null && active !== "pendings" && navKeys.includes("pendings")) void pendingCount().then(setPending);
  }, [navKeys, pendings, active]);
  const pending = pendings ?? cachedPending;

  function go(key: SectionKey) {
    setOpen(false);
    // Pendings: every click re-checks (the page always loads the list fresh and
    // updates the red number from it).
    if (key === "pendings") {
      if (active === "pendings") onPendingsClick?.();
      else router.push("/admin/pendings");
      return;
    }
    if (key === active) return;
    if (key === "analytics") {
      router.push("/admin/analytics");
      return;
    }
    if (key === "board") {
      router.push("/admin/board");
      return;
    }
    if (key === "team") {
      router.push("/admin/team");
      return;
    }
    if (key === "pri") {
      router.push("/admin/pri");
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
    // In the static rail, labels are hidden until the rail is hovered; the
    // drawer always shows them. Icons center when collapsed, left-align on
    // hover (or in the drawer).
    const labelCls = inDrawer ? "" : "hidden group-hover:inline";
    const rowJustify = inDrawer ? "" : "justify-center group-hover:justify-start";
    return (
      <>
        {/* Brand — real logo. Collapsed rail shows just the swirl mark; the
            expanded panel / drawer shows the full wordmark. */}
        <div className={"flex items-center gap-2.5 px-1 h-12 mb-2 shrink-0 " + rowJustify}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/capital-craft-mark.png"
            alt="Capital Craft"
            className={"h-8 w-8 object-contain shrink-0 " + (inDrawer ? "hidden" : "group-hover:hidden")}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/capital-craft.png"
            alt="Capital Craft"
            className={"h-7 w-auto object-contain " + (inDrawer ? "block" : "hidden group-hover:block")}
          />
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-1">
          {navKeys.map((key) => {
            const on = active === key;
            const a = ACCENTS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => go(key)}
                aria-current={on ? "page" : undefined}
                aria-label={a.label}
                className={[
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-semibold transition-colors",
                  rowJustify,
                  on ? "" : "text-text-mid hover:bg-bg-tint hover:text-text",
                ].join(" ")}
                style={on ? { backgroundColor: a.tint, color: a.color } : undefined}
              >
                <span className="shrink-0 relative">
                  {ICONS[key]}
                  {key === "pendings" && pending > 0 && (
                    <span className="absolute -top-2 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[17px] text-center">
                      {pending > 99 ? "99+" : pending}
                    </span>
                  )}
                </span>
                <span className={"truncate " + labelCls}>{a.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Log out (bottom) */}
        <button
          type="button"
          onClick={() => { logout(); router.replace("/login"); }}
          aria-label="Log out"
          className={"mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-semibold text-text-mid hover:bg-bg-tint hover:text-text transition-colors " + rowJustify}
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/capital-craft.png" alt="Capital Craft" className="h-6 w-auto object-contain" />
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

      {/* Static rail (md+): a slim icons-only rail that reserves 68px of layout
          width. On hover, the fixed panel expands to 248px as an OVERLAY, so
          the content area never reflows. Collapses when the cursor leaves. */}
      <div className="hidden md:block shrink-0 w-[68px]">
        <div className="group fixed top-0 left-0 z-40 h-screen w-[68px] hover:w-[248px] transition-[width] duration-200 ease-out overflow-hidden flex flex-col border-r border-line bg-white p-3">
          {content(false)}
        </div>
      </div>
    </>
  );
}
