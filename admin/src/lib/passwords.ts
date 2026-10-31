// Login passwords (migration 0094) — client side. The password is generated
// and emailed by the server (/api/admin/login-password/[id]); logins check a
// bcrypt hash. An EPC's current password (issued, or the one they set) is also
// kept for the main admin to read back (0110); team passwords never are.

import { supabase } from "./supabase";
import { getToken } from "./auth";

/** When each account's password was last set (accounts without one are absent). */
export async function loginPasswordStatus(businessIds: string[]): Promise<Map<string, string>> {
  if (!businessIds.length) return new Map();
  const { data } = await supabase().rpc("login_password_status", { p_business_ids: businessIds });
  return new Map(((data ?? []) as { business_id: string; updated_at: string }[]).map((r) => [r.business_id, r.updated_at]));
}

/** Main admin: the EPC's current login password, or null when none is kept. */
export async function epcLoginPassword(businessId: string): Promise<string | null> {
  const { data, error } = await supabase().rpc("epc_login_password", { p_business_id: businessId });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export type PasswordEmailResult = { ok: boolean; sentTo?: string; error?: string };

async function post(businessId: string, body: Record<string, unknown>): Promise<PasswordEmailResult> {
  const res = await fetch(`/api/admin/login-password/${businessId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  return res.ok && d?.ok ? { ok: true, sentTo: d.sentTo } : { ok: false, error: d?.error || `HTTP ${res.status}` };
}

/** CC team: the server generates a new strong password and emails it to `email`. */
export const emailLoginPassword = (businessId: string, email: string) => post(businessId, { email });

/** EPC: sends the main admin's reviewed draft (it carries the generated password), then saves that password. */
export const sendPasswordDraft = (businessId: string, d: { to: string; cc: string[]; subject: string; body: string; password: string }) =>
  post(businessId, d);
