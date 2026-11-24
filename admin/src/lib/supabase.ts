// Supabase JS client with the user's JWT attached as a Bearer token.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON, FUNCTIONS_URL } from "./supabase-config";
import { getToken } from "./auth";

// Re-exported for the existing importers (lib/ocr, the connector card).
export { FUNCTIONS_URL };

let _client: SupabaseClient | null = null;
let _tokenAtBuild: string | null = null;
export function supabase(): SupabaseClient {
  const token = getToken(); // null once the login has run out
  if (_client && token === _tokenAtBuild) return _client;
  _tokenAtBuild = token;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
  return _client;
}
