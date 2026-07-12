// GET /api/reverse-geocode?lat=<num>&lng=<num>
//
// Resolves a latitude/longitude to a human-readable address. Used by the
// Step-5 office-photo capture to show WHERE a geo-tagged photo was taken.
//
// Provider: BigDataCloud's free, key-less reverse-geocode endpoint. We proxy
// it server-side so the browser never talks to a third party directly and so
// a provider outage degrades gracefully (the UI still shows lat/lng, just no
// address). No API key, no migration, no stored secrets.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ ok: false, error: "Invalid coordinates." }, { status: 400 });
    }

    const url =
      "https://api.bigdatacloud.net/data/reverse-geocode-client" +
      `?latitude=${lat}&longitude=${lng}&localityLanguage=en`;

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `geocoder ${res.status}` });
    }
    const d = (await res.json()) as Record<string, unknown>;

    const city =
      (d.city as string) || (d.locality as string) || (d.principalSubdivision as string) || "";
    const state = (d.principalSubdivision as string) || "";
    const postcode = (d.postcode as string) || "";
    const country = (d.countryName as string) || "";

    // Build a compact, sensible address line from whatever the provider gave.
    const parts = [
      (d.locality as string) || "",
      city && city !== d.locality ? city : "",
      state,
      postcode,
      country,
    ].filter((p, i, arr) => p && arr.indexOf(p) === i);
    const address = parts.join(", ");

    return NextResponse.json({
      ok: true,
      address: address || null,
      city: city || null,
      state: state || null,
      postcode: postcode || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg });
  }
}
