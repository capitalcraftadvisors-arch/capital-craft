// =========================================================
// Capital Craft — `auth` Edge Function
// POST { mobile, otp, password? } -> { ok, token, business }
//
// Passwords (migration 0094): an account CC has set a password for must send
// it — otherwise { ok:false, password_required:true }. An account with no
// password yet (new sign-ups, not-yet-set) logs in with the mobile only.
// 5 wrong passwords lock the account for 15 minutes.
//
// Issued EPC passwords must be changed at first login (0103): the right
// password then gives no session, only { must_change_password, change_token }
// (15 minutes, can't open the portal); { action: "change_password",
// change_token, new_password } sets the EPC's own password and logs in.
//
// Signing key selection (no code change needed to roll back):
//   - If APP_SIGNING_JWK is set, sign with ES256 using that private JWK.
//   - Otherwise, sign with HS256 using APP_JWT_SECRET (legacy fallback).
//
// To roll back from ES256 to HS256: unset APP_SIGNING_JWK, redeploy.
//
// Claude connector (MCP, migration 0095) — owner accounts only (0096):
//   { action: "mcp_create" }  + the owner's Bearer token
//       -> { ok, key, expires_at }   a new opaque connector key (shown once)
//   { action: "mcp_exchange", key }
//       -> { ok, token }   a 5-minute JWT with role mcp_reader (SELECT-only)
// =========================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importJWK, jwtVerify, createRemoteJWKSet, decodeProtectedHeader, type KeyLike, type JWTPayload } from "https://esm.sh/jose@5.2.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const JWKS = createRemoteJWKSet(new URL(SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/.well-known/jwks.json"));

const CORS = {
  "Access-Control-Allow-Origin": "*", // tighten to https://app.capitalcraft.in in prod
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Signing-key setup at cold start ─────────────────────────────────────────
// If APP_SIGNING_JWK is set and parses, we use ES256. We deliberately let
// JSON.parse / importJWK throw at startup if the secret is malformed — better
// to fail the deploy loudly than to silently fall back and mask a bug.

const SIGNING_JWK_RAW = Deno.env.get("APP_SIGNING_JWK");
const HS256_RAW = Deno.env.get("APP_JWT_SECRET");

let ES256_KEY: KeyLike | null = null;
let ES256_KID: string | null = null;
if (SIGNING_JWK_RAW) {
  // APP_SIGNING_JWK is base64-encoded JSON (avoids PowerShell quoting issues
  // when setting the secret). Decode -> parse -> import.
  const jwk = JSON.parse(atob(SIGNING_JWK_RAW.trim()));
  ES256_KEY = (await importJWK(jwk, "ES256")) as KeyLike;
  ES256_KID = jwk.kid ?? null;
  if (!ES256_KID) throw new Error("APP_SIGNING_JWK is missing the kid field");
}

const HS256_KEY = HS256_RAW ? new TextEncoder().encode(HS256_RAW) : null;

if (!ES256_KEY && !HS256_KEY) {
  throw new Error(
    "No signing key configured: set APP_SIGNING_JWK (preferred) or APP_JWT_SECRET",
  );
}

console.log(
  "auth function loaded; signing with " + (ES256_KEY ? "ES256 (kid " + ES256_KID + ")" : "HS256 (legacy)"),
);

// Signs claims with the configured key (ES256 preferred, HS256 legacy).
async function sign(claims: Record<string, unknown>, expiresAt?: Date): Promise<string> {
  let jwt = new SignJWT(claims).setIssuedAt().setAudience("authenticated");
  if (expiresAt) jwt = jwt.setExpirationTime(Math.floor(expiresAt.getTime() / 1000));
  return ES256_KEY && ES256_KID
    ? await jwt.setProtectedHeader({ alg: "ES256", typ: "JWT", kid: ES256_KID }).sign(ES256_KEY)
    : await jwt.setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(HS256_KEY!);
}

// The caller's verified login token (Authorization: Bearer …), or null.
async function callerClaims(req: Request): Promise<JWTPayload | null> {
  const h = req.headers.get("authorization") ?? "";
  return verifyToken(h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "");
}

// A token this function signed (any purpose), verified; null if invalid / expired.
async function verifyToken(token: string): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const { alg } = decodeProtectedHeader(token);
    if (alg === "ES256") return (await jwtVerify(token, JWKS, { algorithms: ["ES256"] })).payload;
    if (alg === "HS256" && HS256_KEY) return (await jwtVerify(token, HS256_KEY, { algorithms: ["HS256"] })).payload;
  } catch { /* invalid / expired */ }
  return null;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CHANGE_TOKEN_MINUTES = 15;
const BIZ_COLS = "id, status, business_type, current_step, contact_name, loan_app_unlocked, service_type, role, allowed_modules, parent_user_id";

// The EPC's own password in place of the issued one, then a normal login.
async function changePassword(changeToken: unknown, newPassword: unknown): Promise<Response> {
  const t = await verifyToken(typeof changeToken === "string" ? changeToken : "");
  if (!t || t.purpose !== "pw_change" || typeof t.sub !== "string") {
    return json({ ok: false, error: "This step has expired — log in again." }, 401);
  }
  const { data: r, error } = await supabase.rpc("set_own_password", {
    p_business_id: t.sub, p_password: typeof newPassword === "string" ? newPassword.replace(/\s+/g, "") : "",
  });
  if (error) return json({ ok: false, error: error.message }, 500);
  if (r === "weak") return json({ ok: false, error: "Use at least 8 characters with a letter and a number." }, 400);
  if (r === "same") return json({ ok: false, error: "Choose a password different from the one we emailed." }, 400);
  if (r !== "ok") return json({ ok: false, error: "Couldn't set the password — log in again." }, 400);
  const { data: biz } = await supabase.from("epc_business").select(BIZ_COLS).eq("id", t.sub).maybeSingle();
  if (!biz) return json({ ok: false, error: "Account not found." }, 404);
  return session(biz);
}

// Stamp the login and hand out the session token.
async function session(biz: Record<string, any>): Promise<Response> {
  // Stamp last login (fire-and-forget; never block auth on it). Powers the
  // Team view's "Last login" without a separate tracking system.
  supabase.from("epc_business").update({ last_login_at: new Date().toISOString() }).eq("id", biz.id)
    .then(({ error }) => { if (error) console.warn("last_login_at update failed:", error.message); });
  // Append a login event (fire-and-forget) — powers "Logins / Active EPC" in
  // the analytics EPC-health panel (a count over a window, not just the latest).
  supabase.from("epc_login_events").insert({ epc_business_id: biz.id })
    .then(({ error }) => { if (error) console.warn("login event insert failed:", error.message); });

  const claims = {
    sub: biz.id,
    role: "authenticated",            // Supabase-standard claim — do NOT change
    business_id: biz.id,
    business_type: biz.business_type ?? null,
    // Hierarchy: the app-level role + the authoritative module permission set.
    // Named hierarchy_role so it never collides with the "authenticated" role.
    hierarchy_role: biz.role ?? null,               // 'MAIN_ADMIN' | 'OPERATIONS_USER' | null
    allowed_modules: biz.allowed_modules ?? null,   // e.g. ['epcs','apps',...]
  };

  const token = await sign(claims);

  // is_owner drives the Pri portal's visibility (0096); the server re-checks it.
  return json({ ok: true, token, business: { ...biz, is_owner: biz.business_type === "admin" && await isOwner(biz.id) } });
}

const MCP_KEY_DAYS = 90;
const MCP_JWT_SECONDS = 300;

// Owner accounts (0096, the Pri portal) — service-role read only.
async function isOwner(id: string): Promise<boolean> {
  const { data } = await supabase.from("owner_accounts").select("business_id").eq("business_id", id).maybeSingle();
  return !!data;
}
// A main-admin-level owner account (Claude connector links are owner-only).
const ownerAdmin = async (b: { id: string; business_type: string | null; role: string | null } | null) =>
  !!b && b.business_type === "admin" && (!b.role || b.role === "MAIN_ADMIN") && await isOwner(b.id);

// Owner → a new opaque connector key (only its hash is stored).
async function mcpCreate(req: Request): Promise<Response> {
  const c = await callerClaims(req);
  if (!c || c.role !== "authenticated") return json({ ok: false, error: "unauthorized" }, 401);
  const { data: me } = await supabase.from("epc_business")
    .select("id, business_type, role").eq("id", String(c.business_id ?? "")).maybeSingle();
  if (!(await ownerAdmin(me))) {
    return json({ ok: false, error: "Only the owner can create a Claude connector." }, 403);
  }
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const key = "ccmcp_" + btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const expiresAt = new Date(Date.now() + MCP_KEY_DAYS * 86400000);
  const { error } = await supabase.from("mcp_tokens").insert({ business_id: me.id, key_hash: await sha256Hex(key), expires_at: expiresAt.toISOString() });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, key, expires_at: expiresAt.toISOString() });
}

// Valid connector key → a 5-minute SELECT-only JWT acting as its owner.
async function mcpExchange(key: unknown): Promise<Response> {
  if (typeof key !== "string" || !key.startsWith("ccmcp_")) return json({ ok: false, error: "invalid key" }, 401);
  const { data: t } = await supabase.from("mcp_tokens")
    .select("business_id, expires_at, revoked_at").eq("key_hash", await sha256Hex(key)).maybeSingle();
  if (!t || t.revoked_at || new Date(t.expires_at).getTime() < Date.now()) return json({ ok: false, error: "invalid key" }, 401);
  const { data: owner } = await supabase.from("epc_business")
    .select("id, business_type, role, allowed_modules").eq("id", t.business_id).maybeSingle();
  // Owner (main-admin level) only — re-checked on every use, so a change ends access.
  if (!owner || !(await ownerAdmin(owner))) return json({ ok: false, error: "invalid key" }, 401);
  const token = await sign({
    sub: owner.id,
    role: "mcp_reader",                // SELECT-only database role (0095)
    business_id: owner.id,
    business_type: owner.business_type,
    hierarchy_role: owner.role ?? null,
    allowed_modules: owner.allowed_modules ?? null,
    mcp: true,
  }, new Date(Date.now() + MCP_JWT_SECONDS * 1000));
  return json({ ok: true, token, expires_in: MCP_JWT_SECONDS });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    if (body?.action === "mcp_create") return await mcpCreate(req);
    if (body?.action === "mcp_exchange") return await mcpExchange(body.key);
    if (body?.action === "change_password") return await changePassword(body.change_token, body.new_password);
    const { mobile, password } = body;

    // Find or create
    let { data: biz } = await supabase
      .from("epc_business")
      .select(BIZ_COLS)
      .eq("contact_mobile", mobile)
      .maybeSingle();

    if (biz) {
      // Password check. PGRST202 = function not deployed yet → no passwords exist.
      // Passwords never contain spaces — drop any that came along with a copy-paste.
      const { data: pw, error: pwErr } = await supabase.rpc("verify_login_password", {
        p_business_id: biz.id, p_password: typeof password === "string" ? password.replace(/\s+/g, "") : "",
      });
      if (pwErr && pwErr.code !== "PGRST202") return json({ ok: false, error: pwErr.message }, 500);
      if (pw === "required") return json({ ok: false, password_required: true, error: "Enter your password." }, 401);
      if (pw === "bad") return json({ ok: false, password_required: true, error: "Wrong password." }, 401);
      if (pw === "locked") return json({ ok: false, password_required: true, error: "Too many wrong attempts. Try again in 15 minutes." }, 429);
      // Right issued password → no session yet; only a pass to set their own password.
      if (pw === "change") {
        const change_token = await sign({ sub: biz.id, role: "anon", purpose: "pw_change" }, new Date(Date.now() + CHANGE_TOKEN_MINUTES * 60000));
        return json({ ok: false, must_change_password: true, change_token }, 403);
      }
    }

    if (!biz) {
      const { data: created, error } = await supabase
        .from("epc_business")
        .insert({ contact_mobile: mobile })
        .select(BIZ_COLS)
        .single();
      if (error) return json({ ok: false, error: error.message }, 500);
      biz = created;
    }

    return await session(biz);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
