// Supabase JS client with the user's JWT attached as a Bearer token.
// The token is stored in localStorage under "cc_token" (set by auth.ts on login).
// We build the client lazily so it picks up the latest token after a fresh login.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL!;

let _client: SupabaseClient | null = null;
let _tokenAtBuild: string | null = null;

export function supabase(): SupabaseClient {
  const token = typeof window !== "undefined" ? localStorage.getItem("cc_token") : null;
  if (_client && token === _tokenAtBuild) return _client;
  _tokenAtBuild = token;
  _client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
  return _client;
}
