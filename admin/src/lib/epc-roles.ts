// EPC staff roles (0119 / 0120) in the partner portal — what the signed-in
// person may do. The owner (the company's own login) has no member; a staff
// login carries business.member. The database enforces the same rules; these
// only decide what the portal shows.

import type { Business } from "./auth";

export type EpcRole = "OWNER" | "ADMIN" | "SALES" | "VIEWER";
export type StaffRole = Exclude<EpcRole, "OWNER">;
export type EpcModule = "loans" | "insurance" | "quotes";

export const STAFF_ROLES: StaffRole[] = ["ADMIN", "SALES", "VIEWER"];
export const ROLE_LABEL: Record<EpcRole, string> = { OWNER: "Owner", ADMIN: "Admin", SALES: "Sales", VIEWER: "Viewer" };
export const EPC_MODULES: { key: EpcModule; label: string }[] = [
  { key: "loans", label: "Loans" }, { key: "insurance", label: "Insurance" }, { key: "quotes", label: "Quotations" },
];

export const epcRole = (b: Business | null | undefined): EpcRole => (b?.member ? b.member.role : "OWNER");
/** Settings, users, bank details. */
export const canManageOrg = (b: Business | null | undefined) => ["OWNER", "ADMIN"].includes(epcRole(b));
/** Create / change loans, insurance, quotations. */
export const canWork = (b: Business | null | undefined) => epcRole(b) !== "VIEWER";
export const hasModule = (b: Business | null | undefined, m: EpcModule) => !b?.member || b.member.modules.includes(m);
/** The signed-in person's name (a staff member's own, else the company contact's). */
export const personName = (b: Business | null | undefined) => (b?.member?.name || b?.contact_name || "").trim();
