// Where the Supabase project lives — the ONE home of its URL, its anon (public)
// key and its edge-functions URL. Read by the browser client (lib/supabase), the
// server route helpers (lib/api) and the JWT verifier (lib/jwt). Safe on both
// sides: nothing here but NEXT_PUBLIC_* values, which Next inlines at build time.
//
// Env-driven with the production values as fallback: a prod build (NEXT_PUBLIC_*
// from .env.production) behaves exactly as before; local dev (.env.local → the
// TEST project) is honoured. The anon key is public by design — it ships in the
// browser bundle; RLS and the caller's JWT decide what any request may do.

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";

export const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

export const FUNCTIONS_URL =
  process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co/functions/v1";
