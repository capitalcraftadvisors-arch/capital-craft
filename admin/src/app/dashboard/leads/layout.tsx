"use client";

// Leads (partner portal, Partner Portal v2) — the portal frame around the list.

import type { ReactNode } from "react";
import AuthGuard from "@/components/AuthGuard";
import PartnerShell from "@/components/partner/PartnerShell";

export default function LeadsLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allow={["approved"]}>
      <PartnerShell active="leads" title={<h1 className="font-display text-[22px] sm:text-[28px] font-bold text-cc-ink">Leads</h1>}>
        <main className="px-5 sm:px-8 pb-12 pt-3">{children}</main>
      </PartnerShell>
    </AuthGuard>
  );
}
