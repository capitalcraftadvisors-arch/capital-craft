"use client";

// Partner Settings (Zoho-style) — the portal frame + a left rail of settings
// pages: Organization, Branding, Quotation preferences, Users & roles. The
// owner's and admins' only (lib/epc-roles); the database enforces the same.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import AuthGuard from "@/components/AuthGuard";
import PartnerShell, { NAVY } from "@/components/partner/PartnerShell";
import { getBusiness } from "@/lib/auth";
import { canManageOrg } from "@/lib/epc-roles";

const PAGES = [
  { href: "/dashboard/settings/organization", label: "Organization" },
  { href: "/dashboard/settings/branding", label: "Branding" },
  { href: "/dashboard/settings/quotes", label: "Quotation preferences" },
  { href: "/dashboard/settings/users", label: "Users & roles" },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allow={["approved"]}>
      <Settings>{children}</Settings>
    </AuthGuard>
  );
}

function Settings({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const allowed = canManageOrg(getBusiness());
  useEffect(() => { if (!allowed) router.replace("/dashboard" as any); }, [allowed, router]);
  if (!allowed) return null;
  return (
    <>
      <PartnerShell active="settings" title={<h1 className="font-display text-[22px] sm:text-[28px] font-bold text-[#0f3d2e]">Settings</h1>}>
        <main className="px-5 sm:px-8 pb-12 pt-3">
          <div className="grid gap-6 lg:grid-cols-[220px_1fr] max-w-[1100px]">
            <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:sticky lg:top-6 lg:self-start">
              {PAGES.map((p) => {
                const on = path === p.href;
                return (
                  <Link key={p.href} href={p.href as any}
                    className={["px-3.5 py-2.5 rounded-xl text-[13.5px] font-medium whitespace-nowrap transition-colors", on ? "text-white" : "text-text-mid hover:bg-white"].join(" ")}
                    style={on ? { background: NAVY } : undefined}>
                    {p.label}
                  </Link>
                );
              })}
            </nav>
            <div className="min-w-0">{children}</div>
          </div>
        </main>
      </PartnerShell>
    </>
  );
}
