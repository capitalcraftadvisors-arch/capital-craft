// GET /api/admin/pincode-lookup?pin=XXXXXX
//
// Admin-only server-side proxy to the India Post pincode API. Two
// reasons this lives on the server rather than being called directly
// from the client:
//   1. Avoids CORS surprises (the upstream sometimes trips browsers).
//   2. Lets us cache with s-maxage — pincode data barely changes.
//
// Response shape:
//   { ok: true,  state: string, district: string, city: string }
//   { ok: false, error: string }

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PIN_RE = /^[1-9]\d{5}$/;
const UPSTREAM = "https://api.postalpincode.in/pincode/";

type PostOffice = {
  Name?: string;
  District?: string;
  State?: string;
};
type UpstreamItem = {
  Status?: string;
  PostOffice?: PostOffice[] | null;
};

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const pin = (req.nextUrl.searchParams.get("pin") ?? "").trim();
    if (!PIN_RE.test(pin)) return err("Enter a valid 6-digit Indian pincode.", 400);

    const upstream = await fetch(`${UPSTREAM}${pin}`, {
      // The upstream is a public endpoint but sometimes slow; give it
      // 8s and bail rather than blocking the admin form.
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);

    if (!upstream || !upstream.ok) {
      return err("Pincode lookup unavailable — enter state manually.", 502);
    }

    const data: unknown = await upstream.json().catch(() => null);
    const arr = Array.isArray(data) ? (data as UpstreamItem[]) : null;
    const first = arr?.[0] ?? null;
    if (!first || first.Status !== "Success" || !first.PostOffice?.length) {
      return err("No records for this pincode.", 404);
    }

    const po = first.PostOffice[0];
    const state    = (po.State    ?? "").trim();
    const district = (po.District ?? "").trim();
    const city     = (po.Name     ?? "").trim();

    return NextResponse.json(
      { ok: true, state, district, city },
      {
        headers: {
          // Cache at the edge for a day — pincode data is essentially static.
          "Cache-Control": "s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[pincode-lookup] error:", msg);
    return err(msg, 500);
  }
}
