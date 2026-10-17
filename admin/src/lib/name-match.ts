// Fuzzy "same person?" check for names read off ID cards and bills by OCR —
// shared by the loan chatbot and the applicant / co-applicant role decision.

// Tokenize a name for fuzzy comparison: drop honorifics + relationship prefixes,
// keep only real name words (≥3 letters) so minor OCR differences (case,
// spacing, an extra middle name, initials) don't look like a different person.
export function nameTokens(s: string | null | undefined): string[] {
  return (s || "").toLowerCase()
    .replace(/\b(m\/s|mr|mrs|ms|smt|shri|sri|km|kumari|dr|late|s\/o|d\/o|w\/o|c\/o|h\/o)\.?\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/).filter((t) => t.length >= 3);
}
// Two names are the SAME person when the GIVEN NAME (first real word) matches, or
// one name's words are fully contained in the other (handles "Vimla Devi" vs
// "Vimla Devi W/O Sharwan Lal", extra middle names, reordering). Sharing only a
// common SURNAME (Singh/Devi/Kumar/Sharma…) is NOT enough — "Surendra Singh Gaur"
// and "Kiran Devi Kanwar Singh" are different people and need a co-applicant.
export function namesLikelySame(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = nameTokens(a); const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return true; // unreadable → don't force a co-applicant
  if (ta[0] === tb[0]) return true;
  const sa = new Set(ta); const sb = new Set(tb);
  return ta.every((t) => sb.has(t)) || tb.every((t) => sa.has(t));
}
// A name OCR actually read (at least one real name word) — anything less can't
// be compared, so callers ask instead of guessing.
export function nameReadable(s: string | null | undefined): boolean {
  return nameTokens(s).length > 0 && (s || "").trim().length >= 3;
}
