"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBusiness, getToken, routeForBusiness } from "@/lib/auth";

// Root page is a stateless router. Sends the user to /login if they have no
// token, otherwise routes them to the page that matches their business state.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const token = getToken();
    const biz = getBusiness();
    if (!token || !biz) {
      router.replace("/login");
    } else {
      router.replace(routeForBusiness(biz) as any);
    }
  }, [router]);

  return (
    <main className="min-h-screen grid place-items-center">
      <p className="text-text-muted">Loading…</p>
    </main>
  );
}
