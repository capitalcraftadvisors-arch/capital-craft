// Supabase JS client with the user's JWT attached as a Bearer token.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON, FUNCTIONS_URL } from "./supabase-config";

// Re-exported for the existing importers (lib/auth, lib/ocr, the connector card).
export { FUNCTIONS_URL };

let _client: SupabaseClient | null = null;
let _tokenAtBuild: string | null = null;
export function supabase(): SupabaseClient {
  const token = typeof window !== "undefined" ? localStorage.getItem("cc_token") : null;
  if (_client && token === _tokenAtBuild) return _client;
  _tokenAtBuild = token;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
  return _client;
}
