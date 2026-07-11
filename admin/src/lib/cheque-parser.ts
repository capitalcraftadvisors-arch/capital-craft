// Parses account number / IFSC / bank name from a cancelled-cheque's
// Vision OCR text. Ported from the extract-cheque Edge Function so the
// Cloud Run route (/api/epc/extract-cheque) can run on the SAME working
// GOOGLE_VISION_API_KEY the loan-applicant PAN/Aadhaar OCR uses.
//
// Account number: label-anchored first (English + Hindi), then a bounded
// longest-run fallback (excludes the MICR band at the very bottom). The
// EPC re-enters the account number as a verification step, so a rare
// misread is caught by the confirm-match rather than silently accepted.

export type ChequeFields = {
  accountNumber: string | null;
  ifsc: string | null;
  bankName: string | null;
};

export function parseChequeFields(text: string): ChequeFields {
  const ifsc = (text.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/) || [])[0] ?? null;
  const accountNumber = findAccountByLabel(text) ?? findAccountFallback(text);
  const bankName = bankFromIfsc(ifsc) ?? bankFromText(text);
  return { accountNumber, ifsc, bankName };
}

// ── Account number extraction ──────────────────────────────────────

// Label-anchored — English + Hindi. Two tiers: inline, then label-line →
// next 1-2 lines.
function findAccountByLabel(text: string): string | null {
  const LABEL = new RegExp(
    "(?:"
    + "A\\s*[\\/\\.]?\\s*[cC]\\s*(?:No\\.?)?"          // A/c No, A/C No, A c No
    + "|Account\\s+(?:No\\.?|Number)"                  // Account No, Account Number
    + "|खा\\s*\\.?\\s*सं\\s*\\.?"                       // खा. सं.
    + "|खाता\\s*(?:सं\\s*\\.?|संख्या)"                    // खाता सं, खाता संख्या
    + ")",
    "i",
  );

  const inline = text.match(new RegExp(LABEL.source + "\\s*[:.\\-]?\\s*(\\d{9,18})", "i"));
  if (inline) return inline[1];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!LABEL.test(lines[i])) continue;
    const same = lines[i].match(/\b(\d{9,18})\b/);
    if (same) return same[1];
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const next = lines[j].match(/\b(\d{9,18})\b/);
      if (next) return next[1];
    }
  }
  return null;
}

// Fallback when no label is found: the longest 9-18 digit run in the body,
// EXCLUDING the last two non-empty lines (the MICR band + cheque-number
// row live at the very bottom and would otherwise win). Best-effort — the
// user verifies via the re-enter box.
function findAccountFallback(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const body = lines.slice(0, Math.max(0, lines.length - 2)).join("\n");
  const runs = body.match(/\d{9,18}/g);
  if (!runs || runs.length === 0) return null;
  return runs.slice().sort((a, b) => b.length - a.length)[0];
}

// ── Bank name extraction ───────────────────────────────────────────

const IFSC_BANK_PREFIX: Record<string, string> = {
  HDFC: "HDFC Bank", ICIC: "ICICI Bank", SBIN: "State Bank of India",
  UTIB: "Axis Bank", KKBK: "Kotak Mahindra Bank", YESB: "YES Bank",
  PUNB: "Punjab National Bank", ORBC: "Punjab National Bank",
  BARB: "Bank of Baroda", IDFB: "IDFC FIRST Bank", INDB: "IndusInd Bank",
  CNRB: "Canara Bank", SYNB: "Canara Bank", BKID: "Bank of India",
  IOBA: "Indian Overseas Bank", IBKL: "IDBI Bank", FDRL: "Federal Bank",
  CITI: "Citibank", HSBC: "HSBC Bank", SCBL: "Standard Chartered Bank",
  RATN: "RBL Bank", BDBL: "Bandhan Bank", AUBL: "AU Small Finance Bank",
  UCBA: "UCO Bank", PSIB: "Punjab & Sind Bank", UBIN: "Union Bank of India",
  ANDB: "Union Bank of India", CORP: "Union Bank of India",
  CBIN: "Central Bank of India", ALLA: "Indian Bank", IDIB: "Indian Bank",
  KARB: "Karnataka Bank", TMBL: "Tamilnad Mercantile Bank",
  CIUB: "City Union Bank", DCBL: "DCB Bank", KVBL: "Karur Vysya Bank",
  SIBL: "South Indian Bank", JAKA: "Jammu and Kashmir Bank",
  ESFB: "Equitas Small Finance Bank", UJVN: "Ujjivan Small Finance Bank",
  DLXB: "Dhanlaxmi Bank", NKGS: "NKGSB Co-op Bank", SVCB: "SVC Co-operative Bank",
};

function bankFromIfsc(ifsc: string | null): string | null {
  if (!ifsc || ifsc.length < 4) return null;
  return IFSC_BANK_PREFIX[ifsc.slice(0, 4).toUpperCase()] ?? null;
}

function bankFromText(text: string): string | null {
  const lines = text.split(/\r?\n/).slice(0, 20);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bankOf = line.match(/\b(Bank\s+of\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\b/);
    if (bankOf) return cleanName(bankOf[1]);
    const xBank = line.match(/\b([A-Z][A-Za-z&]+(?:\s+[A-Z][A-Za-z&]+){0,4})\s+Bank\b/);
    if (xBank) return cleanName(xBank[1] + " Bank");
    const xBankCaps = line.match(/\b([A-Z][A-Z&]+(?:\s+[A-Z][A-Z&]+){0,4})\s+BANK\b/);
    if (xBankCaps) return cleanName(toTitleCase(xBankCaps[1] + " Bank"));
  }
  return null;
}

function cleanName(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 80);
}

function toTitleCase(s: string): string {
  return s.toLowerCase().split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
