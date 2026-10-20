// Quotation builder — fills an EPC's Word (.docx) template with the form values
// and returns the finished document. The template keeps the EPC's exact format
// (logo, headers, all static content); only the placeholders are swapped.
//
// First template = GHANPRIYA ENERGY SOLUTION, bundled at
// public/quotation/ges-template.docx. Later templates can live in GCS, keyed by
// epc_quotation_templates.storage_path.

import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { downloadBuffer } from "./gcs";

export type QuotationInput = {
  customer_name: string;
  city: string;
  state: string;
  date?: string;            // DD/MM/YYYY — defaults to today
  quote_no: string;
  kw: number | string;
  system_type: string;      // Hybrid / On-grid / Off-grid
  battery?: string;         // voltage / capacity, blank for on-grid
  total: number;            // plant price (GST incl.)
  subsidised: boolean;
  central_subsidy?: number;  // typed by the EPC when subsidised
  // Bill of material — selected makes.
  make_panel: string;
  make_inverter: string;
  make_structure: string;
  make_acdb?: string;
  make_dcdb?: string;
  make_cable?: string;
  make_battery?: string;
};

// Indian-format rupees without the ₹ sign (the template already has ₹).
export function inr(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

export function todayDDMMYYYY(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// State subsidy by system size: 1 kW ₹30,000 · 2 kW ₹60,000 · 3 kW+ ₹78,000 (capped).
export function stateSubsidyFor(kw: number): number {
  if (!kw || kw <= 0) return 0;
  if (kw >= 3) return 78000;
  return Math.round(kw * 30000);
}

// EPCs' own PDF templates (bundled:<key>) hold a real customer's sample values, so
// they live only in the private bucket (templates/<file>) — never in the public repo,
// the image or public/. A local copy in admin/templates (gitignored) is used when
// present (localhost). Loaded once per server instance.
const PRIVATE_TEMPLATES: Record<string, string> = {
  "bundled:bijlee": "bijlee-template.pdf",
  "bundled:sarvatra": "sarvatra-template.pdf",
  "bundled:sarvatra-pcr": "sarvatra-pcr.pdf",
  "bundled:sarvatra-agreement": "sarvatra-agreement.pdf",
};
const loaded = new Map<string, Buffer>();

// Build the docxtemplater data object (computes subsidy + final price + display).
export function buildQuotationData(input: QuotationInput) {
  const kwNum = Number(input.kw) || 0;
  const total = Number(input.total) || 0;
  const central = input.subsidised ? (Number(input.central_subsidy) || 0) : 0;
  const state = input.subsidised ? stateSubsidyFor(kwNum) : 0;
  const final = Math.max(0, total - central - state);

  const subsidyDisplay = input.subsidised
    ? `${inr(central)} (Central) + ₹${inr(state)} (State)`
    : "Not availed";

  return {
    customer_name: input.customer_name || "",
    city: input.city || "",
    state: input.state || "",
    date: input.date || todayDDMMYYYY(),
    quote_no: input.quote_no || "",
    kw: String(kwNum || input.kw || ""),
    system_type: input.system_type || "",
    battery: input.battery || "NA",
    total: inr(total),
    central_subsidy: subsidyDisplay,
    final_price: inr(final),
    make_panel: input.make_panel || "",
    make_inverter: input.make_inverter || "",
    make_structure: input.make_structure || "",
    make_acdb: input.make_acdb || "MNRE Standard Equivalent",
    make_dcdb: input.make_dcdb || "MNRE Standard Equivalent",
    make_cable: input.make_cable || "Havells",
    make_battery: input.make_battery || "NA",
    // computed figures (for the caller / activity log)
    _state_subsidy: state,
    _final: final,
  };
}

// Fill a template buffer with the data → finished .docx buffer.
export function fillTemplate(templateBuf: Buffer, data: Record<string, unknown>): Buffer {
  const zip = new PizZip(templateBuf);
  const dt = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  dt.render(data);
  return dt.getZip().generate({ type: "nodebuffer" });
}

// "bundled:ges" → the GHANPRIYA .docx shipped in public/quotation; the PDF templates
// above → private bucket (or the local copy).
export async function readBundledTemplate(key: string): Promise<Buffer> {
  if (key === "bundled:ges") return fs.readFileSync(path.join(process.cwd(), "public", "quotation", "ges-template.docx"));
  const file = PRIVATE_TEMPLATES[key];
  if (!file) throw new Error("Unknown bundled template: " + key);
  const hit = loaded.get(file);
  if (hit) return hit;
  const local = path.join(process.cwd(), "templates", file);
  const buf = fs.existsSync(local) ? fs.readFileSync(local) : await downloadBuffer(`templates/${file}`);
  loaded.set(file, buf);
  return buf;
}
