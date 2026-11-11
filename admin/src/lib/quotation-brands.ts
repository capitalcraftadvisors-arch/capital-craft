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

export type BoqCells = Record<string, Record<BoqColumn, string>>;

/** The printed table: each cell as picked (`<row>_<column>`), else `auto` (when it
 *  gives one), else the cell's first option. Columns fill in BOQ_COLUMNS order. */
export function boqCells(rows: BoqRow[], picked: Record<string, unknown>,
  auto: (row: string, col: BoqColumn, cells: Record<BoqColumn, string>) => string | undefined): BoqCells {
  const out: BoqCells = {};
  for (const r of rows) {
    const cells = {} as Record<BoqColumn, string>;
    for (const col of BOQ_COLUMNS) cells[col] = String(picked[`${r.key}_${col}`] ?? "").trim() || (auto(r.key, col, cells) ?? r[col][0] ?? "");
    out[r.key] = cells;
  }
  return out;
}

// Panels for a plant: kW ÷ the module's watts (its highest rating in the text), rounded up.
const panelsFor = (kw: number, spec: string) => {
  const watts = SARVATRA.wattsOf(spec);
  return kw > 0 && watts ? Math.ceil((kw * 1000) / watts) : 0;
};
const kwText = (kw: number) => String(+kw.toFixed(2));

/** Sarvatra Energy's BOQ — the module quantity from the kW and the module's watts, the inverter = the system kW. */
export function sarvatraEnergyBoq(picked: Record<string, unknown>, kw: number): BoqCells {
  return boqCells(SARVATRA_ENERGY_BOQ, picked, (row, col, c) =>
    row === "inverter" && col === "spec" ? (kw > 0 ? `${kwText(kw)}KW` : "")
    : row === "module" && col === "qty" ? (panelsFor(kw, c.spec) ? `${panelsFor(kw, c.spec)} Nos.` : "")
    : undefined);
}

/** Total project cost → supply + GST (₹2,38,000 → ₹2,18,549 + ₹19,451). */
export function sarvatraEnergyTotals(total: number) {
  const base = Math.round(total / (1 + SARVATRA_ENERGY.gst / 100));
  return { base, gst: total - base };
}

// RVS Technologies (template bundled:rvs) — their solar proposal. Savings as in
// their sample: 1,460 units per kW a year at ₹8 a unit, rising 5 % a year less
// 0.5 % panel ageing; trees = units × 0.5 kg CO₂ ÷ 22 kg a tree; CO₂ (tonnes,
// 25 years) at 0.575 kg a unit. These reproduce the 10 kW / ₹4,14,000 sample.
export const RVS = {
  key: "bundled:rvs",
  gst: 8.9, // % on the system price
  unitsPerKw: 1460,
  tariff: 8,
  growth: 1.05 * 0.995,
  dcrTypes: ["DCR", "Non-DCR"], // the solar modules' type, printed after their description
};

// Bill of material: description / QTY / make (UOM stays as printed). The sample's
// module and inverter makes are logos — kept while those makes are chosen.
const MMS = "Module mounting structure: HDG with appropriate analysis for Load/wind speed(As per MNRE/Indian Standard) -";
export const RVS_BOM: BoqRow[] = [
  { key: "rvs_module", product: "Solar modules",
    spec: ["Solar Topcon Bifacial Modules of 540 - 600 Wp", "Solar Topcon Bifacial Modules of 580 - 620 Wp",
      "Solar Topcon Bifacial Modules of 600 - 625 Wp", "Solar Mono PERC Bifacial Modules of 540 - 550 Wp"],
    qty: [], // from the kW and the module's watts
    make: ["Adani", "Waaree", "Rayzon", "Premier", "Goldi", "Vikram", "Tata Power", "Renewsys", "Saatvik", "Emmvee"] },
  { key: "rvs_inverter", product: "Inverter", spec: [], // String Inverter - <kW> KW
    qty: ["1", "2"], make: ["VSOLE", "Polycab", "Havells", "Sungrow", "Growatt", "Solis", "GoodWe", "Deye", "Microtek", "Luminous"] },
  { key: "rvs_structure", product: "Mounting structure", spec: [`${MMS} 3*5 ft -Height`, `${MMS} 6*8 ft -Height`, `${MMS} 8*10 ft -Height`],
    qty: ["1"], make: ["G.I. / Hot-Dip Galvanised", "Hot-Dip Galvanised", "G.I.", "Aluminium", "Magnelis"] },
  { key: "rvs_earthing_points", product: "Structure earthing", spec: ["Mounting Structure earthing points"], qty: ["1", "2", "3"], make: ["True Power", "As per standard"] },
  { key: "rvs_arrestor", product: "Lightning arrestor", spec: ["Lightning Arrestor  and earthing kits"], qty: ["1", "2"], make: ["True Power", "As per standard"] },
  { key: "rvs_spike", product: "Spike rod", spec: ["Spike rod with base plate –GI"], qty: ["1", "2", "3"], make: ["As per standard"] },
  { key: "rvs_earthing_kit", product: "Earthing kit", spec: ["Earthing kit"], qty: ["1", "2", "3"], make: ["As per standard"] },
  { key: "rvs_dc_cable", product: "DC cables", spec: ["DC Cables - As per required"], qty: ["1"], make: ["Polycab", "Havells", "KEI", "RR Kabel", "Finolex"] },
  { key: "rvs_ac_cable", product: "AC cables", spec: ["AC Cables - As per required"], qty: ["1"], make: ["Polycab", "Havells", "KEI", "RR Kabel", "Finolex"] },
  { key: "rvs_armoured", product: "Armoured cable", spec: ["Cu & Al Armoured cable - As per required"], qty: ["Lot"], make: ["As per standard", "Polycab", "Havells"] },
  { key: "rvs_dcdb", product: "DCDB", spec: ["DCDB"], qty: ["1", "2"], make: ["Havells / Elmex", "Havells", "Elmex", "Schneider", "L&T"] },
  { key: "rvs_acdb", product: "ACDB", spec: ["ACDB"], qty: ["1", "2"], make: ["Havells / Elmex", "Havells", "Elmex", "Schneider", "L&T"] },
  { key: "rvs_conduit", product: "Conduit & accessories", spec: ["Conduit, Cables ties & accessories - As per required"], qty: ["-"], make: ["As per standard"] },
];

/** RVS's bill of material — the module QTY from the kW and the module's watts; the inverter line = the plant kW. */
export function rvsBom(picked: Record<string, unknown>, kw: number): BoqCells {
  return boqCells(RVS_BOM, picked, (row, col, c) =>
    row === "rvs_inverter" && col === "spec" ? (kw > 0 ? `String Inverter - ${kwText(kw)} KW` : "")
    : row === "rvs_module" && col === "qty" ? (panelsFor(kw, c.spec) ? String(panelsFor(kw, c.spec)) : "")
    : undefined);
}

/** Non-DCR modules get no MNRE subsidy. */
export const rvsNoSubsidy = (dcr: string) => dcr === RVS.dcrTypes[1];

/** RVS proposal figures: the system price is before GST; the MNRE subsidy blank (null) = by kW, 0 for Non-DCR. */
export function rvsFigures(kw: number, price: number, subsidy: number | null, dcr: string = RVS.dcrTypes[0]) {
  const gst = Math.round((price * RVS.gst) / 100);
  const total = price + gst;
  const mnre = rvsNoSubsidy(dcr) ? 0 : subsidy ?? centralSubsidyFor(kw, false);
  const units = Math.round(kw * RVS.unitsPerKw);
  const savings = units * RVS.tariff;
  return {
    gst, total, subsidy: mnre, effective: Math.max(0, total - mnre), units, savings,
    payback: savings > 0 ? (total / savings).toFixed(2) : "-",
    trees: Math.round((units * 0.5) / 22),
    co2: Math.round((units * 25 * 0.575) / 1000),
    years: Array.from({ length: 25 }, (_, n) => savings * RVS.growth ** n),
  };
}

// Standard quotation — Capital Craft's own proposal for every EPC without a
// builder of its own (saved quotations, epc_quotes 0118), in two kinds, with
// defaults taken from the EPCs' own quotations:
//   residential — PM Surya Ghar: DCR modules, central subsidy by kW, net cost
//   commercial  — non-domestic: Non-DCR, no subsidy, bigger advances
// Every figure comes from ONE kW + price entry (their samples' typos came from
// typing the same size several times) — lib/quote-calc.
export type Segment = "residential" | "commercial";
export type PaymentStage = [stage: string, pct: number];

export const STANDARD = {
  gst: 8.9,                      // % on the system price (70 % at 5 % + 30 % at 18 %)
  unitsPerKw: 1460,              // a year (4 units a kW a day)
  tariff: { residential: 8, commercial: 10 } as Record<Segment, number>, // ₹ a unit
  tariffRise: 0.03,              // a year
  degradation: 0.005,            // panel output lost a year
  emiYears: [3, 4, 5],           // the EMI box (indicative rate, never printed)
  validityDays: { residential: 30, commercial: 7 } as Record<Segment, number>,
  categories: { residential: ["Domestic"], commercial: ["Non-Domestic", "Industrial"] } as Record<Segment, string[]>,
  phases: ["Single phase", "Three phase"],
  systemTypes: ["On-grid", "Off-grid", "Hybrid"], // residential + commercial alike
  payment: {
    residential: [["Advance with the order", 30], ["Before dispatch of panels & inverter", 60], ["After installation & commissioning", 10]],
    commercial: [["Advance with the work order", 10], ["Before material delivery", 85], ["After commissioning", 5]],
  } as Record<Segment, PaymentStage[]>,
  timeline: {
    residential: "Installation within 30 days of the DISCOM approval and the advance payment.",
    commercial: "Installation within 15 to 30 days of the advance payment.",
  } as Record<Segment, string>,
  warranty: [
    ["Solar modules", "12 years product, 25 years performance (min. 80%)"],
    ["Inverter", "8 years (as per manufacturer)"],
    ["Mounting structure", "5 years"],
    ["Workmanship & balance of system", "1 year"],
    ["Free maintenance", "1 year"],
  ] as [string, string][],
  // Scope of work ("DISCOM and net-metering fees" joins one side by the quotation's toggle).
  scope: {
    ours: ["Design, supply, installation and commissioning", "Transport of all material to the site", "Net-metering and DISCOM liaison"],
    residential: ["Subsidy application on the PM Surya Ghar portal"],
    theirs: ["A shadow-free roof with safe access", "Power and water during installation", "Safe storage for the material",
      "Space for the ACDB and meters near the main panel", "Internet (Wi-Fi) for remote monitoring", "Regular cleaning of the panels"],
  },
};

// Bill of material — description / make / QTY dropdowns, prefilled as in the
// samples; the battery row only on a hybrid system.
export const STANDARD_BOM: BoqRow[] = [
  { key: "std_module", product: "Solar PV modules",
    spec: ["Mono PERC half-cut bifacial 550 Wp", "TOPCon bifacial 580 Wp", "TOPCon bifacial 600 Wp", "TOPCon bifacial 625 Wp", "TOPCon bifacial 700 Wp"],
    make: ["Waaree", "Adani Solar", "Tata Power Solar", "Vikram Solar", "Premier Energies", "Goldi Solar", "Rayzon Solar", "Saatvik Solar", "RenewSys", "Avaada"],
    qty: [] }, // from the kW and the module's watts
  { key: "std_inverter", product: "Solar inverter", spec: [], // <kW> kW on-grid string inverter, <phase>
    make: ["Polycab", "Sungrow", "Solis", "Growatt", "GoodWe", "Microtek", "Havells", "Luminous", "Deye"], qty: ["1 No.", "2 Nos."] },
  { key: "std_battery", product: "Battery", spec: ["Lithium-ion 5 kWh", "Lithium-ion 10 kWh", "Lead-acid 150 Ah"],
    make: ["Exide", "Luminous", "Livguard", "Amaron"], qty: ["1 No.", "2 Nos.", "4 Nos."] },
  { key: "std_structure", product: "Module mounting structure",
    spec: ["Hot-dip galvanised (HDG), wind speed 150 km/h", "Pre-galvanised GI pipe 75x75 / 60x40 / 40x40", "Elevated HDG structure (6 to 8 ft)", "Aluminium rails for tin roof"],
    make: ["Apollo", "Tata Structura", "Jindal", "As per standard"], qty: ["1 Set"] },
  { key: "std_acdb", product: "ACDB & DCDB", spec: ["With MCB, SPD & fuse (IP65)"], make: ["Havells / Elmex", "Schneider", "Havells", "Elmex", "Polycab"], qty: ["1 + 1"] },
  { key: "std_dc_cable", product: "DC cable", spec: ["4 sq mm copper, UV protected", "6 sq mm copper, UV protected"], make: ["Polycab", "Havells", "KEI", "RR Kabel", "Finolex"], qty: ["As required"] },
  { key: "std_ac_cable", product: "AC cable", spec: ["Copper armoured, as per load", "4C 10 sq mm copper armoured"], make: ["Polycab", "Havells", "KEI", "RR Kabel", "Finolex"], qty: ["As required"] },
  { key: "std_earthing", product: "Earthing", spec: ["Chemical earthing pit", "Copper-bonded rod"], make: ["As per standard"], qty: ["3 Nos.", "2 Nos.", "4 Nos."] },
  { key: "std_arrester", product: "Lightning arrester", spec: ["Conventional, 1 m", "ESE type"], make: ["As per standard"], qty: ["1 No.", "2 Nos."] },
  { key: "std_meter", product: "Solar & net meter", spec: ["As per DISCOM norms"], make: ["L&T / HPL / Secure", "L&T", "HPL", "Secure", "Genus"], qty: ["1 + 1"] },
  { key: "std_bos", product: "MC4 connectors & accessories", spec: ["Conduits, cable ties & SS hardware"], make: ["As per standard"], qty: ["As required"] },
  { key: "std_monitoring", product: "Remote monitoring", spec: ["Wi-Fi data logger with mobile app"], make: ["With inverter"], qty: ["1 No."] },
  { key: "std_install", product: "Installation & commissioning", spec: ["Transport, civil work & net-metering liaison"], make: ["Included"], qty: ["Lump sum"] },
];

// Items a quotation may add beyond the standard bill of material ("+ Add item").
export const STANDARD_EXTRAS: { product: string; spec: string }[] = [
  { product: "Generation meter", spec: "As per DISCOM norms" },
  { product: "Zero export device", spec: "Export limiter with CT" },
  { product: "Panel cleaning system", spec: "Sprinklers with water line" },
  { product: "Walkway & safety railing", spec: "GI walkway with railing" },
  { product: "Fire extinguisher & danger signage", spec: "As per safety norms" },
  { product: "Annual maintenance (AMC)", spec: "Cleaning & check-ups, 1 year" },
];

/** A battery bank: hybrid and off-grid systems. */
export const withBattery = (systemType: string) => systemType === "Hybrid" || systemType === "Off-grid";

/** The standard bill of material: module QTY from the kW and watts, the inverter line from the kW + phase + system type. */
export function standardBom(picked: Record<string, unknown>, kw: number, phase: string, systemType: string): { rows: BoqRow[]; cells: BoqCells } {
  const rows = STANDARD_BOM.filter((r) => withBattery(systemType) || r.key !== "std_battery");
  const inverter = systemType === "Hybrid" ? "hybrid" : systemType === "Off-grid" ? "off-grid" : "on-grid string";
  return {
    rows,
    cells: boqCells(rows, picked, (row, col, c) =>
      row === "std_inverter" && col === "spec" ? (kw > 0 ? `${kwText(kw)} kW ${inverter} inverter, ${phase.toLowerCase()}` : "")
      : row === "std_module" && col === "qty" ? (panelsFor(kw, c.spec) ? `${panelsFor(kw, c.spec)} Nos.` : "")
      : undefined),
  };
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
