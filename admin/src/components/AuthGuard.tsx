"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Business, getBusiness, getToken, routeForBusiness, setBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type Allow = "any" | "draft" | "approved" | "admin" | "status";

type Props = {
  children: ReactNode;
  // Which states are allowed to view this page.
  // Anything else triggers a redirect to the user's "correct" page.
  allow: Allow[];
};

// Wraps any protected page. If no token -> /login. If token but business state
// doesn't match `allow`, route to the appropriate page (mirrors routeForBusiness).
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

    // Re-fetch the business row so we catch admin-side status changes.
    supabase()
      .from("epc_business")
      .select("id, status, business_type, current_step, contact_name")
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
  if (b.status === "approved") return allow.includes("approved");
  if (b.status === "under_review" || b.status === "on_hold" || b.status === "rejected") {
    return allow.includes("status");
  }
  return false;
}
