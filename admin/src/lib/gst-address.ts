// GST "Principal Place of Business" address parser — a PURE function shared by
// the client OCR helper (lib/ocr) and the server-side backfill route. No React
// / browser / network dependencies, so it is safe to import from a Route
// Handler.
//
// GST REG-06 certificates list the principal address after an
// "Address of Principal Place of Business" (or "Principal Place of Business")
// label, spanning several lines and ending near the 6-digit PIN. We collect the
// lines after the label until a sibling field label or the PIN line.

const GST_ADDRESS_LABEL_RE =
  /Address\s+of\s+(?:the\s+)?Principal\s+Place\s+of\s+Business|Principal\s+Place\s+of\s+Business/i;

// Field labels that terminate the multi-line address block on a REG-06 cert.
const GST_ADDRESS_STOP_RE =
  /^(?:\s*\d+(?:\.\d+)?\s*[.)]?\s*)?(?:Date\s+of\s+(?:Liability|Validity|Registration|filing)|Period\s+of\s+Validity|Type\s+of\s+Registration|Nature\s+of\s+Business|Particulars\s+of|Approving\s+Authority|Signature|Constitution\s+of\s+Business|GSTIN|Legal\s+Name|Trade\s+Name|Additional\s+trade|Annexure|Note\s*:)\b/i;

export function parseGstAddress(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/^\s*\d+\s*[.)]\s*/, "");
    if (!GST_ADDRESS_LABEL_RE.test(stripped)) continue;

    const parts: string[] = [];
    // Same line may carry the first address segment after the label.
    const sameLine = stripped
      .replace(GST_ADDRESS_LABEL_RE, "")
      .replace(/^[\s:.\-,]+/, "")
      .trim();
    if (sameLine && !GST_ADDRESS_STOP_RE.test(sameLine)) parts.push(sameLine);

    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const raw = lines[j].replace(/^\s*\d+\s*[.)]\s*/, "").trim();
      if (!raw) {
        if (parts.length) break; // blank line after we started = block end
        continue;
      }
      if (GST_ADDRESS_LABEL_RE.test(raw)) continue; // repeated label
      if (GST_ADDRESS_STOP_RE.test(raw)) break;
      parts.push(raw);
      if (/\b\d{6}\b/.test(raw)) break; // PIN code = address end
    }

    if (parts.length) {
      const joined = parts
        .join(", ")
        .replace(/\s*,\s*,\s*/g, ", ")
        .replace(/[,\s]+$/, "")
        .trim();
      if (joined) return joined.length > 300 ? joined.slice(0, 300) : joined;
    }
  }
  return null;
}
