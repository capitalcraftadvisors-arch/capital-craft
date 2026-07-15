// Indian-system number → words (lakh / crore grouping, not million).
//
// Used under the approval-table inputs so the admin can eyeball that what they
// typed is what they meant:
//   280000 -> "Two Lakh Eighty Thousand Rupees Only"
//   6155   -> "Six Thousand One Hundred Fifty Five Rupees Only"
//   5      -> "Five years"
//
// Paise are ignored (values are floored) — every amount here is a whole rupee.

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? " " + ONES[o] : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(ONES[h] + " Hundred");
  if (r) parts.push(twoDigits(r));
  return parts.join(" ");
}

// Core: groups as crore / lakh / thousand / hundreds.
export function numberToWordsIndian(value: number): string {
  if (!Number.isFinite(value)) return "";
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";

  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;

  // Recurse for the crore group so 100+ crore still reads correctly.
  if (crore) parts.push(numberToWordsIndian(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (n) parts.push(threeDigits(n));

  const words = parts.join(" ");
  return value < 0 ? "Minus " + words : words;
}

// "Two Lakh Eighty Thousand Rupees Only"
export function rupeesInWords(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  return numberToWordsIndian(Number(value)) + " Rupees Only";
}

// "Five years" / "One year"
export function yearsInWords(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  const n = Math.floor(Math.abs(Number(value)));
  return numberToWordsIndian(n) + (n === 1 ? " year" : " years");
}
