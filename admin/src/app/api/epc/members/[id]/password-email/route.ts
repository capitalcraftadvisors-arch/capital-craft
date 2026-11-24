// POST /api/epc/members/[id]/password-email  { email, password }
//
// Emails an EPC staff login (0119) its password, from the Capital Craft Gmail —
// sent by the EPC's owner / admin (Partner Portal → Settings → Users & roles)
// or the Capital Craft main admin (Stakeholders → EPCs). The database decides
// who may set it (set_member_password); see lib/login-password-server.
import { NextRequest, NextResponse } from "next/server";
import { err, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { errText } from "@/lib/errors";
import { emailMemberPassword, publicOrigin } from "@/lib/login-password-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    if (!UUID_RE.test(params.id)) return err("Invalid id.", 400);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const r = await emailMemberPassword(auth.token, params.id, { email: str(b.email), password: str(b.password), origin: publicOrigin(req) });
    if (!r.ok) return err(r.error, r.status);
    return NextResponse.json({ ok: true, sentTo: r.sentTo ?? null });
  } catch (e) {
    const msg = errText(e);
    console.error("[member-password-email] error:", msg);
    return err(msg, 500);
  }
}
