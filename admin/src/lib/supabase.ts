// Supabase JS client with the user's JWT attached as a Bearer token.
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = "https://hpebydmrpimyuxgsgtmu.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";
export const FUNCTIONS_URL = "https://hpebydmrpimyuxgsgtmu.supabase.co/functions/v1";

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
