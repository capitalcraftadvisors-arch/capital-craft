"use client";

// Customer applications — the gozerobils builder (Sustera Ventures). Every
// customer gets a quotation; the PCR and the customer agreement are made later,
// only for those who go ahead, each from a form pre-filled with what is already
// known. One saved record per customer (customer_quotations, migration 0102) —
// every form edits it, and each PDF is generated from it on download, dated
// when that document was first made.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBusiness } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { centralSubsidyFor } from "@/lib/emi";
import { INDIA_STATES } from "@/lib/india-states";
import { MODULE_BRANDS, INVERTER_BRANDS, BRAND_FIELDS, SARVATRA } from "@/lib/quotation-brands";
import SearchableSelect from "./SearchableSelect";
import {
  NAVY, input, inr, decimal, digits, useKeyNav, useBrandOptions, downloadQuotation, YesNo, Chips, Section, Field,
} from "./form-kit";

type Fields = {
  title: string; customer_name: string; contact: string; email: string; city: string; state: string;
  address: string; pincode: string; ebill_name: string; k_number: string; aen: string; sanctioned_load: string;
  spc_name: string; quote_no: string;
  kw: string; panel_brand: string; panel_type: string; cell_type: string; dcr_type: string; wp: string;
  inverter_brand: string; inverter_kw: string; phase: string; inverter_type: string; inverter_location: string;
  connection_type: string; floors: string; solar_care: boolean; roof_type: string; structure_type: string;
  price: string; state_subsidy: string; design_payment: string;
  finance_by: string; payment_method: string; payment_mode: string;
  maintenance_plan: string; maintenance_others: string; site_readiness: string; bill_correction: string[];
};
type Doc = "quotation" | "pcr" | "agreement";
type Row = { id: string; data: Fields; created_at: string; pcr_at: string | null; agreement_at: string | null };
const COLS = "id, data, created_at, pcr_at, agreement_at";

const blank = (quote_no: string): Fields => ({
  title: SARVATRA.titles[0], customer_name: "", contact: "", email: "", city: "", state: "Rajasthan",
  address: "", pincode: "", ebill_name: "", k_number: "", aen: "", sanctioned_load: "", spc_name: "", quote_no,
  kw: "", panel_brand: SARVATRA.panel, panel_type: SARVATRA.panelType, cell_type: SARVATRA.cellType,
  dcr_type: SARVATRA.dcrTypes[0], wp: SARVATRA.wp, inverter_brand: SARVATRA.inverter, inverter_kw: "",
  phase: SARVATRA.phases[0], inverter_type: SARVATRA.inverterTypes[0], inverter_location: SARVATRA.inverterLocations[0],
  connection_type: SARVATRA.connectionTypes[0], floors: "", solar_care: false,
  roof_type: SARVATRA.roofTypes[0], structure_type: SARVATRA.structureTypes[0],
  price: "", state_subsidy: "", design_payment: "",
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
type Key = keyof Fields | "central" | "net";
const FORMS: Record<Doc, { sections: [string, Key[]][]; required: (keyof Fields)[] }> = {
  quotation: {
    sections: [
      ["Customer", ["title", "customer_name", "contact", "city", "state", "quote_no"]],
      ["System", ["kw", "panel_brand", "panel_type", "inverter_brand", "inverter_kw", "phase", "inverter_location",
        "connection_type", "floors", "solar_care", "roof_type", "structure_type"]],
      ["Price", ["price", "state_subsidy", "central", "design_payment", "net"]],
    ],
    required: ["customer_name", "kw", "price"],
  },
  pcr: {
    sections: [
      ["Customer", ["title", "customer_name", "contact", "email", "ebill_name", "k_number", "address", "pincode",
        "city", "state", "sanctioned_load", "spc_name"]],
      ["Project", ["kw", "panel_brand", "cell_type", "dcr_type", "wp", "inverter_brand", "inverter_kw", "phase",
        "inverter_type", "structure_type", "floors"]],
      ["Booking", ["maintenance_plan", "maintenance_others", "site_readiness", "bill_correction"]],
      ["Payment", ["price", "finance_by", "payment_method", "payment_mode"]],
    ],
    required: ["customer_name", "contact", "ebill_name", "k_number", "address", "pincode", "city", "kw", "price"],
  },
  agreement: {
    sections: [
      ["Customer", ["title", "customer_name", "address", "city", "k_number", "aen"]],
      ["System", ["kw", "panel_brand", "wp", "dcr_type", "inverter_brand", "inverter_kw", "phase", "structure_type"]],
      ["Price", ["price", "design_payment"]],
    ],
    required: ["customer_name", "address", "city", "k_number", "aen", "kw", "price"],
  },
};

const LABEL: Record<Key, string> = {
  title: "Title", customer_name: "Customer name", contact: "Contact no.", email: "Email", city: "City", state: "State",
  address: "Address", pincode: "Pincode", ebill_name: "Name on electricity bill", k_number: "K number",
  aen: "AEN office", sanctioned_load: "Sanctioned load (kW)", spc_name: "SPC name", quote_no: "Quote no.",
  kw: "System size (kW)", panel_brand: "Solar panel brand", panel_type: "Panel type", cell_type: "Type of cell",
  dcr_type: "DCR / NDCR", wp: "Wp", inverter_brand: "Inverter brand", inverter_kw: "Inverter size (kW)",
  phase: "Phase", inverter_type: "Inverter type", inverter_location: "Inverter location",
  connection_type: "Connection type", floors: "No. of floors", solar_care: "GoZeroBils SolarCare™",
  roof_type: "Roof type", structure_type: "Structure type", price: "System price (GST incl.) ₹",
  state_subsidy: "State subsidy ₹", central: "Central subsidy ₹ (auto by kW)", design_payment: "On design approval ₹",
  net: "Net effective price ₹", finance_by: "Finance by (bank / NBFC)", payment_method: "Mode of payment",
  payment_mode: "Payment mode", maintenance_plan: "Maintenance plan", maintenance_others: "Maintenance — others",
  site_readiness: "Site readiness", bill_correction: "Bill correction",
};
const PLACEHOLDER: Partial<Record<Key, string>> = {
  customer_name: "Full name", contact: "10-digit mobile", city: "e.g. Jaipur", aen: "e.g. B-IV_DURGAPURA",
  quote_no: SARVATRA.serial(1), kw: "e.g. 6", floors: "e.g. G+2", price: "e.g. 300000", state_subsidy: "e.g. 17000",
};
const SELECTS: Partial<Record<Key, string[]>> = {
  title: SARVATRA.titles, state: INDIA_STATES, dcr_type: SARVATRA.dcrTypes, phase: SARVATRA.phases,
  inverter_type: SARVATRA.inverterTypes, site_readiness: SARVATRA.siteReadiness,
  payment_method: SARVATRA.paymentMethods, payment_mode: SARVATRA.paymentModes,
};
// Searchable dropdowns with "add custom": default options + saved-values key.
const SEARCHABLE: Partial<Record<Key, [string[], string]>> = {
  panel_brand: [[SARVATRA.panel, ...MODULE_BRANDS], BRAND_FIELDS.module],
  inverter_brand: [[SARVATRA.inverter, ...INVERTER_BRANDS], BRAND_FIELDS.inverter],
  inverter_location: [SARVATRA.inverterLocations, BRAND_FIELDS.inverterLocation],
  connection_type: [SARVATRA.connectionTypes, BRAND_FIELDS.connectionType],
  roof_type: [SARVATRA.roofTypes, BRAND_FIELDS.roofType],
  structure_type: [SARVATRA.structureTypes, BRAND_FIELDS.structureType],
};
// Number-only fields: digits (max length, 0 = any) or decimals.
const DIGITS: Partial<Record<Key, number>> = { contact: 10, pincode: 6, price: 0, state_subsidy: 0, design_payment: 0 };
const DECIMALS = new Set<Key>(["kw", "inverter_kw", "sanctioned_load"]);
const short = (k: Key) => LABEL[k].replace(/\s*(₹|\().*$/, "");

const fullName = (d: Fields) => `${d.title} ${d.customer_name}`.trim();

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
        <table className="w-full text-[13.5px] min-w-[880px]">
          <thead className="bg-bg-soft border-b border-line">
            <tr className="text-left text-text-muted text-[12px]">
              <th className="px-4 py-3 font-medium">Name</th><th className="px-3 py-3 font-medium">Project</th>
              <th className="px-3 py-3 font-medium">Installation site</th><th className="px-3 py-3 font-medium">Created on</th>
              <th className="px-3 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? <tr><td colSpan={5} className="px-5 py-8 text-center text-text-muted">{error ? "—" : "Loading…"}</td></tr>
              : rows.length === 0 ? <tr><td colSpan={5} className="px-5 py-12 text-center text-text-muted">No quotations yet. Click <span className="text-text font-semibold">Quotation builder</span> to make one.</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={5} className="px-5 py-12 text-center text-text-muted">No customers match your search.</td></tr>
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
                          <button type="button" onClick={() => setForm({ doc: d.key, row: r })} disabled={!done} aria-label={`Edit ${d.label}`}
                            className="w-7 h-7 grid place-items-center rounded-lg text-text-muted hover:text-[#1e3a8a] hover:bg-[#1e3a8a]/[0.06] disabled:invisible">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                          </button>
                          <button type="button" onClick={() => void download(r, d.key)} disabled={!done || !!busy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px] font-semibold border-[#1e3a8a] text-[#1e3a8a] hover:bg-[#1e3a8a]/[0.06] disabled:border-line disabled:text-text-muted disabled:hover:bg-transparent">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>
                            {busy === r.id + d.key ? "Downloading…" : "Download"}
                          </button>
                        </div>
                      );
                    })}
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
          onClose={() => setForm(null)} onSaved={(r) => saved(r, form.doc)} />
      )}
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
// one for a new quotation). Saving stores every field, then downloads the PDF.
function CustomerForm({ doc, row, quoteNo, onClose, onSaved }: {
  doc: Doc; row: Row | null; quoteNo: string; onClose: () => void; onSaved: (r: Row) => void;
}) {
  const [f, setF] = useState<Fields>(() => ({ ...blank(quoteNo), ...row?.data }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const merge = useBrandOptions();
  const { formRef, onFormKey } = useKeyNav();
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((p) => ({ ...p, [k]: v }));
  const spec = FORMS[doc];
  const isNew = !row;

  const kw = Number(f.kw) || 0;
  const price = Number(f.price) || 0;
  const central = centralSubsidyFor(kw, SARVATRA.commercial(f.connection_type));
  const designAuto = Math.round(price * SARVATRA.designShare);

  async function save() {
    const missing = spec.required.filter((k) => !String(f[k]).trim());
    if (missing.length) { setError(`Fill in: ${missing.map(short).join(", ")}.`); return; }
    if (kw <= 0) { setError("Enter the system size (kW)."); return; }
    if (price <= 0) { setError("Enter the system price."); return; }
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
    onSaved(data as unknown as Row);
  }

  function control(k: Key) {
    const req = (spec.required as Key[]).includes(k);
    if (k === "central") return <Field key={k} l={LABEL[k]}><input className={input + " bg-bg-soft"} readOnly value={inr(central)} /></Field>;
    if (k === "net") {
      const net = Math.max(0, price - central - (Number(f.state_subsidy) || 0));
      return <Field key={k} l={LABEL[k]}><input className={input + " bg-bg-soft font-semibold"} readOnly value={inr(net)} /></Field>;
    }
    if (k === "solar_care") return <Field key={k} l={LABEL[k]}><YesNo value={f.solar_care} onChange={(v) => set("solar_care", v)} /></Field>;
    if (k === "bill_correction") {
      return <Field key={k} l={LABEL[k]}><Chips options={SARVATRA.billCorrections} value={f.bill_correction} onChange={(v) => set("bill_correction", v)} /></Field>;
    }
    const value = f[k] as string;
    const search = SEARCHABLE[k];
    if (search) {
      return <SearchableSelect key={k} label={LABEL[k]} value={value} onChange={(v) => set(k, v)}
        options={merge(search[0], search[1])} field={search[1]} required={req} />;
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
    const placeholder = k === "inverter_kw" ? f.kw || "e.g. 6" : k === "design_payment" ? inr(designAuto) : PLACEHOLDER[k];
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
              <h2 className="font-display text-[22px] sm:text-[26px] font-bold text-text">{isNew ? "Quotation builder" : docOf(doc).label}</h2>
              {row && <div className="text-[13px] text-text-muted mt-0.5">{fullName(row.data)}</div>}
            </div>
            <button onClick={onClose} aria-label="Close" className="w-9 h-9 grid place-items-center rounded-xl text-text-muted hover:text-text hover:bg-white text-[18px]">✕</button>
          </div>

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
