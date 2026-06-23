// One-off utility: generate (or re-use) an ES256 keypair and write it to disk
// in BOTH JWK and PEM formats.
//
//   JWK (private)  -> for our auth Edge Function (env var APP_SIGNING_JWK)
//   PEM (private)  -> for Supabase's "Import existing private key" input
//
// Idempotent: if the JWK files already exist, the kid is preserved and only
// the PEM files are (re)written. Run it as many times as you want.
//
//   cd "D:\capital craft\capital craft frontend"
//   node gen-keypair.mjs

import { generateKeyPair, exportJWK } from "jose";
import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

const OUT_DIR       = String.raw`D:\capital craft\keys`;
const PRIV_JWK_PATH = resolve(OUT_DIR, "cc-signing-private.jwk.json");
const PUB_JWK_PATH  = resolve(OUT_DIR, "cc-signing-public.jwk.json");
const PRIV_PEM_PATH = resolve(OUT_DIR, "cc-signing-private.pem");
const PUB_PEM_PATH  = resolve(OUT_DIR, "cc-signing-public.pem");

if (!existsSync(dirname(PRIV_JWK_PATH))) {
  mkdirSync(dirname(PRIV_JWK_PATH), { recursive: true });
}

let privJwk, pubJwk;

if (existsSync(PRIV_JWK_PATH) && existsSync(PUB_JWK_PATH)) {
  console.log("Re-using existing keypair on disk (kid preserved).");
  privJwk = JSON.parse(readFileSync(PRIV_JWK_PATH, "utf8"));
  pubJwk  = JSON.parse(readFileSync(PUB_JWK_PATH, "utf8"));
} else {
  console.log("Generating fresh ES256 keypair...");
  const kid = randomUUID();   // Supabase requires the kid to be a UUID v4.
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  privJwk = await exportJWK(privateKey);
  pubJwk  = await exportJWK(publicKey);
  for (const j of [privJwk, pubJwk]) {
    j.alg = "ES256";
    j.use = "sig";
    j.kid = kid;
  }
  writeFileSync(PRIV_JWK_PATH, JSON.stringify(privJwk, null, 2));
  writeFileSync(PUB_JWK_PATH,  JSON.stringify(pubJwk,  null, 2));
}

// JWK -> PEM via Node's built-in crypto (no extra deps).
// Private: PKCS8 PEM, "-----BEGIN PRIVATE KEY-----"
// Public:  SPKI PEM,  "-----BEGIN PUBLIC KEY-----"
const privPem = createPrivateKey({ key: privJwk, format: "jwk" })
  .export({ type: "pkcs8", format: "pem" });
const pubPem = createPublicKey({ key: pubJwk, format: "jwk" })
  .export({ type: "spki", format: "pem" });

writeFileSync(PRIV_PEM_PATH, privPem);
writeFileSync(PUB_PEM_PATH,  pubPem);

console.log("");
console.log("Done. Files on disk:");
console.log("  " + PRIV_JWK_PATH + "   (auth function: APP_SIGNING_JWK)");
console.log("  " + PUB_JWK_PATH  + "   (reference)");
console.log("  " + PRIV_PEM_PATH + "   <-- paste THIS into Supabase");
console.log("  " + PUB_PEM_PATH  + "   (reference)");
console.log("  KID = " + privJwk.kid);
