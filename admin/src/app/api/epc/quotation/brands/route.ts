// GET  /api/epc/quotation/brands        → { ok, options: { field: string[] } }
// POST /api/epc/quotation/brands {field,value} → persists a custom option forever
//
// Powers the "add custom" in the builder's searchable dropdowns. Custom values
// are global (shared across EPCs) so a brand typed once is there for everyone.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { BRAND_FIELDS, BOQ_COLUMNS, SARVATRA_ENERGY_BOQ, RVS_BOM, STANDARD_BOM, POTALIYA_BOM, boqField } from "@/lib/quotation-brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set<string>([
  ...Object.values(BRAND_FIELDS),
  ...[...SARVATRA_ENERGY_BOQ, ...RVS_BOM, ...STANDARD_BOM, ...POTALIYA_BOM].flatMap((r) => BOQ_COLUMNS.map((c) => boqField(r.key, c))),
]);

export async function GET(req: NextRequest) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token } = auth;
    const { data, error } = await dbAs(token).from("quotation_brand_options").select("field, value");
    if (error) return err(error.message, 500);
    const options: Record<string, string[]> = {};
    for (const r of (data ?? []) as { field: string; value: string }[]) {
      (options[r.field] ??= []).push(r.value);
    }
    return NextResponse.json({ ok: true, options });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token } = auth;
    const body = (await req.json().catch(() => ({}))) as { field?: string; value?: string };
    const field = String(body.field ?? "").trim();
    const value = String(body.value ?? "").trim();
    if (!ALLOWED.has(field)) return err("Invalid field.", 400);
    if (!value || value.length > 80) return err("Enter a valid value.", 400);
    const { error } = await dbAs(token)
      .from("quotation_brand_options")
      .upsert({ field, value }, { onConflict: "field,value" });
    if (error) return err(error.message, 500);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
