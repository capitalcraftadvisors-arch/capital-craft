// EPC staff roles (0119 / 0120 / 0128) in the partner portal — what the signed-in
// person may do. The owner (the company's own login) has no member; a staff
// login carries business.member. The database enforces the same rules; these
// only decide what the portal shows.

import type { Business } from "./auth";

export type EpcRole = "OWNER" | "ADMIN" | "SALES" | "VIEWER" | "SITE";
export type StaffRole = Exclude<EpcRole, "OWNER">;
export type EpcModule = "loans" | "insurance" | "quotes";

export const STAFF_ROLES: StaffRole[] = ["ADMIN", "SALES", "VIEWER", "SITE"];
export const ROLE_LABEL: Record<EpcRole, string> = { OWNER: "Owner", ADMIN: "Admin", SALES: "Sales", VIEWER: "Viewer", SITE: "Site staff" };
export const EPC_MODULES: { key: EpcModule; label: string }[] = [
  { key: "loans", label: "Loans" }, { key: "insurance", label: "Insurance" }, { key: "quotes", label: "Quotations" },
];

export const epcRole = (b: Business | null | undefined): EpcRole => (b?.member ? b.member.role : "OWNER");
/** Settings, users, bank details. */
export const canManageOrg = (b: Business | null | undefined) => ["OWNER", "ADMIN"].includes(epcRole(b));
/** Create / change loans, insurance, quotations, leads. */
export const canWork = (b: Business | null | undefined) => !["VIEWER", "SITE"].includes(epcRole(b));
export const hasModule = (b: Business | null | undefined, m: EpcModule) => !b?.member || (b.member.role !== "SITE" && b.member.modules.includes(m));
/** Partner Portal v2 (leads, projects, Site staff, WhatsApp, …) — the demo EPC, and each EPC CC switches it on for (0133). */
export const portalV2 = (b: Business | null | undefined) => !!b?.is_demo || !!b?.portal_v2;
/** Site staff (0128): their projects only. */
export const isSiteStaff = (b: Business | null | undefined) => epcRole(b) === "SITE";
/** A role's name in the portal — Portal v2 calls Admin "Manager". */
export const roleLabel = (r: EpcRole, b: Business | null | undefined) => (r === "ADMIN" && portalV2(b) ? "Manager" : ROLE_LABEL[r]);
/** The roles a company can give its staff (Site staff with Portal v2). */
export const staffRoles = (b: Business | null | undefined) => STAFF_ROLES.filter((r) => r !== "SITE" || portalV2(b));
/** The signed-in person's name (a staff member's own, else the company contact's). */
export const personName = (b: Business | null | undefined) => (b?.member?.name || b?.contact_name || "").trim();
