// An EPC's own organization settings (epc_org_profile, 0116 + 0117): display
// details, branding and quotation preferences. Pure — shared by the Settings
// pages, the image route and the quotation PDF. The cached read / save for the
// browser lives in lib/org-settings.

import { STANDARD, type PaymentStage, type Segment } from "./quotation-brands";

export type OrgImageKind = "logo" | "signature" | "stamp";
export const ORG_IMAGE_COLUMN: Record<OrgImageKind, "logo_path" | "signature_path" | "stamp_path"> = {
  logo: "logo_path", signature: "signature_path", stamp: "stamp_path",
};
/** A branding image's URL (served by /api/epc/org-image, cached by the browser). */
export const orgImageUrl = (path: string) => `/api/epc/org-image?p=${encodeURIComponent(path)}`;

export type QuoteDefaults = {
  validity?: Partial<Record<Segment, number>>;        // days
  payment?: Partial<Record<Segment, PaymentStage[]>>;
  timeline?: Partial<Record<Segment, string>>;
  warranty?: [string, string][];
  terms?: string;
  notes?: string;
};

export type OrgProfile = {
  business_id: string;
  logo_path: string | null; signature_path: string | null; stamp_path: string | null;
  display_name: string | null; address_line: string | null; city: string | null; state: string | null;
  pincode: string | null; phone: string | null; email: string | null; website: string | null;
  accent: string | null;
  quote_prefix: string; quote_next: number; gst_mode: "blended" | "lines";
  quote_defaults: QuoteDefaults;
};
export const ORG_COLS = "business_id, logo_path, signature_path, stamp_path, display_name, address_line, city, state, pincode, " +
  "phone, email, website, accent, quote_prefix, quote_next, gst_mode, quote_defaults";

/** An EPC that hasn't saved anything yet. */
export const emptyOrgProfile = (business_id: string): OrgProfile => ({
  business_id, logo_path: null, signature_path: null, stamp_path: null,
  display_name: null, address_line: null, city: null, state: null, pincode: null, phone: null, email: null, website: null,
  accent: null, quote_prefix: "Q-", quote_next: 1, gst_mode: "blended", quote_defaults: {},
});

// Accent colours offered in Branding (the first is the default).
export const ACCENTS = ["#14306b", "#0f7a52", "#b42318", "#c2410c", "#6d28d9", "#0e7490"];
export const DEFAULT_TERMS = [
  "Prices are valid till the date above.",
  "Any extra material or civil work beyond the scope above is charged at actuals.",
  "Delays caused by DISCOM approvals or site readiness do not count towards the timeline.",
  "Subject to local jurisdiction.",
].join("\n");

/** The EPC's quotation defaults for a segment — its own where set, else the standard ones. */
export function resolveQuoteDefaults(p: OrgProfile | null, segment: Segment) {
  const d = p?.quote_defaults ?? {};
  return {
    validity: d.validity?.[segment] ?? STANDARD.validityDays[segment],
    payment: d.payment?.[segment]?.length ? d.payment[segment]! : STANDARD.payment[segment],
    timeline: d.timeline?.[segment] || STANDARD.timeline[segment],
    warranty: d.warranty?.length ? d.warranty : STANDARD.warranty,
    terms: d.terms ?? DEFAULT_TERMS,
    notes: d.notes ?? "",
  };
}
