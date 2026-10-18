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
