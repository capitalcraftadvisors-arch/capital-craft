"use client";

// The admin-console users (Malvika, Manish, the main admin…) — one cached read
// of team_accounts (owner accounts left out, 0096), shared by:
//   useAdminNames()    id → contact_name, to show WHO created a record ("Created by")
//   useTeamAccounts()  the list with roles (the welcome card's team strip)
// Cached in sessionStorage (5 min) so switching dashboard tabs doesn't refetch —
// keeps egress down.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getCached, setCached } from "./list-cache";

export type TeamAccount = { id: string; contact_name: string | null; role: string | null };
const CACHE_KEY = "teamAccounts";

async function fetchTeam(): Promise<TeamAccount[]> {
  const cached = getCached<TeamAccount[]>(CACHE_KEY, 300000);
  if (cached) return cached;
  const { data } = await supabase().rpc("team_accounts");
  const rows = ((data ?? []) as TeamAccount[]).map(({ id, contact_name, role }) => ({ id, contact_name, role }));
  setCached(CACHE_KEY, rows);
  return rows;
}

export function useTeamAccounts(): TeamAccount[] {
  const [rows, setRows] = useState<TeamAccount[]>([]);
  useEffect(() => { void fetchTeam().then(setRows); }, []);
  return rows;
}

export function useAdminNames(): Map<string, string> {
  const rows = useTeamAccounts();
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => { setNames(new Map(rows.map((r) => [r.id, r.contact_name || "(unnamed)"]))); }, [rows]);
  return names;
}
