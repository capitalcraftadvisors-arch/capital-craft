// GET /api/epc/quotes/<id>/pdf — a saved quotation (epc_quotes, 0118) as the
// standard PDF, built fresh on each download (lib/quote-pdf-server). Read with
// the caller's token: RLS decides who may.

import { NextRequest, NextResponse } from "next/server";
import { verifyJwt, getBearerToken } from "@/lib/jwt";
import { insuranceClient as userClient, UUID_RE } from "@/lib/insurance-server";
import { buildSavedQuotePdf } from "@/lib/quote-pdf-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const token = getBearerToken(req);
  if (!token || !(await verifyJwt(token).catch(() => null))) return err("unauthorized", 401);
  if (!UUID_RE.test(params.id)) return err("not_found", 404);
  const pdf = await buildSavedQuotePdf(userClient(token), params.id);
  if (!pdf) return err("not_found", 404);
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdf.name}"`, "Cache-Control": "no-store" },
  });
}
