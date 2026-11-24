// Server-only helpers for the /api route handlers — the boilerplate every route
// used to repeat: the error reply, the caller's database client and the login
// check at the top of each handler.
//
//   const auth = await requireLogin(req, { role: "admin" });
//   if (auth instanceof Response) return auth;
//   const { token, claims } = auth;
//   const supabase = dbAs(token);
//
// The database work goes through the caller's own token (RLS decides what it may
// read or change).

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt, type JwtClaims } from "./jwt";
import { isMainAdmin } from "./hierarchy";
import { SUPABASE_URL, SUPABASE_ANON } from "./supabase-config";

/** The standard failure reply: `{ ok: false, error: message }` with that status. */
export function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** A request-body value as trimmed text, or null when missing / blank. */
export function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/** A request-body value as a finite number, or null when missing / blank / not a number. */
export function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A Supabase client acting as the caller: their JWT on every request, so RLS applies. */
export function dbAs(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Loads one loan application row (`select` = its columns). Answers the row, or
 *  the reply to send back: 500 on a database error, 404 when there's no such row. */
export async function loadLoanRow(
  supabase: SupabaseClient, appId: string, select: string,
): Promise<Record<string, any> | NextResponse> {
  const { data, error } = await supabase
    .from("epc_applications")
    .select(select)
    .eq("id", appId)
    .maybeSingle();
  if (error) return err(error.message, 500);
  if (!data) return err("Loan application not found.", 404);
  return data as Record<string, any>;
}

/** A Supabase client with no login (the anon role) — for public routes only. */
export function publicDb(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Login = { token: string; claims: JwtClaims };

export type LoginOptions = {
  /** "admin": a Capital Craft team login. "main_admin": the main admin only. Omitted: any valid login. */
  role?: "admin" | "main_admin";
  /** The 403 message when the role doesn't match (default "admin_only" / "main_admin_only"). */
  forbidden?: string;
  /** The 401 message for a missing / invalid / expired token (default "unauthorized"). */
  unauthorized?: string;
};

/**
 * The login check at the top of a handler. Answers the caller's token + verified
 * claims, or the reply to send back: 401 when the Bearer token is missing,
 * invalid or expired; 403 when it isn't the required role. Never throws.
 */
export async function requireLogin(req: Request, opts: LoginOptions = {}): Promise<Login | NextResponse> {
  const token = getBearerToken(req);
  const claims = token ? await verifyJwt(token).catch((e: { code?: string; message?: string }) => {
    // An expired login is normal; anything else (e.g. the key set unreachable) is worth a log line.
    if (e?.code !== "ERR_JWT_EXPIRED") console.warn("[requireLogin]", e?.code ?? e?.message ?? String(e));
    return null;
  }) : null;
  if (!token || !claims) return err(opts.unauthorized ?? "unauthorized", 401);
  if (opts.role === "admin" && claims.business_type !== "admin") return err(opts.forbidden ?? "admin_only", 403);
  if (opts.role === "main_admin" && !isMainAdmin(claims)) return err(opts.forbidden ?? "main_admin_only", 403);
  return { token, claims };
}
