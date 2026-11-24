// The EPC's CUSTOM quotation template as a service (migration 0122) — shared by
// the partner portal, the admin console and the quotation route (no imports, so
// the server can use it too).
//   making — CC is building it (not marked ready yet)
//   locked — CC marked it ready; it opens once CC unlocks it (the EPC buys the
//            premium subscription first). No free months (the user, 25/11).
//   ready  — unlocked: the EPC makes quotations with it

export type CustomTemplateRow = { ready_at: string | null; unlocked: boolean | null };
export type CustomState = "making" | "ready" | "locked";

export function customState(t: CustomTemplateRow): CustomState {
  if (!t.ready_at) return "making";
  return t.unlocked ? "ready" : "locked";
}

// The subscription = CC's Unlock switch (unlocked). Without it the custom template
// stays locked, and WhatsApp sending stays closed (e-mail is open).
export const SUBSCRIPTION_MSG = "Please contact your relationship manager for services.";
export const CUSTOM_LOCKED_MSG = "Your custom template is ready. Buy the premium subscription to use it.";

/** What the main admin is asked before Ready / Unlock (EPC profile + Pendings). */
export const READY_CONFIRM = `Mark the custom template ready?\n\nThe EPC sees "${CUSTOM_LOCKED_MSG}" It stays locked until you unlock it.`;
export const UNLOCK_CONFIRM = "Unlock the custom template?\n\nThe EPC can make quotations with it from now on.";
