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
  // Admin-set service on an approved EPC. Governs the portal buttons:
  //   insurance needs NO lender approval; loan still needs loan_app_unlocked.
  service_type?: "loans" | "insurance" | "both" | null;
  // Hierarchy (0066). Only meaningful for admin-type accounts.
  //   role            — MAIN_ADMIN sees all 6 dashboards incl Analytics;
  //                     OPERATIONS_USER sees only its allowed_modules.
  //   allowed_modules — authoritative tab-key permission set for this user.
  //   parent_user_id  — reporting manager (scalable org tree).
  role?: "MAIN_ADMIN" | "MANAGER" | "OPERATIONS_USER" | null;
  allowed_modules?: string[] | null;
  parent_user_id?: string | null;
};

// The six admin console module keys (match AdminSidebar tab keys).
export type ModuleKey = "epcs" | "apps" | "loanleads" | "insurance" | "leads" | "analytics";
export const ALL_MODULES: ModuleKey[] = ["epcs", "apps", "loanleads", "insurance", "leads", "analytics"];

// Resolve a user's allowed modules. MAIN_ADMIN (and any admin row without an
// explicit list — e.g. legacy admins before this claim existed) get everything;
// an OPERATIONS_USER gets exactly its stored list. Non-admins get nothing here
// (their access is governed by portalAccess, not modules).
export function allowedModules(b: Business | null | undefined): ModuleKey[] {
  if (!b || b.business_type !== "admin") return [];
  if (Array.isArray(b.allowed_modules) && b.allowed_modules.length > 0) {
    return b.allowed_modules.filter((m): m is ModuleKey => (ALL_MODULES as string[]).includes(m));
  }
  // Admin with no explicit list → full access (safe default for legacy admins).
  return ALL_MODULES;
}
export function canAccessModule(b: Business | null | undefined, key: ModuleKey): boolean {
  return allowedModules(b).includes(key);
}

// Friendly greeting label for portal headings + the Namaste splash. The
// MAIN_ADMIN console is a shared "Admin" portal, so it's greeted generically as
// "Admin" (never the underlying account's personal contact_name); managers and
// RMs are greeted by their own first name.
export function greetingName(b: Business | null | undefined): string {
  if (b?.role === "MAIN_ADMIN") return "Admin";
  const full = (b?.contact_name || "").trim();
  return full ? full.split(" ")[0] : "there";
}

// ── Portal access gating ──────────────────────────────────────────────
// Insurance unlocks purely from the service selection. Loan keeps its
// existing rule (a lender "Approved" tick, via loan_app_unlocked) AND now
// also requires the service to include loans.
export function insuranceAccess(b: Business | null | undefined): boolean {
  return b?.service_type === "insurance" || b?.service_type === "both";
}
export function loanAccess(b: Business | null | undefined): boolean {
  return b?.loan_app_unlocked === true && (b?.service_type === "loans" || b?.service_type === "both");
}
export function portalAccess(b: Business | null | undefined): boolean {
  return loanAccess(b) || insuranceAccess(b);
}

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
  // Signal the dashboard to play the Namaste greeting once — set on EVERY
  // login so it fires for whoever just signed in (not once per browser).
  try { sessionStorage.setItem("cc_greet", "1"); } catch { /* ignore */ }
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
  // The dashboard is reachable when EITHER loans or insurance is unlocked;
  // the dashboard itself shows whichever apply buttons the EPC is entitled to.
  if (portalAccess(b)) return "/dashboard";
  return "/status";
}
