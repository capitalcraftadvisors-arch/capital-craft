// Server-only. The portal's outgoing-mail sender (Gmail SMTP with the
// GMAIL_APP_PASSWORD secret), shared by every route that sends email; sendMailAs
// sends from an EPC's own Gmail (e.g. Sustera Ventures) with its app password.

import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import { DEFAULT_MAIL_SENDER } from "./mail-sender";

export const MAIL_SENDER = process.env.GMAIL_SENDER || DEFAULT_MAIL_SENDER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || "";

export const mailConfigured = (): boolean => !!GMAIL_PASS;

/** Sends one email from "Capital Craft" <sender>. Throws on failure. */
export async function sendMail(opts: Omit<SendMailOptions, "from">): Promise<void> {
  await sendMailAs({ user: MAIL_SENDER, pass: GMAIL_PASS, name: "Capital Craft" }, opts);
}

/** Sends one email from another Gmail account (its own app password). Throws on failure. */
export async function sendMailAs(account: { user: string; pass: string; name: string }, opts: Omit<SendMailOptions, "from">): Promise<void> {
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: account.user, pass: account.pass } });
  await transporter.sendMail({ from: `"${account.name}" <${account.user}>`, ...opts });
}
