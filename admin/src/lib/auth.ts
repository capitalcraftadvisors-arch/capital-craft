import { decodeJwt } from "jose";
import { FUNCTIONS_URL } from "./supabase-config";

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
  // Owner account (0096) — sees the private Pri portal. Set by the auth
  // function at login; the server re-checks it for everything it unlocks.
  is_owner?: boolean;
  // An EPC staff login (0119) — the person signed in to this company; null /
  // absent = the company's owner. AuthGuard refreshes it (role / modules) on
  // every page; lib/epc-roles reads it.
  member?: { id: string; name: string; role: "ADMIN" | "SALES" | "VIEWER" | "SITE"; modules: string[] } | null;
  // The hidden demo EPC (0081) — Partner Portal v2 is switched on here first (lib/epc-roles portalV2).
  is_demo?: boolean;
  // Partner Portal v2 switched on for this EPC by CC (epc_subscriptions.portal_v2, 0133; AuthGuard reads it).
  portal_v2?: boolean;
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

// MAIN_ADMIN — mirrors the server's lib/hierarchy isMainAdmin(claims): a legacy
// admin with no role that still has analytics access counts as MAIN_ADMIN.
export function isMainAdmin(b: Business | null | undefined): boolean {
  if (!b || b.business_type !== "admin") return false;
  if (b.role === "MAIN_ADMIN") return true;
  return !b.role && canAccessModule(b, "analytics");
}

// Friendly greeting label for portal headings + the Namaste splash. The
// MAIN_ADMIN console is a shared "Admin" portal, so it's greeted generically as
// "Admin" (never the underlying account's personal contact_name); managers and
// RMs are greeted by their own first name.
export function greetingName(b: Business | null | undefined): string {
  if (b?.is_owner) return "Pri"; // the owner's own console (0096)
  if (b?.role === "MAIN_ADMIN") return "Admin";
  const full = (b?.member?.name || b?.contact_name || "").trim(); // an EPC staff login: its own name
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
/** sessionStorage: set by every login, played once by <LoginWelcome/> on the home page. */
export const GREET_KEY = "cc_greet";
/** sessionStorage: the account this tab's last guarded page opened as (pageOpened). */
const TAB_ACCOUNT_KEY = "cc_tab_account";

// The company + the person (an EPC staff login of the same company is someone else).
const accountKey = (b: Business) => `${b.id}:${b.member?.id ?? ""}`;

// password: required once CC has set one for the account (migration 0094) —
// the server then answers passwordRequired until it's given and correct.
type LoginResult = { ok: true; business: Business } | { ok: false; error: string; passwordRequired?: boolean; changeToken?: string };

// A first login with a password CC issued (0103) returns changeToken instead of
// a session: the EPC sets their own password with changePassword().
export async function login(mobile: string, otp: string, password?: string): Promise<LoginResult> {
  return authCall({ mobile, otp, ...(password ? { password } : {}) });
}

/** Sets the EPC's own password in place of the issued one, then logs in. */
export const changePassword = (changeToken: string, newPassword: string) =>
  authCall({ action: "change_password", change_token: changeToken, new_password: newPassword });

async function authCall(payload: Record<string, unknown>): Promise<LoginResult> {
  const res = await fetch(`${FUNCTIONS_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.must_change_password) return { ok: false, error: "", changeToken: data.change_token };
  if (!data.ok) return { ok: false, error: data.error || "login_failed", passwordRequired: !!data.password_required };
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(BUSINESS_KEY, JSON.stringify(data.business));
  localStorage.removeItem(IMPERSONATE_KEY);
  // Signal the dashboard to play the Namaste greeting once — set on EVERY
  // login so it fires for whoever just signed in (not once per browser).
  try { sessionStorage.setItem(GREET_KEY, "1"); } catch { /* ignore */ }
  return { ok: true, business: data.business };
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(BUSINESS_KEY);
  localStorage.removeItem(IMPERSONATE_KEY);
}

// The login is shared by every tab of this browser (localStorage). When ANOTHER
// tab signs in as a different account, or signs out, `cb` runs — so this tab
// never keeps acting (marking messages seen, saving) under a name it no longer
// shows. A refresh of the same account's row is ignored.
export function onSessionChangeElsewhere(cb: () => void): () => void {
  const idOf = (v: string | null) => {
    try { const b = v ? (JSON.parse(v) as Business) : null; return b ? accountKey(b) : null; } catch { return null; }
  };
  const h = (e: StorageEvent) => {
    if (e.key === TOKEN_KEY && e.newValue === null) cb();
    else if (e.key === BUSINESS_KEY && idOf(e.oldValue) !== idOf(e.newValue)) cb();
  };
  window.addEventListener("storage", h);
  return () => window.removeEventListener("storage", h);
}

// A login lasts 12 hours (auth function); one made before logins expired has no
// expiry and is refused by the server (0135). Either way it counts as signed out.
function expired(token: string): boolean {
  try {
    const { exp } = decodeJwt(token);
    return !exp || exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(TOKEN_KEY);
  return token && !expired(token) ? token : null;
}

/** A login is still stored but has run out → sign out. */
export function sessionEnded(): boolean {
  if (typeof window === "undefined") return false;
  const token = localStorage.getItem(TOKEN_KEY);
  return !!token && expired(token);
}

/** Headers for a call to our own API as the signed-in user: `extra` (e.g.
 *  { "Content-Type": "application/json" }) plus `Authorization: Bearer <token>`
 *  ("Bearer " with no token when signed out). Read fresh on every call. */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...extra, Authorization: `Bearer ${getToken() ?? ""}` };
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
  if (b.business_type === "admin") return b.is_owner ? "/admin/pri" : "/admin"; // owner lands on Pri
  // Step 6 saves current_step 7 = "all steps done" → the Review page (there is no step-7).
  if (b.status === "draft") return (b.current_step ?? 1) >= 7 ? "/onboarding/review" : `/onboarding/step-${Math.max(1, b.current_step || 1)}`;
  // The dashboard is reachable when EITHER loans or insurance is unlocked;
  // the dashboard itself shows whichever apply buttons the EPC is entitled to.
  if (portalAccess(b)) return "/dashboard";
  return "/status";
}

// ── Back to the page that asked for a login ─────────────────────────────────
// A signed-out visit to a portal page (an email link, a bookmark, a login that
// ran out) goes to /login?next=<that page>, and the login lands there. Only a
// path inside this app counts — never another site, an API route or /login.
const NEXT_BASE = "https://app.invalid";

/** `raw` as a safe in-app path ("/dashboard/leads?f=due"), or null. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 1000 || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  let u: URL;
  try { u = new URL(raw, NEXT_BASE); } catch { return null; }
  // Checked after parsing: "/\t/evil.com" parses as another host, "/.//evil.com" cleans up to "//evil.com".
  if (u.origin !== NEXT_BASE || u.pathname.startsWith("//")) return null;
  if (u.pathname === "/" || u.pathname.startsWith("/login") || u.pathname.startsWith("/api/")) return null;
  return u.pathname + u.search + u.hash;
}

/** "/login", or "/login?next=<path>" so the login comes back to `path`. */
export function loginHref(path?: string | null): string {
  const next = safeNext(path);
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

/** The current page as a `next` target (browser only). */
export function currentPath(): string | null {
  return typeof window === "undefined" ? null : window.location.pathname + window.location.search;
}

function tabAccount(): string | null {
  try { return sessionStorage.getItem(TAB_ACCOUNT_KEY); } catch { return null; }
}

/** Where a fresh login lands: the page that asked for it (?next=), else the account's home.
 *  A tab last open as another account goes home: its page was someone else's. A new tab
 *  (an email link) has no account yet, so its page is followed. */
export function afterLoginRoute(
  b: Business,
  search: string = typeof window === "undefined" ? "" : window.location.search,
  lastAccount: string | null = tabAccount(),
): string {
  const next = safeNext(new URLSearchParams(search).get("next"));
  return next && (!lastAccount || lastAccount === accountKey(b)) ? next : routeForBusiness(b);
}

/** A guarded page has opened for `b` (AuthGuard): remember the tab's account, and drop
 *  the login welcome unless this is the account's home (a login bounced home keeps it). */
export function pageOpened(b: Business, pathname: string = window.location.pathname): void {
  try {
    sessionStorage.setItem(TAB_ACCOUNT_KEY, accountKey(b));
    if (pathname !== routeForBusiness(b)) sessionStorage.removeItem(GREET_KEY);
  } catch { /* storage blocked */ }
}
