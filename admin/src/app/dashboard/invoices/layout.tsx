"use client";

// Invoices (partner portal, Partner Portal v2) — the portal frame around the list.

import type { ReactNode } from "react";
import AuthGuard from "@/components/AuthGuard";
import PartnerShell from "@/components/partner/PartnerShell";

export default function InvoicesLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allow={["approved"]}>
      <PartnerShell active="invoices" title={<h1 className="font-display text-[22px] sm:text-[28px] font-bold text-[#0f3d2e]">Invoices</h1>}>
        <main className="px-5 sm:px-8 pb-12 pt-3">{children}</main>
      </PartnerShell>
    </AuthGuard>
  );
}
