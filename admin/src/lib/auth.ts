import { FUNCTIONS_URL } from "./supabase";

// Shape returned by the `auth` Edge Function (plus epc_self_edited which
// AuthGuard re-fetches on every page mount so we can gate the wizard).
//
// loan_app_unlocked is the ONE boolean that decides whether an EPC sees
// the loan-app dashboard vs the "Under review" status page. It is a
// stored generated column on epc_business:
//   loan_app_unlocked = loan_app_grandfathered OR has_lender_approval
// EPCs never see the internal admin `status` field in any UI.
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
  loan_app_unlocked?: boolean;
};

const TOKEN_KEY = "cc_token";
const BUSINESS_KEY = "cc_business";
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

export function getImpersonatedBusiness(): Business | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(IMPERSONATE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Business; } catch { return null; }
}

// Decides where a user should land after login (or on any page mount).
//
// The EPC-facing routing is DECOUPLED from admin's internal `status`:
//   - draft            → onboarding wizard
//   - loan_app_unlocked → /dashboard (loan-app view)
//   - anything else    → /status ("Under review")
// This means an EPC with admin status='approved' but no lender approval
// AND no grandfather flag stays on /status. Conversely, an EPC whose
// admin status stays under_review but who's been ticked "approved" by
// any lender gets the /dashboard immediately.
export function routeForBusiness(b: Business): string {
  if (b.business_type === "admin") return "/admin";
  if (b.status === "draft") return `/onboarding/step-${Math.max(1, Math.min(b.current_step || 1, 7))}`;
  if (b.loan_app_unlocked === true) return "/dashboard";
  return "/status";
}
