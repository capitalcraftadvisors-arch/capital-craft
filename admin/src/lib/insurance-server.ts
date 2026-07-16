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
