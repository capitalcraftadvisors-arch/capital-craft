// Indian states and union territories with their short codes (Rajasthan → RJ).

export const STATE_CODES: Record<string, string> = {
  "Andhra Pradesh": "AP", "Arunachal Pradesh": "AR", "Assam": "AS", "Bihar": "BR", "Chhattisgarh": "CG",
  "Goa": "GA", "Gujarat": "GJ", "Haryana": "HR", "Himachal Pradesh": "HP", "Jharkhand": "JH",
  "Karnataka": "KA", "Kerala": "KL", "Madhya Pradesh": "MP", "Maharashtra": "MH", "Manipur": "MN",
  "Meghalaya": "ML", "Mizoram": "MZ", "Nagaland": "NL", "Odisha": "OD", "Punjab": "PB",
  "Rajasthan": "RJ", "Sikkim": "SK", "Tamil Nadu": "TN", "Telangana": "TG", "Tripura": "TR",
  "Uttar Pradesh": "UP", "Uttarakhand": "UK", "West Bengal": "WB",
  "Andaman and Nicobar Islands": "AN", "Chandigarh": "CH",
  "Dadra and Nagar Haveli and Daman and Diu": "DD", "Delhi": "DL",
  "Jammu and Kashmir": "JK", "Ladakh": "LA", "Lakshadweep": "LD", "Puducherry": "PY",
};

export const INDIA_STATES = Object.keys(STATE_CODES);

// GST state codes — the first two digits of a GSTIN (Rajasthan → 08).
export const GST_STATE_CODES: Record<string, string> = {
  "Jammu and Kashmir": "01", "Himachal Pradesh": "02", "Punjab": "03", "Chandigarh": "04", "Uttarakhand": "05",
  "Haryana": "06", "Delhi": "07", "Rajasthan": "08", "Uttar Pradesh": "09", "Bihar": "10", "Sikkim": "11",
  "Arunachal Pradesh": "12", "Nagaland": "13", "Manipur": "14", "Mizoram": "15", "Tripura": "16", "Meghalaya": "17",
  "Assam": "18", "West Bengal": "19", "Jharkhand": "20", "Odisha": "21", "Chhattisgarh": "22", "Madhya Pradesh": "23",
  "Gujarat": "24", "Dadra and Nagar Haveli and Daman and Diu": "26", "Maharashtra": "27", "Karnataka": "29", "Goa": "30",
  "Lakshadweep": "31", "Kerala": "32", "Tamil Nadu": "33", "Puducherry": "34", "Andaman and Nicobar Islands": "35",
  "Telangana": "36", "Andhra Pradesh": "37", "Ladakh": "38",
};

/** The state a GSTIN is registered in ("08ABCDE…" → "Rajasthan"), or "" when unknown. */
export function stateOfGstin(gstin: string | null | undefined): string {
  const code = String(gstin ?? "").slice(0, 2);
  return Object.keys(GST_STATE_CODES).find((s) => GST_STATE_CODES[s] === code) ?? "";
}
