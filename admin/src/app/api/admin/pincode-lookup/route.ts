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
import { geminiExtract } from "@/lib/gemini-extract";

// Fallback: India Post is often blocked from cloud egress, so when it fails we
// ask Gemini (reachable from Cloud Run, same GOOGLE_VISION_API_KEY as the OCR)
// to resolve the PIN → state/district/city.
async function geminiPincode(pin: string): Promise<{ state: string; district: string; city: string } | null> {
  const out = await geminiExtract<{ state: string | null; district: string | null; city: string | null }>({
    images: [],
    label: "pincode",
    prompt: `Indian postal PIN code ${pin}. Return JSON with the official state, the district, and the main city/town/area for this PIN code. Use the correct official state name (e.g. "Rajasthan", "Delhi"). Give your best answer for the state even if unsure about the city.`,
    schema: {
      type: "OBJECT",
      properties: {
        state: { type: "STRING", nullable: true },
        district: { type: "STRING", nullable: true },
        city: { type: "STRING", nullable: true },
      },
    },
  });
  const state = (out?.state ?? "").trim();
  if (!state) return null;
  return { state, district: (out?.district ?? "").trim(), city: (out?.city ?? "").trim() };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PIN_RE = /^[1-9]\d{5}$/;
const UPSTREAM = "https://api.postalpincode.in/pincode/";

type PostOffice = {
  Name?: string;
  District?: string;
  State?: string;
  BranchType?: string;
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
    // Any authenticated user may look up a pincode — it's public India
    // Post data. Both the admin loan flow and the EPC-facing apply flow
    // call this.
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    await verifyJwt(token);

    const pin = (req.nextUrl.searchParams.get("pin") ?? "").trim();
    if (!PIN_RE.test(pin)) return err("Enter a valid 6-digit Indian pincode.", 400);

    // The India Post upstream has the data (verified for 303801 / 413581) but
    // is flaky/slow from cloud egress and intermittently returns Status:"Error"
    // or times out. The old single-attempt fetch surfaced those transient
    // misses as "not available". Retry a few times with a browser-like UA.
    let first: UpstreamItem | null = null;
    for (let attempt = 0; attempt < 3 && !first; attempt++) {
      const upstream = await fetch(`${UPSTREAM}${pin}`, {
        signal: AbortSignal.timeout(9000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; CapitalCraft/1.0)",
          Accept: "application/json",
        },
      }).catch(() => null);
      if (!upstream || !upstream.ok) continue;
      const data: unknown = await upstream.json().catch(() => null);
      const arr = Array.isArray(data) ? (data as UpstreamItem[]) : null;
      const cand = arr?.[0] ?? null;
      if (cand?.Status === "Success" && cand.PostOffice?.length) { first = cand; break; }
      // Otherwise a transient upstream hiccup — try again.
    }
    if (!first || !first.PostOffice?.length) {
      // India Post unreachable (common from cloud egress) → Gemini fallback.
      const g = await geminiPincode(pin);
      if (g) {
        return NextResponse.json({ ok: true, ...g, source: "gemini" }, {
          headers: { "Cache-Control": "s-maxage=86400, stale-while-revalidate=604800" },
        });
      }
      return err("Pincode lookup unavailable — enter state manually.", 502);
    }

    // Prefer a Head/Sub Office name for the town; else the first branch office.
    const offices = first.PostOffice;
    const po =
      offices.find((o) => o.BranchType === "Head Post Office") ??
      offices.find((o) => o.BranchType === "Sub Post Office") ??
      offices[0];
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
