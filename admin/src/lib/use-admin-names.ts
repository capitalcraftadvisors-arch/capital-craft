"use client";

// id → contact_name for every admin-console user (Malvika, Manish, the main
// admin…). Used to show WHO created a record ("Created by") from its
// created_by_user_id. Cached in sessionStorage (5 min) so switching dashboard
// tabs doesn't refetch — keeps egress down.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getCached, setCached } from "./list-cache";

const CACHE_KEY = "adminNames";

export function useAdminNames(): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void (async () => {
      const cached = getCached<[string, string][]>(CACHE_KEY, 300000);
      if (cached) { setNames(new Map(cached)); return; }
      const { data } = await supabase().from("epc_business").select("id, contact_name").eq("business_type", "admin");
      const pairs = ((data ?? []) as { id: string; contact_name: string | null }[])
        .map((r) => [r.id, r.contact_name || "(unnamed)"] as [string, string]);
      setCached(CACHE_KEY, pairs);
      setNames(new Map(pairs));
    })();
  }, []);
  return names;
}
