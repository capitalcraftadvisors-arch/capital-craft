"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Business, ModuleKey, getBusiness, getToken, routeForBusiness, setBusiness, portalAccess, canAccessModule } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type Allow = "any" | "draft" | "approved" | "admin" | "status" | "self_edit";

type Props = {
  children: ReactNode;
  // Which states are allowed to view this page. Semantics:
  //   any        — anyone with a valid session
  //   admin      — matches business_type='admin'
  //   draft      — matches status='draft'
  //   approved   — DECOUPLED from admin.status. Matches iff loan_app_unlocked=true
  //                (grandfathered OR any lender approved). Used only by
  //                /dashboard.
  //   status     — the "Under review" page. Matches iff loan_app_unlocked
  //                is NOT true and status is one of under_review/on_hold/
  //                rejected/approved (admin still tracks the last two
  //                internally; the EPC just sees "Under review").
  //   self_edit  — epc_self_edited=false, for the one-time wizard re-entry.
  //                Available across submitted statuses (under_review /
  //                on_hold / approved / rejected). Once the EPC uses the
  //                pass, the DB trigger locks further non-admin writes.
  allow: Allow[];
  // Optional module gate (hierarchy). When set, an admin-type user must have
  // this module in their allowed_modules or they are bounced back to /admin.
  // This is what keeps an OPERATIONS_USER out of Analytics even by direct URL —
  // the check runs against the FRESHLY re-fetched row, not localStorage, and a
  // DB trigger prevents users from editing their own allowed_modules.
  requireModule?: ModuleKey;
};

export default function AuthGuard({ children, allow, requireModule }: Props) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    const biz = getBusiness();
    if (!token || !biz) {
      router.replace("/login");
      return;
    }

    // Re-fetch the business row so we catch admin-side status changes,
    // the self-edit lock flag, the loan_app_unlocked gate, and the hierarchy
    // role/allowed_modules (authoritative — never trust localStorage for
    // permission decisions).
    supabase()
      .from("epc_business")
      .select("id, status, business_type, current_step, contact_name, epc_self_edited, epc_self_edited_at, loan_app_unlocked, service_type, role, allowed_modules, parent_user_id")
      .eq("id", biz.id)
      .maybeSingle()
      .then(({ data }: { data: Business | null }) => {
        const latest = (data as Business | null) ?? biz;
        if (data) setBusiness(latest);
        if (!matches(latest, allow)) {
          router.replace(routeForBusiness(latest) as any);
          return;
        }
        // Module-level gate (e.g. Analytics is MAIN_ADMIN-only).
        if (requireModule && !canAccessModule(latest, requireModule)) {
          router.replace("/admin");
          return;
        }
        setReady(true);
      });
  }, [router, allow, requireModule]);

  if (!ready) {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-text-muted">Loading…</p>
      </main>
    );
  }
  return <>{children}</>;
}

function matches(b: Business, allow: Allow[]): boolean {
  if (allow.includes("any")) return true;
  if (b.business_type === "admin") return allow.includes("admin");
  if (b.status === "draft") return allow.includes("draft");

  // Portal dashboard: decoupled from admin.status. Loan OR insurance access
  // grants entry to a page tagged "approved".
  if (allow.includes("approved") && portalAccess(b)) return true;

  // Everything else routes through the "Under review" bucket. If the EPC has
  // portal access they shouldn't be here — refuse and let routeForBusiness
  // send them to /dashboard.
  if (b.status === "under_review" || b.status === "on_hold" || b.status === "rejected" || b.status === "approved") {
    if (portalAccess(b)) return false;
    if (allow.includes("status")) return true;
    // self_edit is a one-time pass available to any submitted EPC (status of
    // under_review / on_hold / approved / rejected — the outer branch above
    // already scoped us to those) that has NOT used their one edit yet. The
    // DB trigger + /api/epc/submit-self-edit enforce the lock via
    // epc_self_edited alone; no status guard needed here.
    if (
      allow.includes("self_edit") &&
      b.epc_self_edited !== true
    ) {
      return true;
    }
    return false;
  }
  return false;
}
