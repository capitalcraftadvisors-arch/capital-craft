// Server-only OCR helpers for the loan-application Step 3 documents:
//   - Proforma invoice / quotation  → total_project_cost, project_size
//   - Latest electricity bill       → monthly_bill_amount, discom_name,
//                                     ca_number, pincode, ebill_address,
//                                     ebill_name
//
// Parsing is heuristic — the extracted fields are shown back to the
// admin for review + edit before persistence. If any regex misses, the
// admin fills the field in by hand.
//
// Do NOT import this file from client code.

import { visionDocumentText } from "./vision-server";

// ── Public types ─────────────────────────────────────────────────────

export type ProformaFields = {
  total_project_cost: number | null;
  project_size:       number | null;
  project_size_unit:  "kw" | "mw" | null;
};

export type EbillFields = {
  monthly_bill_amount: number | null;
  discom_name:         string | null;
  ca_number:           string | null;
  pincode:             string | null;
  ebill_address_line:  string | null;
  ebill_name:          string | null;
};

// ── Public helpers ───────────────────────────────────────────────────

export async function extractProforma(
  buffer: Buffer,
  mimeType: string,
): Promise<{ fields: ProformaFields; raw_text: string }> {
  const text = await visionDocumentText(buffer, mimeType);
  return { fields: parseProforma(text), raw_text: text };
}

export async function extractEbill(
  buffer: Buffer,
  mimeType: string,
): Promise<{ fields: EbillFields; raw_text: string }> {
  const text = await visionDocumentText(buffer, mimeType);
  return { fields: parseEbill(text), raw_text: text };
}

// ── Proforma / quotation parser ──────────────────────────────────────

export function parseProforma(text: string): ProformaFields {
  const t = text || "";

  // Grand total: try labelled hits first, then fall back to the LARGEST
  // rupee-shaped number on the page (which is almost always the total).
  const labelledTotals = findAllAmounts(t, [
    /grand\s*total[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
    /total\s*amount(?:\s*payable)?[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
    /amount\s*payable[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
    /total\s*\(inr\)[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
    /net\s*total[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
  ]);
  let total_project_cost: number | null = null;
  if (labelledTotals.length > 0) {
    total_project_cost = Math.max(...labelledTotals);
  } else {
    // Fallback: pick the largest rupee-shaped number that isn't a phone,
    // GST rate, or PIN code. Solar quotes are usually 6-figure or higher.
    const rupees = Array.from(t.matchAll(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/gi))
      .map((m) => Number(m[1].replace(/,/g, "")))
      .filter((n) => Number.isFinite(n) && n >= 10000);
    if (rupees.length > 0) total_project_cost = Math.max(...rupees);
  }

  // Project size: capture a number and its unit (kW / kilowatt / MW / megawatt).
  // Solar quotes usually print "3.5 kW" or "5 kilowatt".
  let project_size:      number | null                 = null;
  let project_size_unit: "kw" | "mw" | null            = null;
  const sizeMatch = t.match(/([\d]+(?:\.\d+)?)\s*(kilowatt|megawatt|kw|mw)\b/i);
  if (sizeMatch) {
    const n = Number(sizeMatch[1]);
    if (Number.isFinite(n)) {
      project_size = n;
      const u = sizeMatch[2].toLowerCase();
      project_size_unit = u.startsWith("m") ? "mw" : "kw";
    }
  }

  return { total_project_cost, project_size, project_size_unit };
}

// ── Electricity bill parser ──────────────────────────────────────────

// Common Indian DISCOM names / regulator abbreviations we scan for.
// Case-insensitive. We match on word boundaries so "MSEDCL" isn't
// mistaken for a substring of another word.
const DISCOMS = [
  "BSES Rajdhani",
  "BSES Yamuna",
  "BSES",
  "Tata Power Delhi",
  "Tata Power",
  "Adani Electricity",
  "Adani",
  "MSEDCL",
  "Torrent Power",
  "TSSPDCL",
  "TSNPDCL",
  "APSPDCL",
  "APEPDCL",
  "APCPDCL",
  "PSPCL",
  "UPPCL",
  "PVVNL",
  "DVVNL",
  "MVVNL",
  "PuVVNL",
  "KSEB",
  "TANGEDCO",
  "TNEB",
  "BESCOM",
  "MESCOM",
  "HESCOM",
  "GESCOM",
  "CESCOM",
  "CESC",
  "DHBVN",
  "UHBVN",
  "KESCO",
  "MPPKVVCL",
  "MP Paschim",
  "MP Madhya",
  "MP Poorv",
  "CSPDCL",
  "JVVNL",
  "AVVNL",
  "JDVVNL",
  "WBSEDCL",
  "APDCL",
];

export function parseEbill(text: string): EbillFields {
  const t = text || "";

  // Bill amount: labelled hits win. Take the highest labelled amount
  // (bills sometimes print "amount before due date" AND "amount after");
  // both are legitimate — highest is the safe one to prefill.
  const labelled = findAllAmounts(t, [
    /amount\s*payable[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
    /net\s*payable[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
    /net\s*amount[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
    /total\s*amount(?:\s*due)?[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
    /bill\s*amount[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
    /amount\s*due[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/i,
  ]);
  const monthly_bill_amount = labelled.length > 0 ? Math.max(...labelled) : null;

  // DISCOM: first case-insensitive match against the known list.
  let discom_name: string | null = null;
  for (const name of DISCOMS) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
    if (re.test(t)) { discom_name = name; break; }
  }

  // CA / Consumer number. Bills use different labels across regions.
  const caMatch =
    t.match(/(?:consumer\s*(?:no|number|id|account)|k\.?\s*no|ca\s*no|account\s*(?:no|number)|service\s*(?:no|number)|bp\s*no)\s*[:\-.]?\s*([A-Z0-9][A-Z0-9\-\/]{4,20})/i);
  const ca_number = caMatch ? caMatch[1].trim() : null;

  // PIN code — first 6-digit standalone number that starts 1-9. Bills
  // often have a couple; the customer's PIN is usually the first one
  // shown near the service address.
  const pinMatch = t.match(/\b([1-9]\d{5})\b/);
  const pincode = pinMatch ? pinMatch[1] : null;

  // Address line: text after "Address:", trimmed at ~200 chars or at
  // the next labelled block (Consumer, Meter, Bill).
  let ebill_address_line: string | null = null;
  const addrIdx = t.search(/(?:service\s*address|billing\s*address|address)\s*[:\-]/i);
  if (addrIdx >= 0) {
    const tail = t.slice(addrIdx).replace(/^[^:\-]+[:\-]\s*/, "");
    const cutAt = Math.min(
      indexOrEnd(tail, /\n\s*(?:consumer|meter|k\.?\s*no|ca\s*no|bill\s*no|month|reading|discount|rebate)/i),
      indexOrEnd(tail, /\b\d{6}\b/),   // PIN often ends the address block
      200,
    );
    ebill_address_line = clean(tail.slice(0, cutAt).replace(/\s+/g, " "));
    if (ebill_address_line.length < 8) ebill_address_line = null;
  }

  // Name on bill: prefer a "Name:" or "Consumer Name:" label.
  let ebill_name: string | null = null;
  const nameMatch = t.match(/(?:consumer\s*name|customer\s*name|name\s*of\s*consumer|name)\s*[:\-]\s*([A-Z][A-Za-z .'-]{2,60})/i);
  if (nameMatch) ebill_name = clean(nameMatch[1]);

  return {
    monthly_bill_amount,
    discom_name,
    ca_number,
    pincode,
    ebill_address_line,
    ebill_name,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────

function findAllAmounts(text: string, patterns: RegExp[]): number[] {
  const out: number[] = [];
  for (const re of patterns) {
    const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
    const gre = new RegExp(re.source, flags);
    for (const m of text.matchAll(gre)) {
      const n = Number((m[1] ?? "").replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
  }
  return out;
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/[,.;:]+$/, "");
}

function indexOrEnd(haystack: string, needle: RegExp): number {
  const i = haystack.search(needle);
  return i < 0 ? haystack.length : i;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
