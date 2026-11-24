// Validation regexes — single source of truth, used in every form.
// Mirror product-flows.md §10.

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^\d{9,18}$/;
// An Indian PIN code: 6 digits, never starting with 0.
export const PINCODE_RE = /^[1-9]\d{5}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A GSTIN: 2-digit state code + PAN + entity digit + "Z" + check character (upper case).
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
// A database row id (uuid) — checked before an id from the URL or body reaches a query.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACCEPTED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function isAcceptedFileType(mime: string): boolean {
  return (ACCEPTED_FILE_TYPES as readonly string[]).includes(mime);
}
