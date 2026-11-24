// GET /api/epc/quotes/<id>/pdf — a saved quotation (epc_quotes, 0118) as the
// standard PDF, built fresh on each download (lib/quote-pdf-server). Read with
// the caller's token: RLS decides who may.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { buildSavedQuotePdf } from "@/lib/quote-pdf-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireLogin(req);
  if (auth instanceof Response) return auth;
  const { token } = auth;
  if (!UUID_RE.test(params.id)) return err("not_found", 404);
  const pdf = await buildSavedQuotePdf(dbAs(token), params.id);
  if (!pdf) return err("not_found", 404);
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdf.name}"`, "Cache-Control": "no-store" },
  });
}
