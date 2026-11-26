// Login passwords (migration 0094) — client side. The password is generated
// and emailed by the server (/api/admin/login-password/[id]); logins check a
// bcrypt hash. An EPC login also keeps a readable copy that only the main admin
// reads back (0142, Stakeholders → EPCs); Capital Craft team logins never do.

import { supabase } from "./supabase";
import { authHeaders } from "./auth";

export type LoginPassword = { at: string; password: string | null };

/** Each login's password: when it was set, and (main admin, EPC logins) the password itself.
 *  Takes account ids and EPC staff member ids; logins without a password are absent. */
export async function loginPasswords(ids: string[]): Promise<Map<string, LoginPassword>> {
  if (!ids.length) return new Map();
  const { data } = await supabase().rpc("login_password_status", { p_business_ids: ids });
  return new Map(((data ?? []) as { business_id: string; updated_at: string; password: string | null }[])
    .map((r) => [r.business_id, { at: r.updated_at, password: r.password }]));
}

/** When each account's password was last set (accounts without one are absent). */
export async function loginPasswordStatus(businessIds: string[]): Promise<Map<string, string>> {
  return new Map([...(await loginPasswords(businessIds))].map(([id, v]) => [id, v.at]));
}

/** Main admin: a new one-time password for an EPC owner's login (changed at its next login). */
export async function setEpcLoginPassword(businessId: string, password: string) {
  const { error } = await supabase().rpc("set_login_password", { p_business_id: businessId, p_password: password });
  if (error) throw new Error(/password_not_strong/.test(error.message) ? "That password isn't strong enough." : error.message);
}

/** The login, ready to send on WhatsApp (or copy). */
export function loginShareText(l: { name: string; company?: string | null; mobile: string; password: string }): string {
  return [
    `Namaste ${l.name},`, "",
    `Your Capital Craft partner portal login${l.company ? ` (${l.company})` : ""}:`,
    `Login: ${window.location.origin}/login`,
    `Mobile number: ${l.mobile}`,
    `One-time password: ${l.password}`, "",
    "Log in with this one-time password and the portal will ask you to set your own password.",
  ].join("\n");
}

/** The EPC owner's password email (EpcPasswordEmailModal + Stakeholders → EPCs): first login → set your
 *  password; once it has one → reset it. */
export function epcPasswordMail(epc: { tradeName: string; contactName?: string | null; mobile?: string | null }, password: string, reset: boolean): { subject: string; body: string } {
  const login = [
    `Login: ${window.location.origin}/login`,
    `Mobile number: ${epc.mobile ?? ""}`,
    `One-time password: ${password}`,
  ];
  const close = ["", "Regards,", "Capital Craft Advisors"];
  const hello = `Namaste ${epc.contactName || epc.tradeName},`;
  if (reset) {
    return {
      subject: "Reset your Capital Craft partner portal password",
      body: [
        hello, "",
        `Here is a one-time password to reset the password of your Capital Craft partner portal login (${epc.tradeName}).`, "",
        ...login, "",
        "Log in with this one-time password and the portal will ask you to set a new password. Please choose one you will remember. Your old password no longer works, and this one-time password works only once.",
        ...close,
      ].join("\n"),
    };
  }
  return {
    subject: "Your Capital Craft partner portal login",
    body: [
      hello, "",
      `Your EPC partner account (${epc.tradeName}) has been approved by Capital Craft. Your partner portal login is ready.`, "",
      ...login, "",
      "Log in with this one-time password and the portal will ask you to set your own password. Please choose one you will remember — you'll use it every time you log in. This one-time password works only once.",
      ...close,
    ].join("\n"),
  };
}

export type PasswordEmailResult = { ok: boolean; sentTo?: string; error?: string };

async function post(businessId: string, body: Record<string, unknown>): Promise<PasswordEmailResult> {
  const res = await fetch(`/api/admin/login-password/${businessId}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
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
