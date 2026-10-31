"use client";

// Page frame for /admin/stakeholders and its profiles: the console sidebar
// (Stakeholders active) on the Stakeholders green. The main admin's only.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar, { ACCENTS, SectionMark, themeStyle } from "@/components/AdminSidebar";
import { getBusiness, isMainAdmin } from "@/lib/auth";

export default function StakeholderShell({ title, sub, back, actions, children }: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  back?: string;              // profile pages: where ← goes
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const allowed = isMainAdmin(getBusiness());
  useEffect(() => { if (!allowed) router.replace("/admin"); }, [allowed, router]);
  if (!allowed) return null;
  return (
    <div className="min-h-screen lg:flex" style={themeStyle("team")}>
      <AdminSidebar active="team" />
      <div className="flex-1 min-w-0">
        <header className="px-4 sm:px-6 py-5 border-b border-line flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {back ? (
              <a href={back} aria-label="Back" className="w-9 h-9 -ml-2 rounded-full grid place-items-center text-[#5a8a76] hover:bg-[#eef6f1] hover:text-[#0f3d2e] shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </a>
            ) : (
              <SectionMark k="team" />
            )}
            <div className="min-w-0">
              <h1 className="font-display text-[22px] sm:text-[26px] font-bold truncate" style={{ color: ACCENTS.team.color }}>{title}</h1>
              {sub && <div className="text-[13px] text-text-muted truncate">{sub}</div>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
        <main className="px-4 sm:px-6 py-5">{children}</main>
      </div>
    </div>
  );
}
