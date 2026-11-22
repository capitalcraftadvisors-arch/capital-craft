// GET /api/epc/invoices/<id>/pdf — a GST tax invoice (epc_invoices, 0129) as a
// PDF, built fresh on each download (lib/invoice-pdf). Read with the caller's
// token: RLS decides who may (Owner / Admin / Viewer / Sales of the EPC; never
// Site staff). No subscription check — old invoices stay downloadable.

import { NextRequest, NextResponse } from "next/server";
import { verifyJwt, getBearerToken } from "@/lib/jwt";
import { insuranceClient as userClient, UUID_RE } from "@/lib/insurance-server";
import { buildInvoicePdf } from "@/lib/invoice-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const token = getBearerToken(req);
  if (!token || !(await verifyJwt(token).catch(() => null))) return err("Please sign in again.", 401);
  if (!UUID_RE.test(params.id)) return err("This invoice was not found.", 404);
  try {
    const pdf = await buildInvoicePdf(userClient(token), params.id);
    if (!pdf) return err("This invoice was not found.", 404);
    return new NextResponse(Buffer.from(pdf.bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdf.name}"`, "Cache-Control": "no-store" },
    });
  } catch {
    return err("Couldn't make the PDF.", 500);
  }
}
