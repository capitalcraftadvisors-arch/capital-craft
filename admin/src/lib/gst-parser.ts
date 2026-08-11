// GST REG-06 certificate parser — Legal Name, Trade Name, GSTIN.
//
// Ported VERBATIM from the backend `extract-gst-legalname` Edge Function so the
// insurance flow gets the exact same, battle-tested parsing (it never swaps
// legal ↔ trade, handles the numbered-table + Annexure layouts, and rejects
// label-fragment scraps). Only the Vision/HTTP wrapper is dropped — callers
// pass in the OCR text (from lib/vision-server, the reliable Cloud Run key).
//
// Strategy (see the Edge Function header for the full rationale):
//   0. Pair-aware Annexure-block matcher (preferred — guarantees correct field).
//   1. Per-label matchers (Legal Name of Business / …registered person / Legal Name).
//   2. Columnar fallback anchored on the GSTIN value line.

import { isValidGstin } from "./doc-validation";

export type GstFields = {
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
};

export function parseGstFields(text: string): GstFields {
  const gstin = matchGstin(text);

  const block = parseAnnexureBlock(text);
  let legal_name: string | null = block.legal;
  let trade_name: string | null = block.trade;

  if (!legal_name || isLabelOrPrefix(legal_name)) {
    legal_name =
         matchAfterFormLabel(text, /Legal\s+Name\s+of\s+Business/i)
      ?? matchAfterFormLabel(text, /Legal\s+name\s+of\s+the\s+registered\s+person/i)
      ?? matchAfterFormLabel(text, /Legal\s+Name/i);
  }
  if (!trade_name || isLabelOrPrefix(trade_name)) {
    trade_name = matchAfterFormLabel(
      text,
      /Trade\s+Name(?:\s*[,(]?\s*if\s+any\s*\)?)?/i,
      { skipLine: ADDITIONAL_TRADE_RE },
    );
  }

  if (!legal_name || isLabelOrPrefix(legal_name) ||
      !trade_name || isLabelOrPrefix(trade_name)) {
    const fb = parseColumnarHeader(text, gstin);
    if (!legal_name || isLabelOrPrefix(legal_name)) legal_name = fb.legal_name;
    if (!trade_name || isLabelOrPrefix(trade_name)) trade_name = fb.trade_name;
  }

  // Reject a GSTIN that fails its mod-36 check-digit (mis-read) — the legal /
  // trade names still return; only the number is blanked when it can't be real.
  return { gstin: isValidGstin(gstin) ? gstin : null, legal_name, trade_name };
}

// ── Parsers (verbatim) ──────────────────────────────────────────────────────

function matchGstin(text: string): string | null {
  const m = text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/);
  return m ? m[0] : null;
}

const TABLE_NUMBER_PREFIX_RE = /^\s*\d+\s*\.\s*/;
function stripTableNumber(s: string): string {
  return s.replace(TABLE_NUMBER_PREFIX_RE, "");
}
const BARE_TABLE_NUMBER_RE = /^\s*\d+\s*\.\s*$/;

const SECTION_PREFIX_RE = /^\s*\d+(?:\.\d+)?\s*\(\s*[a-z]\s*\)\s*\.?\s*/i;
const SECTION_PREFIX_ONLY_RE = /^\s*\d+(?:\.\d+)?\s*\(\s*[a-z]\s*\)\s*\.?\s*$/i;
function stripSectionPrefix(s: string): string {
  return s.replace(SECTION_PREFIX_RE, "").trim();
}
function isJustSectionPrefix(s: string): boolean {
  return SECTION_PREFIX_ONLY_RE.test(s);
}

const ADDITIONAL_TRADE_RE = /Additional\s+trade/i;

const OTHER_FORM_LABEL_RE =
  /^(?:\s*\d+(?:\.\d+)?\s*\(\s*[a-z]\s*\)\s*\.?\s*)?(?:Additional\s+trade|Legal\s+Name|Trade\s+Name|GSTIN|Period|(?:Financial\s+)?Year|Status|ARN|Constitution|Date\s+of\s+(?:Registration|filing|liability)|Address|Type\s+of\s+Registration)\b/i;

function isOtherFormLabel(s: string, currentLabelRe: RegExp): boolean {
  if (!OTHER_FORM_LABEL_RE.test(s)) return false;
  return !currentLabelRe.test(s);
}

function looksLikeLabelFragment(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (!t) return true;
  if (t === "if any") return true;
  if (t === "if" || t === "any") return true;
  if (t === "," || t === ";") return true;
  if (t === "additional") return true;
  if (BARE_TABLE_NUMBER_RE.test(t)) return true;
  return false;
}

function stripLeadingLabelScraps(s: string): string {
  return s
    .replace(/^\s*(?:Additional\s+trade\s+names?)\s*[,]?\s*(?:if\s+any)?\s*/i, "")
    .replace(/^\s*if\s+any\s+/i, "")
    .trim();
}

function isLabelOrPrefix(s: string | null): boolean {
  if (!s) return false;
  if (isJustSectionPrefix(s)) return true;
  if (OTHER_FORM_LABEL_RE.test(s)) return true;
  if (looksLikeLabelFragment(s)) return true;
  return false;
}

function cap(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) : s;
}

function matchAfterFormLabel(
  text: string,
  labelRe: RegExp,
  opts: { skipLine?: RegExp } = {},
): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (opts.skipLine && opts.skipLine.test(lines[i])) continue;
    const line = stripTableNumber(lines[i]);
    if (!labelRe.test(line)) continue;

    const sameLineRemainder = line.replace(labelRe, "");
    const trimmed = sameLineRemainder.replace(/^[\s:.\-,]+/, "").trim();
    const sameLineVal = stripLeadingLabelScraps(stripSectionPrefix(trimmed));
    if (sameLineVal && !looksLikeLabelFragment(sameLineVal)) {
      return cap(sameLineVal);
    }

    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      if (opts.skipLine && opts.skipLine.test(lines[j])) continue;
      const raw = stripTableNumber(lines[j]).trim();
      if (!raw) continue;
      if (isJustSectionPrefix(raw)) continue;
      if (labelRe.test(raw)) continue;
      if (isOtherFormLabel(raw, labelRe)) break;

      const candidate = stripLeadingLabelScraps(stripSectionPrefix(raw));
      if (candidate && !looksLikeLabelFragment(candidate)) {
        return cap(candidate);
      }
    }
  }
  return null;
}

function parseAnnexureBlock(text: string): { legal: string | null; trade: string | null } {
  const lines = text.split(/\r?\n/);

  const LEGAL_LABEL_RE =
    /^(?:Legal\s+Name(?:\s+of\s+Business)?|Legal\s+name\s+of\s+the\s+registered\s+person)$/i;
  const TRADE_LABEL_RE = /^Trade\s+Name(?:\s*[,(]?\s*if\s+any\s*\)?)?$/i;

  const norm = (s: string) => stripTableNumber(s).trim().replace(/[,:.]+\s*$/, "");

  for (let i = 0; i < lines.length; i++) {
    if (ADDITIONAL_TRADE_RE.test(lines[i])) continue;
    if (!LEGAL_LABEL_RE.test(norm(lines[i]))) continue;

    let legal: string | null = null;
    let cursor = i + 1;
    for (let steps = 0; cursor < lines.length && steps < 4; cursor++, steps++) {
      if (ADDITIONAL_TRADE_RE.test(lines[cursor])) continue;
      const raw = stripTableNumber(lines[cursor]).trim();
      if (!raw) continue;
      if (isJustSectionPrefix(raw)) continue;
      if (LEGAL_LABEL_RE.test(norm(lines[cursor]))) continue;
      if (OTHER_FORM_LABEL_RE.test(raw)) break;
      const candidate = stripLeadingLabelScraps(stripSectionPrefix(raw));
      if (candidate && !looksLikeLabelFragment(candidate)) {
        legal = cap(candidate);
        cursor++;
        break;
      }
    }
    if (!legal) continue;

    let foundTradeLabelAt = -1;
    for (let steps = 0; cursor < lines.length && steps < 6; cursor++, steps++) {
      if (ADDITIONAL_TRADE_RE.test(lines[cursor])) continue;
      const n = norm(lines[cursor]);
      if (!n) continue;
      if (TRADE_LABEL_RE.test(n)) { foundTradeLabelAt = cursor; break; }
      if (OTHER_FORM_LABEL_RE.test(lines[cursor]) && !TRADE_LABEL_RE.test(n)) break;
    }
    if (foundTradeLabelAt === -1) continue;

    let trade: string | null = null;
    for (let k = foundTradeLabelAt + 1; k < lines.length && k < foundTradeLabelAt + 5; k++) {
      if (ADDITIONAL_TRADE_RE.test(lines[k])) continue;
      const raw = stripTableNumber(lines[k]).trim();
      if (!raw) continue;
      if (isJustSectionPrefix(raw)) continue;
      if (TRADE_LABEL_RE.test(norm(lines[k]))) continue;
      if (OTHER_FORM_LABEL_RE.test(raw)) break;
      const candidate = stripLeadingLabelScraps(stripSectionPrefix(raw));
      if (candidate && !looksLikeLabelFragment(candidate)) {
        trade = cap(candidate);
        break;
      }
    }
    if (trade) return { legal, trade };
  }
  return { legal: null, trade: null };
}

function parseColumnarHeader(
  text: string,
  gstin: string | null,
): { legal_name: string | null; trade_name: string | null } {
  if (!gstin) return { legal_name: null, trade_name: null };

  const lines = text.split(/\r?\n/);

  let gstinValueIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === gstin) { gstinValueIdx = i; break; }
  }
  if (gstinValueIdx === -1) return { legal_name: null, trade_name: null };

  const collected: string[] = [];
  for (let j = gstinValueIdx + 1; j < lines.length && collected.length < 2; j++) {
    const raw = stripTableNumber(lines[j]).trim();
    if (!raw) continue;
    if (OTHER_FORM_LABEL_RE.test(raw)) break;
    if (ADDITIONAL_TRADE_RE.test(raw)) break;
    if (/^[A-Z]{2}\d{12,16}$/.test(raw)) break;              // ARN
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(raw)) break;  // date
    if (isJustSectionPrefix(raw)) break;
    const candidate = stripSectionPrefix(raw);
    if (candidate && !looksLikeLabelFragment(candidate)) collected.push(cap(candidate));
  }

  return { legal_name: collected[0] ?? null, trade_name: collected[1] ?? null };
}
