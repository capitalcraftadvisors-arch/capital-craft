// The EPC's CUSTOM quotation template as a service (migration 0122) — shared by
// the partner portal, the admin console and the quotation route (no imports, so
// the server can use it too).
//   making — CC is building it (no ready template yet)
//   ready  — usable: within the 3 free months from ready_at, or switched on by CC
//   locked — the free months are over and CC hasn't switched it on

export const FREE_MONTHS = 3;

export type CustomTemplateRow = { ready_at: string | null; unlocked: boolean | null };
export type CustomState = "making" | "ready" | "locked";

/** The last free day's end: ready_at + 3 calendar months. */
export function freeUntil(readyAt: string): Date {
  const d = new Date(readyAt);
  d.setMonth(d.getMonth() + FREE_MONTHS);
  return d;
}

export function customState(t: CustomTemplateRow): CustomState {
  if (!t.ready_at) return "making";
  if (t.unlocked || Date.now() < freeUntil(t.ready_at).getTime()) return "ready";
  return "locked";
}

// The subscription = CC's On switch (unlocked). Without it the custom template
// locks after the free months, and WhatsApp sending stays closed (e-mail is open).
export const SUBSCRIPTION_MSG = "Please contact your relationship manager for services.";
export const CUSTOM_LOCKED_MSG = `Your custom template is locked. ${SUBSCRIPTION_MSG}`;
