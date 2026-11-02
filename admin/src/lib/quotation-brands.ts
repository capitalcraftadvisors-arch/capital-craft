import { centralSubsidyFor } from "./emi";

// Default option lists for the Quotation Builder dropdowns. Each dropdown is
// searchable and lets the EPC add a custom value, which is persisted in
// quotation_brand_options and merged in on next load (so "add custom" sticks).

export const MODULE_BRANDS = [
  "Waaree", "Adani Solar", "Tata Power Solar", "Vikram Solar", "RenewSys",
  "Premier Energies", "Goldi Solar", "Emmvee", "Jakson Solar", "Saatvik Solar",
  "Rayzon Solar", "Loom Solar", "Solex Energy", "Navitas Solar", "Alpex Solar",
  "Insolation Energy", "Bluebird Solar", "Avaada", "Jupiter International",
  "Mundra Solar", "Jakson", "Lubi Solar", "Swelect", "Shakti Solar",
  "Surya International", "Insolar", "Eastman", "Saatvik Green Energy",
  "Navitas Green", "ZunSolar", "Patanjali Renewable Energy", "SASA Energy",
  "Gensol Solar", "Jakson Green",
];

export const INVERTER_BRANDS = [
  "Sungrow", "Solis", "Growatt", "GoodWe", "Huawei", "Fronius", "SMA", "FIMER",
  "Delta", "Sofar", "SolaX", "Enphase", "Havells", "Luminous", "Microtek", "UTL",
  "Waaree", "Servotech", "Statcon Energiaa", "Jakson", "Eastman", "Livguard",
  "Su-Kam", "SunGarner", "ZunSolar", "Loom Solar", "RenewSys", "Saatvik",
  "Goldi Solar", "Premier Energies", "Solplanet", "Sineng", "Kehua", "TBEA",
];

// Mounting structure = roof type → the mount options for that roof (+ custom).
export const ROOF_TYPES = [
  "Flat Concrete (RCC) Roof",
  "Metal / Tin Sheet Roof",
  "Slanted Tile Roof (Clay Tiles)",
  "Open Land / Ground",
] as const;

export const MOUNTS_BY_ROOF: Record<string, string[]> = {
  "Flat Concrete (RCC) Roof": ["Standard HDGI Mount (Low Height)", "Elevated HDGI High-Rise (6 to 10 feet)"],
  "Metal / Tin Sheet Roof": ["Aluminum Mini-Rail Clamps"],
  "Slanted Tile Roof (Clay Tiles)": ["SS304 Hooks with Aluminum Rails"],
  "Open Land / Ground": ["Ground-Mounted HDGI Structure"],
};

export const ACDB_DCDB_OPTIONS = ["MNRE Standard Equivalent (depends on size)"];
export const CABLE_OPTIONS = ["Havells", "Polycab", "RR Kabel", "MNRE Standard Equivalent"];
export const BATTERY_OPTIONS = ["Exide", "Luminous", "MNRE Equivalent Standard"];

export const SYSTEM_TYPES = ["Hybrid", "On-grid", "Off-grid"] as const;

// PDF-template EPCs: each quotation's own defaults, its serial number format
// (`serial`) and how to read the running number back out of one (`serialNo`).

// Bijlee Solar (template bundled:bijlee).
export const BIJLEE = {
  key: "bundled:bijlee",
  module: "Novasys/ Navitas Green Solutions",
  inverter: "Growatt/ Sungrow",
  cable: "Polycab",
  serial: (n: number) => `BIJ-${n}/P/1.2`,
  serialNo: (s: string) => Number(/\d+/.exec(s)?.[0]),
};

// Sarvatra Energy — gozerobils (template bundled:sarvatra). Quote no. carries the month.
export const SARVATRA = {
  key: "bundled:sarvatra",
  panel: "Adani",
  panelType: "Bifacial Topcon 600+ Wp",
  panelTypes: ["Bifacial 545+ Wp", "Bifacial Topcon 600+ Wp", "Bifacial Topcon 700+ Wp"],
  // A panel's watt rating from its type or Wp ("Bifacial 545+ Wp" / "545+Wp" → 545; 0 = none written).
  wattsOf: (s: string) => Number(/(\d{3,4})\s*\+?\s*w/i.exec(s)?.[1]) || 0,
  inverter: "Polycab",
  // System size as written on the documents ("3+" = 3 kW and above); any custom size can be typed.
  kwOptions: ["3+", "4+", "5+", "6+", "7+", "8+", "9+", "10+", "12+", "15+"],
  kwOf: (v: unknown) => parseFloat(String(v ?? "")) || 0, // "3+" → 3
  floors: Array.from({ length: 12 }, (_, n) => `G+${n + 1}`),
  titles: ["Mr.", "Mrs.", "Ms.", "Dr."],
  phases: ["Single Phase", "Three Phase"],
  inverterLocations: ["Ground", "Rooftop", "Parking", "Staircase"],
  connectionTypes: ["Domestic", "Commercial", "Industrial"],
  commercial: (connection: string) => /commercial|industrial/i.test(connection),
  roofTypes: ["RCC", "Tin shed", "Asbestos", "Tiled"],
  structureTypes: ["Galvanised Iron", "Hot-dip Galvanised", "Aluminium", "Magnelis"],
  designShare: 0.3, // "On design approval" default share of the price (₹90,000 of ₹3,00,000)
  booking: 10000,   // default booking / advance amount
  // Sustera Ventures sends its customers' emails from its own Gmail
  // (app password: SUSTERA_GMAIL_APP_PASSWORD).
  sender: "acc.sustera@gmail.com",
  senderName: "Sustera Ventures",
  // Project Confirmation Receipt (PCR)
  cellType: "Topcon Bifacial",
  wp: "600+Wp",
  dcrTypes: ["Both", "DCR", "NDCR"],
  inverterTypes: ["On-grid", "Off-grid", "Hybrid"],
  maintenancePlans: ["Monthly 1 yr", "Quarterly 1 yr", "Monthly 5 yr", "Quarterly 5 yr", "Included"],
  siteReadiness: ["Ready for installation", "Under development (60 days)", "Under development (90 days)"],
  billCorrections: ["Name change", "Phase change", "Load change"],
  paymentMethods: ["UPI", "Cash", "Cheque", "NEFT / RTGS", "Card"],
  paymentModes: ["Direct", "Financing"],
  serial: (n: number, month = new Date().getMonth() + 1) => `Quote_GZB_${String(month).padStart(2, "0")}-${String(n).padStart(3, "0")}`,
  serialNo: (s: string) => Number(/(\d+)\D*$/.exec(s)?.[1]),
};

// gozerobils quotation figures from the raw form values — the form shows them
// and the PDFs print them. A blank optional value means "auto": central subsidy
// by kW, panels from kW and the panel type's watts, booking ₹10,000, design
// approval 30% of the price; material dispatch is whatever remains.
export function sarvatraTerms(v: Record<string, unknown>) {
  const opt = (k: string) => (v[k] === "" || v[k] == null ? null : Number(v[k]) || 0);
  const kw = SARVATRA.kwOf(v.kw);
  const price = Number(v.price) || 0;
  const central = opt("central_subsidy") ?? centralSubsidyFor(kw, SARVATRA.commercial(String(v.connection_type ?? "")));
  const booking = opt("booking") ?? SARVATRA.booking;
  const design = opt("design_payment") ?? Math.round(price * SARVATRA.designShare);
  return {
    kw, price, central, booking, design,
    panels: opt("panels") || Math.ceil((kw * 1000) / (SARVATRA.wattsOf(String(v.wp ?? "")) || SARVATRA.wattsOf(String(v.panel_type ?? "")) || 600)),
    net: Math.max(0, price - central - (Number(v.state_subsidy) || 0)),
    dispatch: Math.max(0, price - booking - design),
  };
}

// Sarvatra Energy (template bundled:sarvatra-energy) — their offer letter: the
// customer table, the bill of quantities and the commercial summary. Quote no.
// as in their sample (SE2025-26 1579).
export const SARVATRA_ENERGY = {
  key: "bundled:sarvatra-energy",
  gst: 8.9, // % — the total project cost is printed as supply + GST
  categories: ["Domestic", "Non-Domestic"],
  dcrTypes: ["DCR", "NDCR"],
  serial: (n: number) => `SE2025-26 ${n}`,
  serialNo: (s: string) => Number(/(\d+)\D*$/.exec(s)?.[1]),
};

// Bill of quantities: every cell is a dropdown whose first option is the default
// (as in their sample); custom values are saved under boqField(row, column).
export const BOQ_COLUMNS = ["make", "spec", "qty"] as const;
export type BoqColumn = (typeof BOQ_COLUMNS)[number];
export type BoqRow = { key: string; product: string } & Record<BoqColumn, string[]>;
export const boqField = (row: string, col: BoqColumn) => `boq_${row}_${col}`;

export const SARVATRA_ENERGY_BOQ: BoqRow[] = [
  { key: "module", product: "Solar PV Modules",
    make: ["ADANI", "WAAREE", "RAYZON", "PREMIER", "GOLDI", "VIKRAM", "TATA POWER", "RENEWSYS", "SAATVIK", "EMMVEE"],
    spec: ["625 WP Topcon Bifacial", "620 WP Topcon Bifacial", "610 WP Topcon Bifacial", "600 WP Topcon Bifacial", "590 WP Topcon Bifacial",
      "585 WP Topcon Bifacial", "575 WP Topcon Bifacial", "550 WP Mono PERC Bifacial", "545 WP Mono PERC Bifacial", "540 WP Mono PERC Bifacial"],
    qty: [] }, // from the kW and the module's watts
  { key: "inverter", product: "Solar On-Grid String Inverter",
    make: ["POLYCAB/ MICROTEK", "POLYCAB", "MICROTEK", "HAVELLS", "SUNGROW", "GROWATT", "SOLIS", "GOODWE", "DELTA", "LUMINOUS"],
    spec: [], // the system kW
    qty: ["1 Nos.", "2 Nos."] },
  { key: "meter", product: "Solar + Net Meter", make: ["L&T / HPL / Secure", "L&T", "HPL", "Secure", "Genus"], spec: ["1 PH", "3 PH"], qty: ["1+1 Nos."] },
  { key: "structure", product: "Module Mounting Structure",
    make: ["APOLLO APL", "TATA STRUCTURA", "JINDAL", "Customized"],
    spec: ["Customized galvanized GP pipe", "Hot-dip galvanized (HDGI)", "Galvanized iron (GI)", "Aluminium", "Magnelis"],
    qty: ["As per Site"] },
  { key: "cable", product: "DC/AC Cables", make: ["POLYCAB", "HAVELLS", "KEI", "RR KABEL", "FINOLEX"],
    spec: ["4 sq.mm / 4C", "4 sq.mm / 2C", "6 sq.mm / 4C", "6 sq.mm / 2C", "10 sq.mm / 4C"], qty: ["As per Site"] },
  { key: "earthing", product: "Earthing Strip / Wire", make: ["POLYCAB", "HAVELLS", "KEI"],
    spec: ["4 sq.mm copper bonded rod & wire", "Copper bonded rod & GI strip", "Chemical earthing"], qty: ["3 Nos.", "2 Nos.", "4 Nos."] },
  { key: "arrester", product: "Lightning Arrester", make: ["—"], spec: ["Conventional type, 1 meter", "ESE type"], qty: ["1 Nos.", "2 Nos."] },
  { key: "acdb", product: "ACDB & DCDB", make: ["Schneider / Havells / Sibass / Elemax", "Schneider", "Havells", "Elemax"], spec: ["As per site"], qty: ["1+1 Nos."] },
  { key: "pedestal", product: "Pedestal for MMS", make: ["Customized"], spec: ["300×300×300 mm", "400×400×400 mm"], qty: ["As per Design"] },
  { key: "protection", product: "MCB / SPD / MC4 / Conduit", make: ["Havells / Sibass / Reputed / Polycab"], spec: ["As per site / requirement"], qty: ["As per Site"] },
];

/** The printed BOQ: each cell as picked (`<row>_<column>`), else its default —
 *  the module quantity from the kW and the module's watts, the inverter = the system kW. */
export function sarvatraEnergyBoq(picked: Record<string, unknown>, kw: number): Record<string, Record<BoqColumn, string>> {
  const out: Record<string, Record<BoqColumn, string>> = {};
  for (const r of SARVATRA_ENERGY_BOQ) {
    const get = (col: BoqColumn) => String(picked[`${r.key}_${col}`] ?? "").trim();
    const spec = get("spec") || (r.key === "inverter" ? (kw > 0 ? `${+kw.toFixed(2)}KW` : "") : r.spec[0] ?? "");
    const watts = SARVATRA.wattsOf(spec);
    const qty = get("qty") || (r.key === "module" ? (kw > 0 && watts ? `${Math.ceil((kw * 1000) / watts)} Nos.` : "") : r.qty[0] ?? "");
    out[r.key] = { make: get("make") || r.make[0], spec, qty };
  }
  return out;
}

/** Total project cost → supply + GST (₹2,38,000 → ₹2,18,549 + ₹19,451). */
export function sarvatraEnergyTotals(total: number) {
  const base = Math.round(total / (1 + SARVATRA_ENERGY.gst / 100));
  return { base, gst: total - base };
}

// Field keys used for persisting custom options (quotation_brand_options.field).
export const BRAND_FIELDS = {
  module: "module_brand",
  inverter: "inverter_brand",
  mount: "mount",
  acdb: "acdb",
  dcdb: "dcdb",
  cable: "cable",
  battery: "battery",
  inverterLocation: "inverter_location",
  connectionType: "connection_type",
  roofType: "roof_type",
  structureType: "structure_type",
} as const;
