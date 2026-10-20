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
  inverter: "Polycab",
  titles: ["Mr.", "Mrs.", "Ms.", "Dr."],
  phases: ["Single Phase", "Three Phase"],
  inverterLocations: ["Ground", "Rooftop", "Parking", "Staircase"],
  connectionTypes: ["Domestic", "Commercial", "Industrial"],
  commercial: (connection: string) => /commercial|industrial/i.test(connection),
  roofTypes: ["RCC", "Tin shed", "Asbestos", "Tiled"],
  structureTypes: ["Galvanised Iron", "Hot-dip Galvanised", "Aluminium"],
  designShare: 0.3, // "On design approval" default share of the price (₹90,000 of ₹3,00,000)
  booking: 10000,   // booking / advance amount
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
