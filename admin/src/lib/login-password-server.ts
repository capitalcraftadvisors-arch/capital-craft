// Server-only. Login passwords by email (migration 0094), always sent from the
// Capital Craft Gmail (lib/mailer):
//   emailLoginPassword — CC team: the server generates the password and sends
//                        a fixed email to the address the main admin typed.
//   sendPasswordDraft  — EPCs: the main admin reviewed / edited a drafted email
//                        that already carries the generated password, and
//                        wrote any CC; we send exactly that.
//
// Order matters: the mail goes out FIRST and the password is saved only after
// it was sent — a failed email never leaves the account with a password nobody
// knows. Saving goes through set_login_password under the caller's JWT, so the
// database enforces that only the main admin can set one.

import { insuranceClient as callerClient } from "./insurance-server";
import { generateStrongPassword } from "./password-gen";
import { sendMail, mailConfigured } from "./mailer";
import { EMAIL_RE } from "./validators";

/** The portal's public origin as the browser saw it (Cloud Run sits behind a
 *  proxy, so the forwarded host wins over the container's own address). */
export function publicOrigin(req: { headers: Headers }): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

export type PasswordMailResult = { ok: true; sentTo?: string } | { ok: false; error: string; status: number };

export async function emailLoginPassword(
  token: string,
  accountId: string,
  opts: { email?: string | null; origin: string },
): Promise<PasswordMailResult> {
  const db = callerClient(token);
  const { data: acc, error } = await db.from("epc_business")
    .select("id, business_type, contact_name, trade_name, legal_name, contact_mobile, contact_email")
    .eq("id", accountId).maybeSingle();
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!acc) return { ok: false, error: "Account not found.", status: 404 };

  const to = String(opts.email || acc.contact_email || "").trim();
  if (!EMAIL_RE.test(to)) return { ok: false, error: "Enter a valid email to send the password to.", status: 400 };
  if (!acc.contact_mobile) return { ok: false, error: "This account has no login mobile number.", status: 400 };
  if (!mailConfigured()) return { ok: false, error: "Email isn't configured yet (app password missing).", status: 500 };

  const password = generateStrongPassword();
  const isTeam = acc.business_type === "admin";
  const greet = acc.contact_name || acc.trade_name || acc.legal_name || "there";
  const loginUrl = `${opts.origin}/login`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const intro = isTeam
    ? "Your Capital Craft team login is ready."
    : `Your EPC partner account${acc.trade_name || acc.legal_name ? ` (${esc(acc.trade_name || acc.legal_name)})` : ""} has been approved by Capital Craft. Your partner portal login is ready.`;

  try {
    await sendMail({
      to,
      subject: isTeam ? "Your Capital Craft login" : "Your Capital Craft partner portal login",
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f3d2e;line-height:1.55">
        <p>Namaste ${esc(greet)},</p>
        <p>${intro}</p>
        <p style="margin:12px 0 4px"><span style="color:#5a8a76">Login:</span> <a href="${loginUrl}">${loginUrl}</a></p>
        <p style="margin:4px 0"><span style="color:#5a8a76">Mobile number:</span> <b>${esc(acc.contact_mobile)}</b></p>
        <p style="margin:12px 0 4px;color:#5a8a76">Password:</p>
        <div style="display:inline-block;font-family:monospace;font-size:16px;font-weight:bold;background:#f0faf5;border:1px solid #cdeadd;border-radius:6px;padding:6px 12px">${esc(password)}</div>
        <p>Please keep this password private.</p>
        <p style="margin-top:18px">Regards,<br/>Capital Craft Advisors</p>
      </div>`,
    });
  } catch (e) {
    return { ok: false, error: "Couldn't send the email — " + (e instanceof Error ? e.message : String(e)), status: 502 };
  }

  return savePassword(db, accountId, password, to);
}

async function savePassword(db: ReturnType<typeof callerClient>, accountId: string, password: string, to: string): Promise<PasswordMailResult> {
  const { error: setErr } = await db.rpc("set_login_password", { p_business_id: accountId, p_password: password });
  if (setErr) return { ok: false, error: "Email sent, but the password couldn't be saved — send it again. " + setErr.message, status: 500 };
  return { ok: true, sentTo: to };
}

// Strong and space-free (generated passwords never contain whitespace).
const STRONG = (p: string) => p.length >= 12 && !/\s/.test(p) && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);

/** Sends the main admin's reviewed draft (it must still contain the password), then saves the password. */
export async function sendPasswordDraft(
  token: string,
  accountId: string,
  d: { to: string; cc: string[]; subject: string; body: string; password: string },
): Promise<PasswordMailResult> {
  const to = d.to.trim();
  const cc = d.cc.map((x) => x.trim()).filter(Boolean);
  if (!EMAIL_RE.test(to)) return { ok: false, error: "Enter a valid To email.", status: 400 };
  const badCc = cc.find((x) => !EMAIL_RE.test(x));
  if (badCc) return { ok: false, error: `"${badCc}" isn't a valid CC email.`, status: 400 };
  if (!d.subject.trim()) return { ok: false, error: "Subject is required.", status: 400 };
  if (!STRONG(d.password)) return { ok: false, error: "Password isn't strong — reopen the draft.", status: 400 };
  if (!d.body.includes(d.password)) return { ok: false, error: "The email must still contain the password.", status: 400 };
  if (!mailConfigured()) return { ok: false, error: "Email isn't configured yet (app password missing).", status: 500 };

  const db = callerClient(token);
  const { data: acc } = await db.from("epc_business").select("id").eq("id", accountId).maybeSingle();
  if (!acc) return { ok: false, error: "Account not found.", status: 404 };

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  try {
    await sendMail({
      to,
      ...(cc.length ? { cc } : {}),
      subject: d.subject.trim(),
      text: d.body,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f3d2e;line-height:1.55;white-space:pre-wrap">${esc(d.body)}</div>`,
    });
  } catch (e) {
    return { ok: false, error: "Couldn't send the email — " + (e instanceof Error ? e.message : String(e)), status: 502 };
  }
  return savePassword(db, accountId, d.password, to);
}
