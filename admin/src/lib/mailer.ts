// Server-only. The portal's one outgoing-mail sender (Gmail SMTP with the
// GMAIL_APP_PASSWORD secret), shared by every route that sends email.

import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import { DEFAULT_MAIL_SENDER } from "./mail-sender";

export const MAIL_SENDER = process.env.GMAIL_SENDER || DEFAULT_MAIL_SENDER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || "";

export const mailConfigured = (): boolean => !!GMAIL_PASS;

/** Sends one email from "Capital Craft" <sender>. Throws on failure. */
export async function sendMail(opts: Omit<SendMailOptions, "from">): Promise<void> {
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: MAIL_SENDER, pass: GMAIL_PASS } });
  await transporter.sendMail({ from: `"Capital Craft" <${MAIL_SENDER}>`, ...opts });
}
