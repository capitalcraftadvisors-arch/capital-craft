// Validation regexes — single source of truth, used in every form.
// Mirror product-flows.md §10.

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^\d{9,18}$/;
export const PINCODE_RE = /^\d{6}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ACCEPTED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function isAcceptedFileType(mime: string): boolean {
  return (ACCEPTED_FILE_TYPES as readonly string[]).includes(mime);
}
