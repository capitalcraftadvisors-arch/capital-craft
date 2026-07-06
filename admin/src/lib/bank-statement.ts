// Server-only OCR helper for bank statements uploaded at Step 4.
//
// Bank statement layouts vary widely by bank + statement type (e-PDF vs
// scanned photocopy vs consolidated statement). The parser is best-effort
// prefill only — the Step 4 UI shows every field as EDITABLE so the
// admin can correct anything OCR gets wrong or misses.
//
// Do NOT import this from client code.

import { visionDocumentText } from "./vision-server";

export type BankStatementFields = {
  account_holder: string | null;
  bank_name:      string | null;
  account_no:     string | null;
  ifsc:           string | null;
  account_type:   string | null;
  mobile:         string | null;
  email:          string | null;
};

// Public entry point — runs Vision on the file then hands off to the
// text parser. Never throws (except on Vision-config problems); a
// missed field just comes back as null.
export async function extractBankStatement(
  buffer: Buffer,
  mimeType: string,
): Promise<BankStatementFields> {
  const text = await visionDocumentText(buffer, mimeType);
  return parseBankStatement(text);
}

// ── Parser ───────────────────────────────────────────────────────────

// Recognised Indian bank names. First case-insensitive whole-word match
// wins; anything not on this list falls through and the admin fills in
// the bank name manually.
const BANKS: string[] = [
  "State Bank of India", "SBI",
  "HDFC Bank", "HDFC",
  "ICICI Bank", "ICICI",
  "Axis Bank", "Axis",
  "Kotak Mahindra Bank", "Kotak",
  "Yes Bank",
  "IndusInd Bank",
  "IDFC First Bank", "IDFC FIRST",
  "IDBI Bank", "IDBI",
  "Punjab National Bank", "PNB",
  "Bank of Baroda", "BoB",
  "Bank of India", "BoI",
  "Union Bank of India", "Union Bank",
  "Canara Bank",
  "Indian Bank",
  "Central Bank of India",
  "UCO Bank",
  "Bank of Maharashtra",
  "Punjab & Sind Bank",
  "Federal Bank",
  "South Indian Bank",
  "Karnataka Bank",
  "Karur Vysya Bank",
  "City Union Bank",
  "Tamilnad Mercantile Bank", "TMB",
  "Dhanlaxmi Bank",
  "RBL Bank",
  "DCB Bank",
  "Bandhan Bank",
  "AU Small Finance Bank",
  "Equitas Small Finance Bank",
  "Ujjivan Small Finance Bank",
  "Jana Small Finance Bank",
  "Suryoday Small Finance Bank",
  "ESAF Small Finance Bank",
  "Utkarsh Small Finance Bank",
  "Fincare Small Finance Bank",
  "Capital Small Finance Bank",
  "Airtel Payments Bank",
  "Paytm Payments Bank",
  "Fino Payments Bank",
  "India Post Payments Bank",
];

// Common account-type labels seen in bank statements.
const ACCOUNT_TYPES: Array<{ re: RegExp; canonical: string }> = [
  { re: /\bsavings?\b/i,            canonical: "Savings" },
  { re: /\b(?:current|CA)\b/,       canonical: "Current" },
  { re: /\bsalary\b/i,              canonical: "Salary" },
  { re: /\bNRE\b/,                  canonical: "NRE" },
  { re: /\bNRO\b/,                  canonical: "NRO" },
  { re: /\boverdraft|\bOD account/i, canonical: "Overdraft" },
  { re: /\bfixed deposit|\bFD\b/i,  canonical: "Fixed Deposit" },
];

export function parseBankStatement(text: string): BankStatementFields {
  const t = text || "";
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // ── Bank name ─────────────────────────────────────────────
  let bank_name: string | null = null;
  for (const name of BANKS) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
    if (re.test(t)) { bank_name = canonicalBank(name); break; }
  }

  // ── IFSC ──────────────────────────────────────────────────
  // Format: 4 letters + 0 + 6 alphanumeric.
  const ifscMatch = t.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);
  const ifsc = ifscMatch ? ifscMatch[1] : null;

  // ── Account number ────────────────────────────────────────
  // Prefer labelled hits (Account No, A/c No, Account Number).
  // Fall back to any long digit run (9-18 digits) not near IFSC/PAN.
  let account_no: string | null = null;
  const labelledAccount =
    t.match(/(?:account\s*(?:no\.?|number|#)|a\/c\s*(?:no\.?|number)?|acct\s*no\.?)\s*[:\-]?\s*([\dX*\s\-]{9,25})/i);
  if (labelledAccount) {
    account_no = cleanAccount(labelledAccount[1]);
  } else {
    const runs = Array.from(t.matchAll(/\b\d[\d\s\-]{8,20}\d\b/g))
      .map((m) => cleanAccount(m[0]))
      .filter((s) => s.length >= 9 && s.length <= 18);
    if (runs.length > 0) account_no = runs[0];
  }

  // ── Account type ──────────────────────────────────────────
  let account_type: string | null = null;
  for (const { re, canonical } of ACCOUNT_TYPES) {
    if (re.test(t)) { account_type = canonical; break; }
  }

  // ── Account holder name ───────────────────────────────────
  // Prefer explicit labels; fall back to the first name-shaped line
  // that isn't the bank name or an obvious noise line.
  let account_holder: string | null = null;
  const labelledHolder = t.match(/(?:account\s*holder(?:\s*name)?|customer\s*name|name\s*of\s*(?:account\s*holder|customer)|holder\s*name)\s*[:\-]\s*([A-Z][A-Za-z .'-]{2,80})/i);
  if (labelledHolder) {
    account_holder = clean(labelledHolder[1]);
  } else {
    const noise = /(bank|branch|address|ifsc|account|statement|customer id|micr|nomination|balance|opening|closing|period|from|to|page|date|txn|transaction)/i;
    const candidate = lines.find(
      (l) => l.length >= 3 && l.length <= 60 && !noise.test(l) && looksLikeName(l)
        && (!bank_name || !l.toLowerCase().includes(bank_name.toLowerCase())),
    );
    if (candidate) account_holder = clean(candidate);
  }

  // ── Mobile ────────────────────────────────────────────────
  // Prefer labelled hits; fall back to any Indian mobile pattern
  // (starts with 6-9, exactly 10 digits) somewhere in the text.
  let mobile: string | null = null;
  const labelledMobile =
    t.match(/(?:mobile|phone|contact)\s*(?:no\.?|number)?\s*[:\-]?\s*(?:\+?91[\s\-]?)?([6-9]\d{9})\b/i);
  if (labelledMobile) {
    mobile = labelledMobile[1];
  } else {
    const anyMobile = t.match(/\b([6-9]\d{9})\b/);
    if (anyMobile) mobile = anyMobile[1];
  }

  // ── Email ─────────────────────────────────────────────────
  const emailMatch = t.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/);
  const email = emailMatch ? emailMatch[0] : null;

  return {
    account_holder,
    bank_name,
    account_no,
    ifsc,
    account_type,
    mobile,
    email,
  };
}

// ── helpers ──────────────────────────────────────────────────────────

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/[,.;:]+$/, "");
}

function cleanAccount(s: string): string {
  return s.replace(/[^\dX*]/gi, "");
}

function canonicalBank(hit: string): string {
  // Prefer the long-form name if the OCR matched the acronym.
  const promoteMap: Record<string, string> = {
    SBI:      "State Bank of India",
    HDFC:     "HDFC Bank",
    ICICI:    "ICICI Bank",
    Axis:     "Axis Bank",
    Kotak:    "Kotak Mahindra Bank",
    PNB:      "Punjab National Bank",
    BoB:      "Bank of Baroda",
    BoI:      "Bank of India",
    "Union Bank": "Union Bank of India",
    TMB:      "Tamilnad Mercantile Bank",
    "IDFC FIRST": "IDFC First Bank",
    IDBI:     "IDBI Bank",
  };
  return promoteMap[hit] ?? hit;
}

function looksLikeName(line: string): boolean {
  if (!line || /\d/.test(line)) return false;
  const words = line.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z.'-]+$/.test(w));
  return words.length >= 2;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
