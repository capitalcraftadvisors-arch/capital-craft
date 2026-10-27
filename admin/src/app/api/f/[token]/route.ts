// GET /api/f/<token> — a document link we sent out (lender email, customer
// WhatsApp). Checks the signed token (lib/file-links) and redirects to a fresh
// 15-minute Google Cloud link for that file. Public by design: the recipient
// has no portal login; the token itself is the permission.

import { NextRequest, NextResponse } from "next/server";
import { getSignedReadUrl } from "@/lib/gcs";
import { readFileLinkToken } from "@/lib/file-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const r = readFileLinkToken(params.token);
  if ("error" in r) {
    return new NextResponse(r.error === "expired" ? "This link has expired." : "This link is not valid.", {
      status: r.error === "expired" ? 410 : 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  try {
    return NextResponse.redirect(await getSignedReadUrl(r.path, 900), 302);
  } catch {
    return new NextResponse("This file is no longer available.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
