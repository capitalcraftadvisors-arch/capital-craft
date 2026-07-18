// Server-only helpers shared by the insurance API routes.
//
// The routes operate through an RLS-scoped Supabase client built from the
// caller's JWT, so the DB's own_insurance / admin_all_insurance policies
// decide ownership — the EPC can only touch its own application; admin any.
// No route needs the service key.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
export const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_DIMENSION = 2000;

export function insuranceClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function safeName(fileName: string, fallback: string): string {
  const raw = (fileName || fallback).replace(/[^\w.\-]+/g, "_").slice(0, 80);
  return raw || fallback;
}

// Same compression as /api/upload and the loan extract routes: images →
// 2000px longest side, JPEG-80; PDFs pass through untouched.
export async function compress(file: File): Promise<{ buf: Buffer; mime: string }> {
  const input = Buffer.from(await file.arrayBuffer());
  if (!file.type.startsWith("image/")) return { buf: input, mime: file.type };
  const buf = await sharp(input)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  return { buf, mime: "image/jpeg" };
}

// ── Policy coverage period ───────────────────────────────
// Pulls the "from" and "to" dates (coverage start/end) out of an insurance
// policy's OCR text and normalises them to YYYY-MM-DD for the date columns.
// First-pass heuristics — TUNE against the real sample document; the route
// also saves policy_ocr_raw so the layout can be inspected, and the dates are
// admin-editable, so a miss is correctable.
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
// dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, dd Mon yyyy, dd-Mon-yyyy.
const DATE_SRC = "(\\d{1,2})\\s*[\\/\\-. ]\\s*([A-Za-z]{3,9}|\\d{1,2})\\s*[\\/\\-. ]\\s*(\\d{2,4})";

function toIso(dd: string, mmRaw: string, yyyy: string): string | null {
  const d = parseInt(dd, 10);
  let m: number;
  if (/^\d+$/.test(mmRaw)) m = parseInt(mmRaw, 10);
  else m = MONTHS[mmRaw.toLowerCase().slice(0, 4)] ?? MONTHS[mmRaw.toLowerCase().slice(0, 3)] ?? NaN;
  let y = parseInt(yyyy, 10);
  if (y < 100) y += 2000;
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null;
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parsePolicyPeriod(text: string): { from: string | null; to: string | null } {
  if (!text) return { from: null, to: null };
  const t = text.replace(/ /g, " ");
  const D = DATE_SRC;

  // 1. "Period of Insurance / Policy Period … <date> to/– <date>"
  const labelled = new RegExp(
    `(?:period\\s+of\\s+insurance|policy\\s+period|period)[^0-9]{0,40}${D}[^0-9A-Za-z]{0,25}(?:to|till|until|upto|up\\s*to|through|[–—-])[^0-9A-Za-z]{0,10}${D}`,
    "i",
  ).exec(t);
  if (labelled) {
    const from = toIso(labelled[1], labelled[2], labelled[3]);
    const to = toIso(labelled[4], labelled[5], labelled[6]);
    if (from && to) return { from, to };
  }

  // 2. "From <date> to <date>"
  const fromTo = new RegExp(
    `from\\s*[:\\-]?\\s*${D}\\s*(?:to|till|until|upto|up\\s*to|[–—-])\\s*${D}`,
    "i",
  ).exec(t);
  if (fromTo) {
    const from = toIso(fromTo[1], fromTo[2], fromTo[3]);
    const to = toIso(fromTo[4], fromTo[5], fromTo[6]);
    if (from && to) return { from, to };
  }

  // 3. Fallback — first two dates in the document, earliest as "from".
  const all: string[] = [];
  const re = new RegExp(D, "g");
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(t)) && all.length < 8) {
    const iso = toIso(mm[1], mm[2], mm[3]);
    if (iso) all.push(iso);
  }
  const uniq = [...new Set(all)].sort();
  if (uniq.length >= 2) return { from: uniq[0], to: uniq[uniq.length - 1] };
  if (uniq.length === 1) return { from: uniq[0], to: null };
  return { from: null, to: null };
}

// Pulls the invoice's final amount out of OCR text. Prefers a "Total …"
// line; else the largest ₹ figure with 4+ digits (final invoices are the
// biggest number on the page). Returns null when nothing plausible is found.
export function parseInvoiceAmount(text: string): number | null {
  if (!text) return null;
  const t = text.replace(/[₹,]/g, "");
  const labelled = t.match(/(?:grand\s*total|total\s*(?:amount|payable|invoice\s*value)?|net\s*payable|invoice\s*value)[^\d\n]{0,20}(\d{4,}(?:\.\d{1,2})?)/i);
  if (labelled) {
    const n = Number(labelled[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const nums = [...t.matchAll(/\b(\d{4,}(?:\.\d{1,2})?)\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n >= 1000 && n < 1e10);
  if (nums.length === 0) return null;
  return Math.round(Math.max(...nums));
}
