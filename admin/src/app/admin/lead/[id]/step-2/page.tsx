"use client";

// Lead onboarding is now a SINGLE step (see ./step-1). This former Step 2 is
// kept only to redirect any stale links/drafts back to the single form.

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function LeadStep2Redirect() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  useEffect(() => {
    router.replace(`/admin/lead/${params.id}/step-1`);
  }, [params.id, router]);
  return <main className="min-h-screen grid place-items-center"><p className="text-text-muted">Redirecting…</p></main>;
}
