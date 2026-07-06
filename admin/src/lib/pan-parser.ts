// PAN card OCR-text parser.
//
// Client-safe (no server-only imports) so both the browser-side
// extractPan helper in lib/ocr.ts and the server-side extract-coapp-pan
// route can reuse the same regex + line heuristics.
//
// The returned fields are best-effort — every PAN card is laid out
// slightly differently (post-2016 e-PAN cards printed by Protean vs
// legacy cards vs bank-issued reprints). Callers should render the
// parsed fields for admin review, not treat them as ground truth.

export type PanFields = {
  pan:         string | null;   // "AAAAA9999A" — validated by regex
  name:        string | null;
  father_name: string | null;
  dob:         string | null;   // freeform text; usually "DD/MM/YYYY"
};

// Format: 5 uppercase letters + 4 digits + 1 uppercase letter.
const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;

// Lines/keywords the parser should NEVER treat as name candidates.
// Includes bilingual variants that show up on Aadhaar-linked PAN cards.
const NAME_NOISE_RE = /(government|india|income\s*tax|department|permanent\s*account|signature|address|date\s*of\s*birth|dob|father|mother|spouse|husband|wife|आयकर|भारत|सरकार|पिता|माता)/i;

export function parsePanFields(text: string): PanFields {
  const trimmed = text || "";
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const panMatch = trimmed.match(PAN_RE);
  const pan = panMatch ? panMatch[0] : null;

  // ── DOB ─────────────────────────────────────────────────────────
  // Prefer a labelled hit; fall back to any DD/MM/YYYY on the card.
  const dobMatch =
    trimmed.match(/(?:DOB|Date\s*of\s*Birth|D\.O\.B|Birth)\s*[:\-]?\s*([0-3]?\d[\/\-.\s][0-1]?\d[\/\-.\s]\d{2,4})/i) ||
    trimmed.match(/\b([0-3]\d[\/\-.\s][0-1]\d[\/\-.\s]\d{4})\b/);
  const dob = dobMatch ? normDob(dobMatch[1]) : null;

  // ── Father's name ───────────────────────────────────────────────
  // Two layouts occur:
  //   (a) "Father's Name" label on its own line, name on the next line.
  //   (b) "Father's Name: SURESH KUMAR" all on one line.
  //   (c) Modern cards omit the label and print two ALLCAPS lines
  //       before the DOB — first is applicant, second is father.
  let father_name: string | null = null;
  {
    const inlineFather = trimmed.match(/Father'?s?\s*Name\s*[:\-]?\s*([A-Z][A-Z\s.'-]{2,80})/i);
    if (inlineFather) {
      father_name = cleanName(inlineFather[1]);
    } else {
      const idx = lines.findIndex((l) => /Father'?s?\s*Name/i.test(l));
      if (idx >= 0 && idx + 1 < lines.length) {
        const next = lines[idx + 1];
        if (isNameShape(next)) father_name = cleanName(next);
      }
    }
  }

  // ── Applicant name ─────────────────────────────────────────────
  // Same shape as father's name but the FIRST candidate above/before
  // the DOB or "Father" landmark. Falls back to the strongest ALLCAPS
  // multi-word line anywhere on the card.
  let name: string | null = null;
  {
    const inlineName = trimmed.match(/(?:^|\n)\s*Name\s*[:\-]?\s*([A-Z][A-Z\s.'-]{2,80})/);
    if (inlineName) {
      name = cleanName(inlineName[1]);
    } else {
      // Find the DOB or Father label line; the name usually appears above it.
      const dobIdx = lines.findIndex((l) => /(DOB|Date\s*of\s*Birth|D\.O\.B|Birth)/i.test(l));
      const fatherIdx = lines.findIndex((l) => /Father'?s?\s*Name/i.test(l));
      const anchor = pickAnchor(dobIdx, fatherIdx);
      const candidates = (anchor >= 0 ? lines.slice(0, anchor) : lines)
        .filter((l) => isNameShape(l) && !NAME_NOISE_RE.test(l));
      if (candidates.length > 0) name = cleanName(candidates[0]);
    }
    // De-dup: if the parser picked the father's name as the applicant,
    // pick the next candidate instead.
    if (father_name && name && name.toUpperCase() === father_name.toUpperCase()) {
      const dobIdx = lines.findIndex((l) => /(DOB|Date\s*of\s*Birth)/i.test(l));
      const fatherIdx = lines.findIndex((l) => /Father'?s?\s*Name/i.test(l));
      const anchor = pickAnchor(dobIdx, fatherIdx);
      const candidates = (anchor >= 0 ? lines.slice(0, anchor) : lines)
        .filter((l) => isNameShape(l) && !NAME_NOISE_RE.test(l) && cleanName(l).toUpperCase() !== father_name!.toUpperCase());
      if (candidates.length > 0) name = cleanName(candidates[0]);
    }
  }

  return { pan, name, father_name, dob };
}

function isNameShape(line: string): boolean {
  if (!line) return false;
  if (line.length < 3 || line.length > 60) return false;
  // Rule out lines that contain any digit (dates, IDs).
  if (/\d/.test(line)) return false;
  // At least two "word" tokens (allow apostrophes / periods / hyphens).
  const words = line.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z.'-]+$/.test(w));
  return words.length >= 2;
}

function cleanName(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/[,.;:]+$/, "");
}

function normDob(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/\./g, "/").replace(/-/g, "/");
}

function pickAnchor(a: number, b: number): number {
  const positives = [a, b].filter((x) => x >= 0);
  if (positives.length === 0) return -1;
  return Math.min(...positives);
}
