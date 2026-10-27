"use client";

// Customer applications — the gozerobils builder (Sustera Ventures). Every
// customer gets a quotation; the PCR and the customer agreement are made later,
// only for those who go ahead, each from a form pre-filled with what is already
// known. One saved record per customer (customer_quotations, migration 0102) —
// every form edits it, and each PDF is generated from it on download, dated
// when that document was first made. Tools → Edit (the forms, one tab per made
// document), Email (each made document, from Sustera's own Gmail) and WhatsApp
// (a ready message with the document's link; on phones the PDF itself via Share).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBusiness, getToken } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { INDIA_STATES } from "@/lib/india-states";
import { MODULE_BRANDS, INVERTER_BRANDS, BRAND_FIELDS, SARVATRA, sarvatraTerms } from "@/lib/quotation-brands";
import { EMAIL_RE } from "@/lib/validators";
import { waTel, waUrl, WA_LANGS, type WaLang } from "@/lib/wa-link";
import { ChipField } from "@/components/EmailComposerModal";
import SearchableSelect from "./SearchableSelect";
import {
  NAVY, input, inr, decimal, digits, useKeyNav, useBrandOptions, downloadQuotation, quotationFile, YesNo, Chips, Section, Field,
} from "./form-kit";

type Fields = {
  title: string; customer_name: string; contact: string; email: string; city: string; state: string;
  address: string; pincode: string; ebill_name: string; k_number: string; aen: string; sanctioned_load: string;
  spc_name: string; quote_no: string;
  kw: string; panel_brand: string; panel_type: string; panels: string; cell_type: string; dcr_type: string; wp: string;
  inverter_brand: string; inverter_kw: string; phase: string; inverter_type: string; inverter_location: string;
  connection_type: string; floors: string; solar_care: boolean; roof_type: string; structure_type: string;
  price: string; state_subsidy: string; central_subsidy: string; booking: string; design_payment: string;
  finance_by: string; payment_method: string; payment_mode: string;
  maintenance_plan: string; maintenance_others: string; site_readiness: string; bill_correction: string[];
};
type Doc = "quotation" | "pcr" | "agreement";
type Row = { id: string; data: Fields; created_at: string; pcr_at: string | null; agreement_at: string | null };
const COLS = "id, data, created_at, pcr_at, agreement_at";

const blank = (quote_no: string): Fields => ({
  title: SARVATRA.titles[0], customer_name: "", contact: "", email: "", city: "", state: "Rajasthan",
  address: "", pincode: "", ebill_name: "", k_number: "", aen: "", sanctioned_load: "", spc_name: "", quote_no,
  kw: "", panel_brand: SARVATRA.panel, panel_type: SARVATRA.panelType, panels: "", cell_type: SARVATRA.cellType,
  dcr_type: SARVATRA.dcrTypes[0], wp: SARVATRA.wp, inverter_brand: SARVATRA.inverter, inverter_kw: "",
  phase: SARVATRA.phases[0], inverter_type: SARVATRA.inverterTypes[0], inverter_location: SARVATRA.inverterLocations[0],
  connection_type: SARVATRA.connectionTypes[0], floors: "", solar_care: false,
  roof_type: SARVATRA.roofTypes[0], structure_type: SARVATRA.structureTypes[0],
  price: "", state_subsidy: "", central_subsidy: "", booking: "", design_payment: "",
  finance_by: "", payment_method: SARVATRA.paymentMethods[0], payment_mode: SARVATRA.paymentModes[0],
  maintenance_plan: "", maintenance_others: "NA", site_readiness: SARVATRA.siteReadiness[0], bill_correction: [],
});

// The three documents: label + the date each is made on (its date on the PDF).
// `save` names it on the form's save button.
const DOCS: { key: Doc; label: string; save: string; at: (r: Row) => string | null }[] = [
  { key: "quotation", label: "Quotation", save: "quotation", at: (r) => r.created_at },
  { key: "pcr", label: "PCR", save: "PCR", at: (r) => r.pcr_at },
  { key: "agreement", label: "Customer agreement", save: "agreement", at: (r) => r.agreement_at },
];
const docOf = (doc: Doc) => DOCS.find((d) => d.key === doc)!;

// Each form: its sections (fields in order) and what must be filled.
type Key = keyof Fields | "net" | "dispatch";
const FORMS: Record<Doc, { sections: [string, Key[]][]; required: (keyof Fields)[] }> = {
  quotation: {
    sections: [
      ["Customer", ["title", "customer_name", "contact", "city", "state", "quote_no"]],
      ["System", ["kw", "panel_brand", "panel_type", "panels", "dcr_type", "inverter_brand", "inverter_kw", "phase",
        "inverter_location", "connection_type", "floors", "solar_care", "roof_type", "structure_type"]],
      ["Price", ["price", "state_subsidy", "central_subsidy", "net"]],
      ["Payment milestones", ["booking", "design_payment", "dispatch"]],
    ],
    required: ["customer_name", "kw", "price"],
  },
  pcr: {
    sections: [
      ["Customer", ["title", "customer_name", "contact", "email", "ebill_name", "k_number", "address", "pincode",
        "city", "state", "sanctioned_load", "spc_name"]],
      ["Project", ["kw", "panel_brand", "panel_type", "panels", "cell_type", "dcr_type", "wp", "inverter_brand",
        "inverter_kw", "phase", "inverter_type", "structure_type", "floors"]],
      ["Booking", ["maintenance_plan", "maintenance_others", "site_readiness", "bill_correction"]],
      ["Payment", ["price", "booking", "finance_by", "payment_method", "payment_mode"]],
    ],
    required: ["customer_name", "contact", "ebill_name", "k_number", "address", "pincode", "city", "kw", "price"],
  },
  agreement: {
    sections: [
      ["Customer", ["title", "customer_name", "address", "city", "k_number", "aen"]],
      ["System", ["kw", "panel_brand", "panel_type", "panels", "wp", "dcr_type", "inverter_brand", "inverter_kw",
        "phase", "structure_type"]],
      ["Payment milestones", ["price", "booking", "design_payment", "dispatch"]],
    ],
    required: ["customer_name", "address", "city", "k_number", "aen", "kw", "price"],
  },
};

const LABEL: Record<Key, string> = {
  title: "Title", customer_name: "Customer name", contact: "Contact no.", email: "Email", city: "City", state: "State",
  address: "Address", pincode: "Pincode", ebill_name: "Name on electricity bill", k_number: "K number",
  aen: "AEN office", sanctioned_load: "Sanctioned load (kW)", spc_name: "SPC name", quote_no: "Quote no.",
  kw: "System size (kW)", panel_brand: "Solar panel brand", panel_type: "Panel type", panels: "No. of panels",
  cell_type: "Type of cell", dcr_type: "Panel category", wp: "Wp", inverter_brand: "Inverter brand", inverter_kw: "Inverter size (kW)",
  phase: "Phase", inverter_type: "Inverter type", inverter_location: "Inverter location",
  connection_type: "Connection type", floors: "No. of floors", solar_care: "GoZeroBils SolarCare™",
  roof_type: "Roof type", structure_type: "Structure type", price: "System price (GST incl.) ₹",
  state_subsidy: "State subsidy ₹", central_subsidy: "Central subsidy ₹", booking: "Booking amount ₹",
  design_payment: "On design approval ₹", dispatch: "Before material dispatch ₹", net: "Net effective price ₹", finance_by: "Finance by (bank / NBFC)", payment_method: "Mode of payment",
  payment_mode: "Payment mode", maintenance_plan: "Maintenance plan", maintenance_others: "Maintenance — others",
  site_readiness: "Site readiness", bill_correction: "Bill correction",
};
const PLACEHOLDER: Partial<Record<Key, string>> = {
  customer_name: "Full name", contact: "10-digit mobile", city: "e.g. Jaipur", aen: "e.g. B-IV_DURGAPURA",
  quote_no: SARVATRA.serial(1), price: "e.g. 300000", state_subsidy: "e.g. 17000",
};
const SELECTS: Partial<Record<Key, string[]>> = {
  title: SARVATRA.titles, state: INDIA_STATES, dcr_type: SARVATRA.dcrTypes, phase: SARVATRA.phases,
  inverter_type: SARVATRA.inverterTypes, site_readiness: SARVATRA.siteReadiness,
  payment_method: SARVATRA.paymentMethods, payment_mode: SARVATRA.paymentModes,
};
// Searchable dropdowns with "add custom": default options + saved-values key
// (no key = the custom value is used for this customer only).
const SEARCHABLE: Partial<Record<Key, [string[], string?]>> = {
  kw: [SARVATRA.kwOptions],
  panel_type: [SARVATRA.panelTypes],
  floors: [SARVATRA.floors],
  inverter_location: [SARVATRA.inverterLocations, BRAND_FIELDS.inverterLocation],
  connection_type: [SARVATRA.connectionTypes, BRAND_FIELDS.connectionType],
  roof_type: [SARVATRA.roofTypes, BRAND_FIELDS.roofType],
  structure_type: [SARVATRA.structureTypes, BRAND_FIELDS.structureType],
};
// One or more brands, kept as "Adani / Waaree" (printed as written).
const BRANDS: Partial<Record<Key, [string[], string]>> = {
  panel_brand: [[SARVATRA.panel, ...MODULE_BRANDS], BRAND_FIELDS.module],
  inverter_brand: [[SARVATRA.inverter, ...INVERTER_BRANDS], BRAND_FIELDS.inverter],
};
// Number-only fields: digits (max length, 0 = any) or decimals.
const DIGITS: Partial<Record<Key, number>> = {
  contact: 10, pincode: 6, price: 0, state_subsidy: 0, central_subsidy: 0, booking: 0, design_payment: 0, panels: 0,
};
const DECIMALS = new Set<Key>(["inverter_kw", "sanctioned_load"]);
const short = (k: Key) => LABEL[k].replace(/\s*(₹|\().*$/, "");

const fullName = (d: Fields) => `${d.title} ${d.customer_name}`.trim();
const TOOL = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-line text-[12px] font-semibold text-text-mid hover:border-[#1e3a8a] hover:text-[#1e3a8a]";
// A document's tab is open once that document is made (the quotation always is).
const made = (r: Row, doc: Doc) => !!docOf(doc).at(r);

// Rows read once per page load and kept current from this page's own saves.
let cache: { biz: string; rows: Row[] } | null = null;

// serialNext = the next suggested quote no.; onSerial moves it on (kept by the
// dashboard, so leaving and coming back keeps it).
export default function CustomerApplications({ serialNext, onSerial }: { serialNext: number | null; onSerial: (n: number) => void }) {
  const biz = getBusiness()?.id ?? "";
  const [rows, setRowsState] = useState<Row[] | null>(cache?.biz === biz ? cache.rows : null);
  const setRows = (fn: (r: Row[]) => Row[]) =>
    setRowsState((old) => { const next = fn(old ?? []); cache = { biz, rows: next }; return next; });
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(""); // row id + doc being downloaded
  const [ask, setAsk] = useState<{ row: Row; doc: Doc } | null>(null);
  const [form, setForm] = useState<{ doc: Doc; row: Row | null } | null>(null);
  const [mail, setMail] = useState<Row | null>(null);
  const [wa, setWa] = useState<Row | null>(null);

  useEffect(() => {
    if (rows) return;
    void supabase().from("customer_quotations").select(COLS).order("created_at", { ascending: false })
      .then(({ data, error: e }) => { if (e) setError(e.message); else setRows(() => (data ?? []) as unknown as Row[]); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function download(r: Row, doc: Doc) {
    setBusy(r.id + doc); setError(null);
    try { await downloadQuotation({ ...r.data, doc, date: docOf(doc).at(r) }); }
    catch (e) { setError((e as Error)?.message || "Network error."); }
    finally { setBusy(""); }
  }

  function saved(r: Row, doc: Doc) {
    setRows((old) => (old.some((x) => x.id === r.id) ? old.map((x) => (x.id === r.id ? r : x)) : [r, ...old]));
    const used = SARVATRA.serialNo(r.data.quote_no);
    if (!form?.row && used > 0) onSerial(used + 1); // the insert trigger moved it on
    setForm(null);
    void download(r, doc);
  }

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => (rows ?? []).filter((r) => !needle ||
    [fullName(r.data), r.data.contact, r.data.quote_no, r.data.city, r.data.address, r.data.k_number]
      .some((v) => (v || "").toLowerCase().includes(needle))), [rows, needle]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-[20px] font-bold text-[#0f3d2e]">Customer applications</h2>
        <button onClick={() => setForm({ doc: "quotation", row: null })} disabled={!rows}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white text-[13px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          Quotation builder
        </button>
      </div>

      <div className="flex items-center gap-2 max-w-[420px] bg-white border border-line rounded-xl px-3.5 h-11 focus-within:border-[#1e3a8a] focus-within:ring-2 focus-within:ring-[#1e3a8a]/15 transition">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, mobile, quote no. or site…" className="flex-1 min-w-0 bg-transparent text-[14px] text-text outline-none placeholder:text-text-muted" />
        {q && <button onClick={() => setQ("")} className="text-text-muted hover:text-text text-[15px] leading-none" aria-label="Clear">✕</button>}
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      <div className="bg-white rounded-2xl border border-line overflow-x-auto">
        <table className="w-full text-[13.5px] min-w-[1000px]">
          <thead className="bg-bg-soft border-b border-line">
            <tr className="text-left text-text-muted text-[12px]">
              <th className="px-4 py-3 font-medium">Name</th><th className="px-3 py-3 font-medium">Project</th>
              <th className="px-3 py-3 font-medium">Installation site</th><th className="px-3 py-3 font-medium">Created on</th>
              <th className="px-3 py-3 font-medium">Action</th><th className="px-3 py-3 font-medium">Tools</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? <tr><td colSpan={6} className="px-5 py-8 text-center text-text-muted">{error ? "—" : "Loading…"}</td></tr>
              : rows.length === 0 ? <tr><td colSpan={6} className="px-5 py-12 text-center text-text-muted">No quotations yet. Click <span className="text-text font-semibold">Quotation builder</span> to make one.</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={6} className="px-5 py-12 text-center text-text-muted">No customers match your search.</td></tr>
              : filtered.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 align-top">
                  <td className="px-4 py-3.5">
                    <div className="font-semibold text-text">{fullName(r.data)}</div>
                    {r.data.contact && <div className="text-[11.5px] text-text-muted mt-0.5">+91 {r.data.contact}</div>}
                  </td>
                  <td className="px-3 py-3.5 whitespace-nowrap">
                    <div className="font-semibold text-[#0f3d2e]">{r.data.kw} kW · ₹{inr(Number(r.data.price))}</div>
                    {r.data.quote_no && <div className="text-[11px] font-mono text-[#185fa5] mt-0.5">{r.data.quote_no}</div>}
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="text-text">{[r.data.city, r.data.state].filter(Boolean).join(", ") || "—"}</div>
                    {r.data.address && <div className="text-[11.5px] text-text-muted mt-0.5 max-w-[220px] truncate" title={r.data.address}>{r.data.address}</div>}
                  </td>
                  <td className="px-3 py-3.5 whitespace-nowrap text-text-mid">{fmtDateTime(r.created_at)}</td>
                  <td className="px-3 py-2.5">
                    {DOCS.map((d) => {
                      const done = !!d.at(r);
                      return (
                        <div key={d.key} className="flex items-center gap-2 py-0.5">
                          <button type="button" role="checkbox" aria-checked={done} aria-label={d.label} disabled={done}
                            onClick={() => setAsk({ row: r, doc: d.key })}
                            className={["w-[17px] h-[17px] rounded-[5px] grid place-items-center border shrink-0", done ? "border-transparent" : "border-[#b6bfc9] bg-white hover:border-[#1e3a8a]"].join(" ")}
                            style={done ? { background: NAVY } : undefined}>
                            {done && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>}
                          </button>
                          <span className={["text-[12.5px] w-[128px]", done ? "text-text font-medium" : "text-text-muted"].join(" ")}>{d.label}</span>
                          <button type="button" onClick={() => void download(r, d.key)} disabled={!done || !!busy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px] font-semibold border-[#1e3a8a] text-[#1e3a8a] hover:bg-[#1e3a8a]/[0.06] disabled:border-line disabled:text-text-muted disabled:hover:bg-transparent">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>
                            {busy === r.id + d.key ? "Downloading…" : "Download"}
                          </button>
                        </div>
                      );
                    })}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1.5">
                      <button type="button" onClick={() => setForm({ doc: "quotation", row: r })} className={TOOL}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                        Edit
                      </button>
                      <button type="button" onClick={() => setMail(r)} className={TOOL}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                        Email
                      </button>
                      <button type="button" onClick={() => setWa(r)} className={TOOL}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z" /></svg>
                        WhatsApp
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {ask && (
        <Confirm text={`Make the ${ask.doc === "pcr" ? "PCR" : "customer agreement"} for ${fullName(ask.row.data)}?`}
          onNo={() => setAsk(null)} onYes={() => { setForm({ doc: ask.doc, row: ask.row }); setAsk(null); }} />
      )}
      {form && (
        <CustomerForm doc={form.doc} row={form.row} quoteNo={serialNext ? SARVATRA.serial(serialNext) : ""}
          onClose={() => setForm(null)} onSaved={saved} />
      )}
      {mail && <QuotationEmail row={mail} onClose={() => setMail(null)} />}
      {wa && <QuotationWhatsApp row={wa} onClose={() => setWa(null)} />}
    </div>
  );
}

function Confirm({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-[400px]">
        <p className="text-[15px] font-semibold text-text">{text}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onNo} className="px-4 py-2 rounded-xl border border-line text-[13px] font-semibold text-text-mid">Cancel</button>
          <button onClick={onYes} autoFocus className="px-5 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY }}>Yes</button>
        </div>
      </div>
    </div>
  );
}

// One form for all three documents, over the customer's saved record (or a new
// one for a new quotation). An existing customer gets a tab per made document
// (plus the one being made). Saving stores every field, then downloads the PDF.
function CustomerForm({ doc: start, row, quoteNo, onClose, onSaved }: {
  doc: Doc; row: Row | null; quoteNo: string; onClose: () => void; onSaved: (r: Row, doc: Doc) => void;
}) {
  const [doc, setDoc] = useState<Doc>(start);
  const [f, setF] = useState<Fields>(() => ({ ...blank(quoteNo), ...row?.data }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const merge = useBrandOptions();
  const { formRef, onFormKey } = useKeyNav();
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((p) => ({ ...p, [k]: v }));
  const spec = FORMS[doc];
  const isNew = !row;

  const t = sarvatraTerms(f);
  const { kw, price } = t;
  // What each optional amount is when left blank (shown as its placeholder).
  const auto = sarvatraTerms({ ...f, panels: "", central_subsidy: "", booking: "", design_payment: "" });

  async function save() {
    const missing = spec.required.filter((k) => !String(f[k]).trim());
    if (missing.length) { setError(`Fill in: ${missing.map(short).join(", ")}.`); return; }
    if (kw <= 0) { setError("Enter the system size (kW)."); return; }
    if (price <= 0) { setError("Enter the system price."); return; }
    if (t.booking + t.design > price) { setError("Booking + design approval are more than the system price."); return; }
    setBusy(true); setError(null);
    const now = new Date().toISOString();
    const table = supabase().from("customer_quotations");
    const { data, error: e } = row
      ? await table.update({
          data: f,
          ...(doc === "pcr" && !row.pcr_at ? { pcr_at: now } : {}),
          ...(doc === "agreement" && !row.agreement_at ? { agreement_at: now } : {}),
        }).eq("id", row.id).select(COLS).single()
      : await table.insert({ data: f }).select(COLS).single();
    setBusy(false);
    if (e || !data) { setError(e?.message || "Couldn't save."); return; }
    onSaved(data as unknown as Row, doc);
  }

  function control(k: Key) {
    const req = (spec.required as Key[]).includes(k);
    if (k === "net" || k === "dispatch") {
      return <Field key={k} l={LABEL[k]}><input className={input + " bg-bg-soft font-semibold"} readOnly value={inr(t[k])} /></Field>;
    }
    if (k === "solar_care") return <Field key={k} l={LABEL[k]}><YesNo value={f.solar_care} onChange={(v) => set("solar_care", v)} /></Field>;
    if (k === "bill_correction") {
      return <Field key={k} l={LABEL[k]}><Chips options={SARVATRA.billCorrections} value={f.bill_correction} onChange={(v) => set("bill_correction", v)} /></Field>;
    }
    const value = f[k] as string;
    const brands = BRANDS[k];
    if (brands) {
      return <BrandList key={k} label={LABEL[k]} value={value} onChange={(v) => set(k, v)} options={merge(brands[0], brands[1])} field={brands[1]} />;
    }
    const search = SEARCHABLE[k];
    if (search) {
      // The panel type sets the watts printed on the PCR / agreement (and the panel count).
      const pick = k === "panel_type"
        ? (v: string) => { const w = SARVATRA.wattsOf(v); setF((p) => ({ ...p, panel_type: v, ...(w ? { wp: `${w}+Wp` } : {}) })); }
        : k === "kw" ? (v: string) => set("kw", decimal(v))
        : (v: string) => set(k, v);
      return <SearchableSelect key={k} label={LABEL[k]} value={value} onChange={pick} required={req} clearable={k === "floors"}
        options={search[1] ? merge(search[0], search[1]) : search[0]} field={search[1]} />;
    }
    const options = SELECTS[k];
    if (options || k === "maintenance_plan") {
      return (
        <Field key={k} l={LABEL[k]} req={req}>
          <select className={input} value={value} onChange={(e) => set(k, e.target.value)}>
            {k === "maintenance_plan" && <option value="">None</option>}
            {(options ?? SARVATRA.maintenancePlans).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      );
    }
    const max = DIGITS[k];
    const clean = (v: string) => (max !== undefined ? digits(v).slice(0, max || undefined) : DECIMALS.has(k) ? decimal(v) : v);
    const placeholder = k === "inverter_kw" ? f.kw || "e.g. 6"
      : k === "panels" ? (kw ? String(auto.panels) : "")
      : k === "central_subsidy" ? inr(auto.central)
      : k === "booking" ? inr(auto.booking)
      : k === "design_payment" ? inr(auto.design)
      : PLACEHOLDER[k];
    return (
      <Field key={k} l={LABEL[k]} req={req}>
        <input className={input} value={value} onChange={(e) => set(k, clean(e.target.value))} placeholder={placeholder}
          inputMode={max !== undefined ? "numeric" : DECIMALS.has(k) ? "decimal" : k === "email" ? "email" : undefined} />
      </Field>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto">
      <div className="max-w-[900px] mx-auto my-4 sm:my-10 px-4">
        <div className="bg-bg-soft rounded-2xl shadow-xl p-5 sm:p-7" ref={formRef} onKeyDown={onFormKey}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-[22px] sm:text-[26px] font-bold text-text">{isNew ? "Quotation builder" : fullName(row.data)}</h2>
            </div>
            <button onClick={onClose} aria-label="Close" className="w-9 h-9 grid place-items-center rounded-xl text-text-muted hover:text-text hover:bg-white text-[18px]">✕</button>
          </div>
          {row && <DocTabs active={doc} onPick={setDoc} open={(d) => made(row, d) || d === start} />}

          {spec.sections.map(([title, keys]) => <Section key={title} title={title}>{keys.map(control)}</Section>)}

          {error && <p className="text-[13px] text-red-600 mt-4">{error}</p>}
          <div className="mt-6 flex items-center gap-3">
            <button onClick={() => void save()} disabled={busy}
              className="px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
              {busy ? "Saving…" : isNew ? "Build quotation" : `Save & download ${docOf(doc).save}`}
            </button>
            <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-line bg-white text-[13.5px] font-semibold text-text-mid">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// One or more brands: pick / type to add, × to remove (never the last one). Stored as "A / B".
function BrandList({ label, value, onChange, options, field }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; field: string;
}) {
  const list = value.split(" / ").map((b) => b.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-1.5">
      <SearchableSelect label={label} value="" placeholder={list.length ? "Add another…" : "Search or type…"}
        options={options.filter((o) => !list.includes(o))} field={field}
        onChange={(v) => { if (v && !list.includes(v)) onChange([...list, v].join(" / ")); }} />
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((b) => (
            <span key={b} className="inline-flex items-center gap-1 text-[12.5px] rounded-full bg-[#eef2f7] text-[#1e3a8a] font-medium pl-2.5 pr-1 py-0.5">
              {b}
              {list.length > 1 && (
                <button type="button" onClick={() => onChange(list.filter((x) => x !== b).join(" / "))} aria-label={`Remove ${b}`}
                  className="text-[14px] leading-none text-text-muted hover:text-text px-0.5">×</button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Quotation / PCR / Customer agreement tabs; a document not made yet is locked.
function DocTabs({ active, onPick, open }: { active: Doc; onPick: (d: Doc) => void; open: (d: Doc) => boolean }) {
  return (
    <div className="mt-4 inline-flex rounded-xl border border-line bg-white p-1 gap-1">
      {DOCS.map((d) => {
        const on = active === d.key;
        return (
          <button key={d.key} type="button" disabled={!open(d.key)} onClick={() => onPick(d.key)}
            className={["inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-semibold disabled:text-text-muted disabled:cursor-not-allowed", on ? "text-white" : "text-text-mid hover:bg-bg-soft"].join(" ")}
            style={on ? { background: NAVY } : undefined}>
            {!open(d.key) && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>}
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

// The ready-written email for each document (everything stays editable).
function emailDraft(doc: Doc, d: Fields) {
  const system = `${d.kw} kWp rooftop solar system`;
  const body: Record<Doc, string> = {
    quotation: `Thank you for your interest in rooftop solar. Please find attached our quotation for your ${system}.`,
    pcr: `Thank you for confirming your project. Please find attached the Project Confirmation Receipt (PCR) for your ${system}.`,
    agreement: `Please find attached the customer agreement for your ${system}. Kindly review, sign and share a copy with us.`,
  };
  const subject: Record<Doc, string> = { quotation: "Quotation", pcr: "Project Confirmation Receipt", agreement: "Customer agreement" };
  return {
    to: d.email || "", cc: [] as string[], bcc: [] as string[],
    subject: `${subject[doc]} — ${d.quote_no || fullName(d)}`,
    message: `Dear ${fullName(d)},\n\n${body[doc]}\n\nRegards,\n${SARVATRA.senderName}`,
  };
}
type Draft = ReturnType<typeof emailDraft>;

// Email a customer's documents from Sustera's own Gmail: one tab per made
// document, each with its own ready-written (editable) email and the PDF attached.
function QuotationEmail({ row, onClose }: { row: Row; onClose: () => void }) {
  const [doc, setDoc] = useState<Doc>("quotation");
  const [drafts, setDrafts] = useState<Partial<Record<Doc, Draft>>>({});
  const [sent, setSent] = useState<Partial<Record<Doc, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = drafts[doc] ?? emailDraft(doc, row.data);
  const edit = (patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [doc]: { ...m, ...patch } }));
  const field = "mt-1 w-full rounded-input border border-line px-3 py-2.5 text-[14px] outline-none focus:border-[#1e3a8a]";

  async function send() {
    if (!EMAIL_RE.test(m.to.trim())) { setError("Enter a valid TO email."); return; }
    if (!m.subject.trim()) { setError("Enter a subject."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/epc/quotation/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ ...row.data, doc, date: docOf(doc).at(row), to: m.to.trim(), cc: m.cc, bcc: m.bcc, subject: m.subject.trim(), message: m.message }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't send the email."); return; }
      setSent((all) => ({ ...all, [doc]: `Sent to ${j.sent_to} with ${j.file}.` }));
    } catch (e) { setError((e as Error)?.message || "Network error."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto" onClick={busy ? undefined : onClose}>
      <div className="max-w-[640px] mx-auto my-4 sm:my-10 px-4" onClick={(e) => e.stopPropagation()}>
        <div className="bg-white rounded-2xl shadow-xl p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-[20px] font-bold text-text">Email</h2>
              <div className="text-[13px] text-text-muted mt-0.5">{fullName(row.data)} · From {SARVATRA.sender}</div>
            </div>
            <button onClick={onClose} aria-label="Close" className="w-9 h-9 grid place-items-center rounded-xl text-text-muted hover:text-text hover:bg-bg-soft text-[18px]">✕</button>
          </div>
          <DocTabs active={doc} onPick={(d) => { setDoc(d); setError(null); }} open={(d) => made(row, d)} />

          {sent[doc] ? (
            <div className="mt-5 space-y-4">
              <div className="p-3 rounded-input bg-[#e9f7f0] border border-[#cdeadd] text-[13px] text-[#0f3d2e]">✓ {sent[doc]}</div>
              <div className="flex justify-end"><button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY }}>Done</button></div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <label className="block text-[13px] font-medium text-text-mid">TO
                <input value={m.to} onChange={(e) => edit({ to: e.target.value })} inputMode="email" placeholder="customer@example.com" className={field} />
              </label>
              <ChipField key={doc + "-cc"} label="CC" values={m.cc} onChange={(cc) => edit({ cc })} />
              <ChipField key={doc + "-bcc"} label="BCC" values={m.bcc} onChange={(bcc) => edit({ bcc })} />
              <label className="block text-[13px] font-medium text-text-mid">Subject
                <input value={m.subject} onChange={(e) => edit({ subject: e.target.value })} className={field} />
              </label>
              <label className="block text-[13px] font-medium text-text-mid">Message
                <textarea value={m.message} onChange={(e) => edit({ message: e.target.value })} rows={9} className={field + " resize-y leading-relaxed"} />
              </label>
              <div className="text-[12.5px] text-text-muted">Attached: {docOf(doc).label} (PDF)</div>
              {error && <div className="p-2.5 rounded-input bg-red-50 border border-red-200 text-[12px] text-red-700">{error}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl border border-line text-[13px] font-semibold text-text-mid disabled:opacity-60">Cancel</button>
                <button type="button" onClick={() => void send()} disabled={busy} className="px-5 py-2 rounded-xl text-white text-[13px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>{busy ? "Sending…" : "Send"}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The ready-written WhatsApp message for a document, in English / Hinglish / Hindi.
function waDraft(doc: Doc, d: Fields, lang: WaLang): string {
  const kw = `${d.kw} kWp`;
  const name = d.customer_name || fullName(d);
  const body: Record<WaLang, Record<Doc, string>> = {
    en: {
      quotation: `Thank you for your interest in rooftop solar. Here is our quotation for your ${kw} system.`,
      pcr: `Thank you for confirming your project. Here is your Project Confirmation Receipt (PCR) for the ${kw} system.`,
      agreement: `Here is the customer agreement for your ${kw} rooftop solar project. Please review, sign and share a copy with us.`,
    },
    hinglish: {
      quotation: `Rooftop solar mein interest dikhane ke liye dhanyavaad. Aapke ${kw} system ka quotation yeh raha.`,
      pcr: `Project confirm karne ke liye dhanyavaad. Aapke ${kw} system ki Project Confirmation Receipt (PCR) yeh rahi.`,
      agreement: `Aapke ${kw} rooftop solar project ka customer agreement yeh raha. Kripya padh kar sign karein aur ek copy humein bhej dein.`,
    },
    hi: {
      quotation: `रूफटॉप सोलर में रुचि दिखाने के लिए धन्यवाद। आपके ${kw} सिस्टम का कोटेशन यह रहा।`,
      pcr: `प्रोजेक्ट कन्फर्म करने के लिए धन्यवाद। आपके ${kw} सिस्टम की प्रोजेक्ट कन्फर्मेशन रसीद (PCR) यह रही।`,
      agreement: `आपके ${kw} रूफटॉप सोलर प्रोजेक्ट का कस्टमर एग्रीमेंट यह रहा। कृपया पढ़कर साइन करें और एक कॉपी हमें भेज दें।`,
    },
  };
  const greet: Record<WaLang, string> = { en: `Hello ${fullName(d)},`, hinglish: `Namaste ${name} ji,`, hi: `नमस्ते ${name} जी,` };
  return `${greet[lang]}\n\n${body[lang][doc]}\n\n— ${SARVATRA.senderName}`;
}

// The phone's share menu can take a PDF (most phones; not most laptops).
const canSharePdf = () => {
  try { return !!navigator.canShare?.({ files: [new File([""], "x.pdf", { type: "application/pdf" })] }); } catch { return false; }
};

// WhatsApp a customer's documents from the sender's own WhatsApp (as in My Day):
// one tab per made document, a ready message (English / Hinglish / Hindi) — Send
// adds the PDF's link; on a phone, Share PDF attaches the file itself.
function QuotationWhatsApp({ row, onClose }: { row: Row; onClose: () => void }) {
  const [doc, setDoc] = useState<Doc>("quotation");
  const [lang, setLang] = useState<WaLang>("hi");
  const [to, setTo] = useState(waTel(row.data.contact));
  const [msg, setMsg] = useState("");
  const [files, setFiles] = useState<Partial<Record<Doc, File>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share] = useState(canSharePdf);
  useEffect(() => { setMsg(waDraft(doc, row.data, lang)); setError(null); }, [doc, lang, row.data]);
  const body = { ...row.data, doc, date: docOf(doc).at(row) };

  async function send() {
    const ten = waTel(to);
    if (!ten) return;
    // Open the tab now (while the click counts); it goes to WhatsApp once the link is ready.
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/epc/quotation/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Couldn't make the document link.");
      const href = waUrl(ten, `${msg}\n\n📄 ${j.url}`);
      if (win) win.location.href = href; else window.location.href = href;
      onClose();
    } catch (e) {
      win?.close();
      setError((e as Error)?.message || "Network error.");
    } finally { setBusy(false); }
  }

  async function sharePdf() {
    setError(null);
    try {
      let file = files[doc];
      if (!file) {
        setBusy(true);
        file = await quotationFile(body);
        setFiles((all) => ({ ...all, [doc]: file }));
        setBusy(false);
      }
      await navigator.share({ files: [file], text: msg });
    } catch (e) {
      setBusy(false);
      const name = (e as Error)?.name;
      if (name === "AbortError") return; // share menu closed
      // Making the PDF took longer than the tap counts for — the file is ready now.
      setError(name === "NotAllowedError" ? "Tap Share PDF again." : (e as Error)?.message || "Couldn't share.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[15px] font-bold text-text">Send WhatsApp</div>
            <div className="text-[12px] text-text-muted">{fullName(row.data)}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[18px] text-text-muted hover:text-text leading-none p-1">✕</button>
        </div>
        <DocTabs active={doc} onPick={setDoc} open={(d) => made(row, d)} />

        <div className="flex items-center gap-2 mt-4 mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-mid">Language</span>
          <div className="inline-flex border border-line rounded-lg overflow-hidden">
            {WA_LANGS.map((l) => (
              <button key={l.key} type="button" onClick={() => setLang(l.key)}
                className={["px-2.5 py-1 text-[12px] font-semibold border-r border-line last:border-r-0", lang === l.key ? "bg-[#128C7E] text-white" : "text-text-mid bg-white hover:bg-bg-tint"].join(" ")}>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-mid">Send to</div>
        <div className="flex items-center gap-2 mt-1 mb-3">
          <span className="text-[13px] text-text-muted">+91</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" placeholder="10-digit number"
            className="flex-1 border border-line rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#128C7E]" />
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-mid">Message preview</div>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={8}
          className="w-full mt-1 border border-line rounded-lg px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-[#128C7E] resize-none" />
        <div className="text-[11.5px] text-text-muted mt-1">📄 {docOf(doc).label} link is added on send</div>

        {error && <div className="mt-3 p-2.5 rounded-input bg-red-50 border border-red-200 text-[12px] text-red-700">{error}</div>}
        <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
          <span className="text-[11px] text-text-muted">Sent from your WhatsApp</span>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={onClose} disabled={busy} className="text-[12px] font-semibold px-3.5 py-2 rounded-lg border border-line text-text-mid hover:bg-bg-tint disabled:opacity-50">Cancel</button>
            {share && (
              <button type="button" onClick={() => void sharePdf()} disabled={busy}
                className="text-[12px] font-semibold px-3.5 py-2 rounded-lg border border-[#128C7E] text-[#128C7E] hover:bg-[#128C7E]/[0.06] disabled:opacity-50">
                Share PDF
              </button>
            )}
            <button type="button" onClick={() => void send()} disabled={busy || !waTel(to)}
              className="text-[12px] font-semibold px-4 py-2 rounded-lg bg-[#128C7E] text-white hover:bg-[#0f766e] disabled:opacity-50">
              {busy ? "Preparing…" : "Send on WhatsApp →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

