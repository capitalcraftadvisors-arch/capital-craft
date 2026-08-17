// Server-side hierarchy/permission helpers, driven off the verified JWT claims
// (jwt.ts adds hierarchy_role + allowed_modules). Kept dependency-free so it's
// safe to import from any API route.
//
// NOTE on Analytics: it is a client-rendered page with NO dedicated API route,
// and the data it aggregates is data an OPERATIONS_USER can already read (they
// have the operational modules). So "backend prevention" of Analytics is the
// page guard (AuthGuard requireModule, run against the freshly re-fetched row
// that a DB trigger stops users from editing) — there is no server endpoint to
// gate. This helper exists for module-scoped routes we add later and for the
// Main-Admin-only hierarchy routes (reassignment, team management).

import type { JwtClaims } from "./jwt";

export type ModuleKey = "epcs" | "apps" | "loanleads" | "insurance" | "leads" | "analytics";
const ALL_MODULES: ModuleKey[] = ["epcs", "apps", "loanleads", "insurance", "leads", "analytics"];

// The modules this token is allowed. An admin token without an explicit list
// (legacy, minted before 0066) is treated as full-access.
export function claimAllowedModules(claims: JwtClaims): ModuleKey[] {
  if (claims.business_type !== "admin") return [];
  const list = claims.allowed_modules;
  if (Array.isArray(list) && list.length > 0) {
    return list.filter((m): m is ModuleKey => (ALL_MODULES as string[]).includes(m));
  }
  return ALL_MODULES;
}

export function claimCanAccessModule(claims: JwtClaims, key: ModuleKey): boolean {
  return claimAllowedModules(claims).includes(key);
}

// MAIN_ADMIN — the only role allowed to manage the hierarchy (add/edit users,
// reassign across the team). A legacy admin token (no role) that still carries
// analytics access is treated as MAIN_ADMIN for back-compat.
export function isMainAdmin(claims: JwtClaims): boolean {
  if (claims.business_type !== "admin") return false;
  if (claims.hierarchy_role === "MAIN_ADMIN") return true;
  if (!claims.hierarchy_role && claimCanAccessModule(claims, "analytics")) return true;
  return false;
}
