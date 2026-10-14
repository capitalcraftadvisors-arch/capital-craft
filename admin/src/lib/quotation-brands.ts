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

// Field keys used for persisting custom options (quotation_brand_options.field).
export const BRAND_FIELDS = {
  module: "module_brand",
  inverter: "inverter_brand",
  mount: "mount",
  acdb: "acdb",
  dcdb: "dcdb",
  cable: "cable",
  battery: "battery",
} as const;
