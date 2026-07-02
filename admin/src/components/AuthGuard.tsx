"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Business, getBusiness, getToken, routeForBusiness, setBusiness } from "@/lib/auth";
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
  //   self_edit  — status='under_review' AND epc_self_edited=false, for the
  //                wizard re-entry pass.
  allow: Allow[];
};

export default function AuthGuard({ children, allow }: Props) {
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
    // the self-edit lock flag, and — critically — the loan_app_unlocked
    // gate. loan_app_unlocked is a stored generated column, always up to
    // date with the parent flags.
    supabase()
      .from("epc_business")
      .select("id, status, business_type, current_step, contact_name, epc_self_edited, epc_self_edited_at, loan_app_unlocked")
      .eq("id", biz.id)
      .maybeSingle()
      .then(({ data }: { data: Business | null }) => {
        const latest = (data as Business | null) ?? biz;
        if (data) setBusiness(latest);
        if (!matches(latest, allow)) {
          router.replace(routeForBusiness(latest) as any);
          return;
        }
        setReady(true);
      });
  }, [router, allow]);

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

  // Loan-app dashboard: decoupled from admin.status. Only loan_app_unlocked
  // grants entry to a page tagged "approved".
  if (allow.includes("approved") && b.loan_app_unlocked === true) return true;

  // Everything else routes through the "Under review" bucket. If the EPC's
  // loan_app is unlocked they shouldn't be here — refuse and let
  // routeForBusiness send them to /dashboard.
  if (b.status === "under_review" || b.status === "on_hold" || b.status === "rejected" || b.status === "approved") {
    if (b.loan_app_unlocked === true) return false;
    if (allow.includes("status")) return true;
    if (
      allow.includes("self_edit") &&
      b.status === "under_review" &&
      b.epc_self_edited !== true
    ) {
      return true;
    }
    return false;
  }
  return false;
}
