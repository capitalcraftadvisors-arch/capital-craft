// Server-only. Document links we send out (lender emails, customer WhatsApp)
// go through the portal (/api/f/<token>): every click gets a fresh short-lived
// Google Cloud link, so a message keeps working past Google's 7-day cap on
// direct links. The token is the file path + an expiry, signed with the server
// secret — no database lookup on send or on click.

import { createHmac, timingSafeEqual } from "crypto";

/** How long a sent document link keeps working. */
export const FILE_LINK_DAYS = 90;

const SECRET = process.env.APP_JWT_SECRET || "";
const sign = (payload: string) => createHmac("sha256", SECRET).update("file-link:" + payload).digest("base64url");

export function fileLinkUrl(origin: string, path: string): string {
  if (!SECRET) throw new Error("APP_JWT_SECRET is not set on this server");
  const payload = Buffer.from(JSON.stringify({ p: path, e: Math.floor(Date.now() / 1000) + FILE_LINK_DAYS * 86400 })).toString("base64url");
  return `${origin}/api/f/${payload}.${sign(payload)}`;
}

/** The file path a link points to, or why it can't be opened. */
export function readFileLinkToken(token: string): { path: string } | { error: "invalid" | "expired" } {
  const [payload, sig] = token.split(".");
  if (!SECRET || !payload || !sig) return { error: "invalid" };
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { error: "invalid" };
  try {
    const { p, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p?: unknown; e?: unknown };
    if (typeof p !== "string" || typeof e !== "number") return { error: "invalid" };
    return e * 1000 < Date.now() ? { error: "expired" } : { path: p };
  } catch {
    return { error: "invalid" };
  }
}
