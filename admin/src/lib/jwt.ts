// Server-side JWT verification for our /api routes.
//
// We accept BOTH algorithms during the transition window:
//
//   ES256  — signed by our auth function with the custom keypair (Step 4).
//            Verified against the project's JWKS endpoint, which now includes
//            our custom public key (uploaded in Step 2).
//
//   HS256  — signed with the legacy Supabase JWT secret (still in APP_JWT_SECRET
//            for now). This is the bridge that keeps already-issued tokens in
//            users' localStorage working until they log out and back in after
//            Step 4. Remove this branch once everyone has re-logged-in.

import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

const PROJECT_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://hpebydmrpimyuxgsgtmu.supabase.co";

// JWKS endpoint exposes Supabase's auth keys + our uploaded Standby key.
// createRemoteJWKSet caches keys in-memory and refreshes on signature misses.
const JWKS_URL = new URL(
  PROJECT_URL.replace(/\/$/, "") + "/auth/v1/.well-known/jwks.json",
);
const JWKS = createRemoteJWKSet(JWKS_URL);

const HS256_RAW = process.env.APP_JWT_SECRET || "";
const HS256_SECRET = HS256_RAW ? new TextEncoder().encode(HS256_RAW) : null;

export type JwtClaims = {
  sub: string;
  business_id: string;
  business_type:
    | "proprietorship"
    | "pvt_ltd"
    | "partnership"
    | "llp"
    | "admin"
    | null;
  role: string;
};

export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice("bearer ".length).trim() || null;
}

export async function verifyJwt(token: string): Promise<JwtClaims> {
  const { alg } = decodeProtectedHeader(token);

  if (alg === "ES256") {
    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ["ES256"],
    });
    return payload as unknown as JwtClaims;
  }

  if (alg === "HS256") {
    if (!HS256_SECRET) {
      throw new Error(
        "Token is HS256 but APP_JWT_SECRET is not set on this server",
      );
    }
    const { payload } = await jwtVerify(token, HS256_SECRET, {
      algorithms: ["HS256"],
    });
    return payload as unknown as JwtClaims;
  }

  throw new Error(`Unsupported JWT alg: ${alg ?? "(missing)"}`);
}
