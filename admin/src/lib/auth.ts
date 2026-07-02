import { FUNCTIONS_URL } from "./supabase";

// Shape returned by the `auth` Edge Function (plus epc_self_edited which
// AuthGuard re-fetches on every page mount so we can gate the wizard).
export type Business = {
  id: string;
  status: "draft" | "under_review" | "approved" | "on_hold" | "rejected";
  business_type:
    | "proprietorship"
    | "pvt_ltd"
    | "partnership"
    | "llp"
    | "admin"
    | null;
  current_step: number;
  contact_name: string | null;
  epc_self_edited?: boolean;
  epc_self_edited_at?: string | null;
};

const TOKEN_KEY = "cc_token";
const BUSINESS_KEY = "cc_business";
// When an admin creates a new EPC via "Add New EPC" and walks through the
// onboarding wizard on their behalf, this key holds the impersonated EPC's
// Business context. getBusiness() prefers it over the admin's own business.
// getToken() always returns the admin's real token — RLS lets an admin
// write any row, so no token swap is needed.
const IMPERSONATE_KEY = "cc_admin_impersonating";

export async function login(mobile: string, otp: string): Promise<{ ok: true; business: Business } | { ok: false; error: string }> {
  const res = await fetch(`${FUNCTIONS_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile, otp }),
  });
  const data = await res.json();
  if (!data.ok) return { ok: false, error: data.error || "login_failed" };
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(BUSINESS_KEY, JSON.stringify(data.business));
  // Any lingering impersonation from a prior admin session is cleared on
  // a fresh login so a new user never inherits it.
  localStorage.removeItem(IMPERSONATE_KEY);
  return { ok: true, business: data.business };
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(BUSINESS_KEY);
  localStorage.removeItem(IMPERSONATE_KEY);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

// Returns the impersonated business when the admin is walking the wizard
// on someone's behalf; falls back to the real logged-in business.
export function getBusiness(): Business | null {
  if (typeof window === "undefined") return null;
  const imp = localStorage.getItem(IMPERSONATE_KEY);
  if (imp) {
    try { return JSON.parse(imp) as Business; } catch { /* fall through */ }
  }
  const raw = localStorage.getItem(BUSINESS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Business; } catch { return null; }
}

// setBusiness writes to whichever slot is active — so state changes made
// by the wizard during impersonation update the impersonated context, not
// the admin's own business.
export function setBusiness(b: Business) {
  if (typeof window !== "undefined" && localStorage.getItem(IMPERSONATE_KEY)) {
    localStorage.setItem(IMPERSONATE_KEY, JSON.stringify(b));
    return;
  }
  localStorage.setItem(BUSINESS_KEY, JSON.stringify(b));
}

// ── Impersonation helpers ─────────────────────────────────────────────

export function beginImpersonation(b: Business) {
  localStorage.setItem(IMPERSONATE_KEY, JSON.stringify(b));
}

export function endImpersonation() {
  localStorage.removeItem(IMPERSONATE_KEY);
}

export function isImpersonating(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem(IMPERSONATE_KEY);
}

// Snapshot of the impersonated business for banner rendering.
export function getImpersonatedBusiness(): Business | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(IMPERSONATE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Business; } catch { return null; }
}

// Decides where a user should land after login (or on any page mount).
export function routeForBusiness(b: Business): string {
  if (b.business_type === "admin") return "/admin";
  if (b.status === "draft") return `/onboarding/step-${Math.max(1, Math.min(b.current_step || 1, 7))}`;
  if (b.status === "under_review" || b.status === "on_hold" || b.status === "rejected") return "/status";
  if (b.status === "approved") return "/dashboard";
  return "/login";
}
