// Strong login-password generator (migration 0094). Uses the Web Crypto RNG
// (globalThis.crypto — browser and Node 20 alike).

// No look-alike characters (0/O, 1/l/I) so an emailed password is easy to type.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "@#$%&*!?";
const ALL = UPPER + LOWER + DIGIT + SYMBOL;

// Uniform random integer in [0, n) (rejection sampling → no modulo bias).
function randInt(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  const b = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(b); } while (b[0] >= limit);
  return b[0] % n;
}
const pick = (set: string) => set[randInt(set.length)];

/** A strong 14-character password: upper, lower, digit and symbol guaranteed. */
export function generateStrongPassword(length = 14): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {   // shuffle (Fisher–Yates)
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** An EPC's issued login password — easy to remember, changed by the EPC at
 *  first login (migration 0103): "<name>@<last 4 mobile digits>$", e.g.
 *  "A V SOLAR" + 7875006650 → "avsolar@6650$". The name is lowercased, company
 *  words (private limited, pvt ltd, limited, ltd, llp, a leading m/s) dropped,
 *  and everything but letters and digits removed ("epc" if nothing is left). */
export function epcPassword(name: string, mobile: string): string {
  const base = name.toLowerCase()
    .replace(/^\s*m\s*\/\s*s\b\.?/, " ")
    .replace(/\b(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|llp)(?=\W|$)/g, " ")
    .replace(/[^a-z0-9]+/g, "");
  return `${base || "epc"}@${mobile.replace(/\D/g, "").slice(-4)}$`;
}

/** The rule set_login_password enforces (migration 0103): 8+ characters with a
 *  letter, a digit and a symbol. Checked before the email goes out, so a mail
 *  never carries a password the database would refuse. */
export function issuedPasswordOk(pw: string): boolean {
  return pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw) && !/\s/.test(pw);
}

export const ISSUED_PASSWORD_RULE = "Password needs 8+ characters with a letter, a number and a symbol.";

