// POST /api/admin/login-password/[id]
//   CC team:  { email }                               → generated + fixed email
//   EPC:      { to, cc[], subject, body, password }   → the reviewed draft
//
// MAIN ADMIN only. Emails the login password (always from the Capital Craft
// Gmail) and only then saves it (lib/login-password-server).

import { NextRequest, NextResponse } from "next/server";
import { err, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { emailLoginPassword, sendPasswordDraft, publicOrigin } from "@/lib/login-password-server";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req, { role: "main_admin", forbidden: "Only the main admin can send login passwords." });
    if (auth instanceof Response) return auth;
    const { token } = auth;
    if (!UUID_RE.test(params.id)) return err("Invalid id.", 400);

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const r = typeof b.body === "string"
      ? await sendPasswordDraft(token, params.id, {
          to: str(b.to), cc: Array.isArray(b.cc) ? b.cc.map(str) : [],
          subject: str(b.subject), body: str(b.body), password: str(b.password),
        })
      : await emailLoginPassword(token, params.id, { email: str(b.email) || null, origin: publicOrigin(req) });
    if (!r.ok) return err(r.error, r.status);
    return NextResponse.json({ ok: true, sentTo: r.sentTo ?? null });
  } catch (e) {
    const msg = errText(e);
    console.error("[login-password] error:", msg);
    return err(msg, 500);
  }
}
