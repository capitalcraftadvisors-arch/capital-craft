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
