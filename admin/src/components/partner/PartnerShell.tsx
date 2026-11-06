"use client";

// The partner portal's frame — the navy icon rail (expands on hover), the
// mobile top nav and the header with the organization menu (logo / initial →
// Settings, Log out). The dashboard switches its own sections in place
// (onSection); every other page links back to them (/dashboard?s=<section>).
// The name and logo come from the cached read in lib/epc-name — no extra request.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { logout, getBusiness, greetingName, loanAccess, insuranceAccess } from "@/lib/auth";
import { fetchEpcName, fetchEpcLogo, shortEpcName } from "@/lib/epc-name";
import { orgImageUrl } from "@/lib/org-profile";
import { fetchQuoteTemplate, type QuoteTemplate } from "@/lib/quotation-template";
import { SARVATRA } from "@/lib/quotation-brands";
import { canManageOrg, epcRole, hasModule, personName, ROLE_LABEL } from "@/lib/epc-roles";

export const NAVY = "#14235c", NAVY_ACCENT = "#1e3a8a";

export type PartnerSection = "home" | "loans" | "insurance" | "emi" | "documents" | "quotation" | "customers" | "settings";
export const PARTNER_SECTIONS: PartnerSection[] = ["home", "loans", "insurance", "emi", "documents", "customers"];

const ICON: Record<PartnerSection, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  loans: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  insurance: <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />,
  emi: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h3M8 15h3" /></>,
  documents: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  quotation: <><path d="M3 11V4a1 1 0 0 1 1-1h7l9 9-8 8-9-9Z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  customers: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
};

const SETTINGS_HREF = "/dashboard/settings/organization";

export default function PartnerShell({ active, onSection, badge = 0, quoteTpl, title, children }: {
  active: PartnerSection | null;
  onSection?: (s: PartnerSection) => void; // the dashboard: switch sections in place
  badge?: number;                          // open "Document pending" count
  quoteTpl?: QuoteTemplate | null;         // the dashboard's own read; omitted → the cached one
  title?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const me = getBusiness();
  const [name, setName] = useState(() => shortEpcName(me?.contact_name) || greetingName(me));
  const [logo, setLogo] = useState<string | null>(null);
  const [tpl, setTpl] = useState<QuoteTemplate | null>(quoteTpl ?? null);
  useEffect(() => { void fetchEpcName().then(setName); void fetchEpcLogo().then(setLogo); }, []);
  useEffect(() => {
    if (quoteTpl !== undefined) { setTpl(quoteTpl); return; }
    fetchQuoteTemplate().then(setTpl, () => setTpl(null));
  }, [quoteTpl]);

  const customers = tpl?.storage_path === SARVATRA.key;
  const quotes = hasModule(me, "quotes"), manage = canManageOrg(me);
  // A staff login sees only its modules (lib/epc-roles); Settings is the owner's / admins'.
  const nav: { key: PartnerSection; label: string; show: boolean; href?: string }[] = [
    { key: "home", label: "Dashboard", show: true },
    { key: "loans", label: "Loans", show: loanAccess(me) && hasModule(me, "loans") },
    { key: "insurance", label: "Insurance", show: insuranceAccess(me) && hasModule(me, "insurance") },
    { key: "documents", label: "Document pending", show: true },
    { key: "emi", label: "EMI calculator", show: true },
    { key: "customers", label: "Customer applications", show: customers && quotes },
    // Own builder (Bijlee, RVS …) or the standard saved Quotations for everyone else.
    { key: "quotation", label: tpl && !customers ? "Quotation builder" : "Quotations", show: !customers && quotes, href: tpl ? "/dashboard/quotation" : "/dashboard/quotes" },
    { key: "settings", label: "Settings", show: manage, href: SETTINGS_HREF },
  ];
  const items = nav.filter((n) => n.show);
  const go = (n: { key: PartnerSection; href?: string }) => {
    if (n.href) router.push(n.href as any);
    else if (onSection) onSection(n.key);
    else router.push((n.key === "home" ? "/dashboard" : `/dashboard?s=${n.key}`) as any);
  };
  const countPill = (n: number) => (n > 9 ? "9+" : String(n));

  return (
    <div className="min-h-screen flex bg-bg-soft">
      {/* Sidebar (desktop) — a slim icon rail that expands on hover to reveal
          labels + the full logo, overlaying the content (which reserves 68px). */}
      <div className="hidden md:block w-[68px] shrink-0" aria-hidden />
      <aside className="hidden md:flex group/side fixed top-0 left-0 z-40 h-screen w-[68px] hover:w-[224px] transition-[width] duration-200 ease-out flex-col text-white overflow-hidden shadow-xl" style={{ background: NAVY }}>
        <div className="flex flex-col h-full p-3">
          {/* Logo — mark when collapsed, full logo (on white) when expanded. */}
          <a href="/" className="flex items-center justify-center group-hover/side:justify-start h-11 mb-4 shrink-0">
            <span className="group-hover/side:hidden w-9 h-9 rounded-lg bg-white grid place-items-center shrink-0">
              <img src="/brand/capital-craft-mark.png" alt="" className="w-7 h-7 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            </span>
            <span className="hidden group-hover/side:flex items-center bg-white rounded-lg px-2.5 h-9">
              <img src="/brand/capital-craft.png" alt="Capital Craft" className="h-6 w-auto object-contain" />
            </span>
          </a>
          <nav className="flex flex-col gap-1 flex-1">
            {items.map((n) => {
              const on = active === n.key;
              const b = n.key === "documents" ? badge : 0;
              return (
                <button key={n.key} onClick={() => go(n)} title={n.label}
                  className={["relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium transition-colors justify-center group-hover/side:justify-start", on ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"].join(" ")}>
                  <span className="relative shrink-0">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON[n.key]}</svg>
                    {b > 0 && (
                      <span className="group-hover/side:hidden absolute -top-2 -right-2 min-w-[16px] h-[16px] px-1 grid place-items-center rounded-full bg-[#dc2626] text-white text-[9px] font-bold leading-none">{countPill(b)}</span>
                    )}
                  </span>
                  <span className="hidden group-hover/side:inline whitespace-nowrap">{n.label}</span>
                  {b > 0 && (
                    <span className="hidden group-hover/side:grid ml-auto min-w-[18px] h-[18px] px-1 place-items-center rounded-full bg-[#dc2626] text-white text-[10px] font-bold leading-none">{countPill(b)}</span>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="pt-3 border-t border-white/15 hidden group-hover/side:block">
            <div className="text-[12px] font-semibold truncate">{name}</div>
            <button onClick={() => { logout(); router.replace("/login"); }} className="text-[11.5px] text-white/60 hover:text-white mt-1 whitespace-nowrap">Log out</button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top nav */}
        <div className="md:hidden text-white px-4 py-3 flex items-center gap-3 overflow-x-auto" style={{ background: NAVY }}>
          <img src="/brand/capital-craft-mark.png" alt="" className="w-7 h-7 rounded-md bg-white object-contain p-0.5 shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          {items.map((n) => (
            <button key={n.key} onClick={() => go(n)} className={["relative text-[13px] whitespace-nowrap px-2 py-1 rounded-lg", active === n.key ? "bg-white/20" : "text-white/70"].join(" ")}>
              {n.label}
              {n.key === "documents" && badge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 grid place-items-center rounded-full bg-[#dc2626] text-white text-[9px] font-bold leading-none">{countPill(badge)}</span>
              )}
            </button>
          ))}
        </div>

        <header className="px-5 sm:px-8 pt-6 pb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">{title}</div>
          <OrgMenu name={name} logo={logo} person={me?.member ? `${personName(me)} · ${ROLE_LABEL[epcRole(me)]}` : null}
            onSettings={manage ? () => router.push(SETTINGS_HREF as any) : null} onLogout={() => { logout(); router.replace("/login"); }} />
        </header>

        {children}
      </div>
    </div>
  );
}

// The partner's own logo (or its initial) — who is signed in, Settings (owner / admins), Log out.
function OrgMenu({ name, logo, person, onSettings, onLogout }: {
  name: string; logo: string | null; person: string | null; onSettings: (() => void) | null; onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const avatar = (size: string) => logo ? (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={orgImageUrl(logo)} alt="" className={`${size} rounded-full bg-white border border-line object-contain p-1`} />
  ) : (
    <div className={`${size} rounded-full text-white grid place-items-center font-display font-bold text-[15px]`} style={{ background: NAVY_ACCENT }} aria-hidden>{(name || "C").slice(0, 1).toUpperCase()}</div>
  );
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 rounded-full hover:opacity-90">
        <div className="text-right hidden sm:block min-w-0">
          <div className="text-[13px] font-semibold text-[#0f3d2e] truncate max-w-[220px]">{name}</div>
          <div className="text-[11px] text-text-muted truncate max-w-[220px]">{person ?? "Portal"}</div>
        </div>
        {avatar("w-10 h-10")}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-56 rounded-2xl border border-line bg-white shadow-xl p-2">
          <div className="flex items-center gap-3 px-2 py-2 border-b border-line mb-1">
            {avatar("w-9 h-9 shrink-0")}
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-text truncate">{name}</span>
              {person && <span className="block text-[11.5px] text-text-muted truncate">{person}</span>}
            </span>
          </div>
          {onSettings && <button type="button" onClick={() => { setOpen(false); onSettings(); }} className="w-full text-left px-3 py-2 rounded-xl text-[13.5px] text-text hover:bg-bg-soft">Settings</button>}
          <button type="button" onClick={onLogout} className="w-full text-left px-3 py-2 rounded-xl text-[13.5px] text-red-600 hover:bg-red-50">Log out</button>
        </div>
      )}
    </div>
  );
}
