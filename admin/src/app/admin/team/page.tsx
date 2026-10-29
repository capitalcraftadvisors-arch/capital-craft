"use client";

// /admin/team moved to /admin/stakeholders (Team tab) — old links land there.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TeamRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin/stakeholders"); }, [router]);
  return null;
}
