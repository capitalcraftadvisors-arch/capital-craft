"use client";

// Quotations (partner portal) — the portal frame around the list and the editor.

import type { ReactNode } from "react";
import AuthGuard from "@/components/AuthGuard";
import PartnerShell from "@/components/partner/PartnerShell";

export default function QuotesLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allow={["approved"]}>
      <PartnerShell active="quotation" title={<h1 className="font-display text-[22px] sm:text-[28px] font-bold text-[#0f3d2e]">Quotations</h1>}>
        <main className="px-5 sm:px-8 pb-12 pt-3">{children}</main>
      </PartnerShell>
    </AuthGuard>
  );
}
