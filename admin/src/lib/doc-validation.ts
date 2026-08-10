// Document-field validators — pure, dependency-free, safe to run anywhere
// (Node routes, client). The rule everywhere: if a value can be proven wrong
// (fails its check-digit or doesn't fit the shape of the real thing), return
// null instead of letting a mis-read masquerade as correct data. Never invents
// a value — only rejects impossible ones.

// ── Aadhaar: 12 digits with a Verhoeff check-digit (last digit). ────────────
const VERHOEFF_D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const VERHOEFF_P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];
export function isValidAadhaar(num: string | null | undefined): boolean {
  if (!num) return false;
  const digits = num.replace(/\D/g, "");
  if (!/^[2-9]\d{11}$/.test(digits)) return false; // 12 digits, can't start 0/1
  let c = 0;
  const rev = digits.split("").reverse().map(Number);
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][rev[i]]];
  return c === 0;
}

// ── PAN: AAAAA9999A (no public checksum — 4th char is holder type). ─────────
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export function isValidPan(pan: string | null | undefined): boolean {
  if (!pan) return false;
  const p = pan.toUpperCase().replace(/\s/g, "");
  if (!PAN_RE.test(p)) return false;
  return "PCHFATBLJGE".includes(p[3]); // 4th char = valid holder-type code
}

// ── GSTIN: 15 chars with a mod-36 check-digit (15th char). ──────────────────
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  const g = gstin.toUpperCase().replace(/\s/g, "");
  if (!GSTIN_RE.test(g)) return false;
  const code = (ch: string) => (ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 55);
  const chr = (n: number) => (n < 10 ? String(n) : String.fromCharCode(55 + n));
  let sum = 0;
  for (let i = 0; i < 14; i++) { const v = code(g[i]) * (i % 2 ? 2 : 1); sum += Math.floor(v / 36) + (v % 36); }
  return chr((36 - (sum % 36)) % 36) === g[14];
}

// ── IFSC: AAAA0999999 (5th char is always 0). Format only. ──────────────────
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export function isValidIfsc(ifsc: string | null | undefined): boolean {
  if (!ifsc) return false;
  return IFSC_RE.test(ifsc.toUpperCase().replace(/\s/g, ""));
}

// ── Indian address sanity — reject "random words" that aren't an address. ───
// A real Indian ID address ends in a 6-digit PIN. We keep only the Latin
// portion (the parsers are English-oriented; Devanagari fragments are noise),
// require a PIN, and require a reasonable length. Returns the cleaned address
// or null if it doesn't look like one.
export function sanitizeIndianAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Keep only Latin letters, digits, spaces and address punctuation. This also
  // drops Devanagari and other non-ASCII scripts that OCR interleaves.
  const latin = raw
    .replace(/[^A-Za-z0-9,.\-/()&\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,\s.]+|[,\s]+$/g, "");
  if (!/\b\d{6}\b/.test(latin)) return null;         // must contain a PIN code
  const letters = (latin.match(/[A-Za-z]/g) || []).length;
  if (latin.length < 12 || letters < 6) return null; // too short / not word-like
  return latin;
}
