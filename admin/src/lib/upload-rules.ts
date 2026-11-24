// The file rules the document upload routes share (loan, insurance, quotation
// PDFs): the accepted types, and the cleaned name a stored copy gets.

/** JPEG / PNG / WebP / PDF. */
export const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/** The file name cleaned for a storage path (`fallback` when it has none), at most 80 characters. */
export function safeName(fileName: string, fallback: string): string {
  const raw = (fileName || fallback).replace(/[^\w.\-]+/g, "_").slice(0, 80);
  return raw || fallback;
}
