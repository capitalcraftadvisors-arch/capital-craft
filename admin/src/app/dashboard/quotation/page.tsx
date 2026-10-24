"use client";

// EPC Quotation Builder — fill a short form, download a quotation in the EPC's
// own format (PDF on prod, .docx fallback). The heavy content/format lives in
// the stored template; this page only collects the ~dozen variable values.
// Bijlee Solar's template (their own PDF) has its own form; gozerobils
// (Sustera Ventures) builds its quotations in the portal's Customer applications.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { getToken } from "@/lib/auth";
import { fetchQuoteTemplate, type QuoteTemplate } from "@/lib/quotation-template";
import SearchableSelect from "@/components/quotation/SearchableSelect";
import {
  NAVY, input, inr, decimal, digits, useKeyNav, useBrandOptions, downloadQuotation, YesNo, Section, Field,
} from "@/components/quotation/form-kit";
import {
  MODULE_BRANDS, INVERTER_BRANDS, ROOF_TYPES, MOUNTS_BY_ROOF,
  ACDB_DCDB_OPTIONS, CABLE_OPTIONS, BATTERY_OPTIONS, SYSTEM_TYPES, BRAND_FIELDS, BIJLEE, SARVATRA,
} from "@/lib/quotation-brands";

function stateSubsidyFor(kw: number): number { if (!kw || kw <= 0) return 0; return kw >= 3 ? 78000 : Math.round(kw * 30000); }
function todayDDMMYYYY() { const d = new Date(); const p = (x: number) => String(x).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; }

type Form = {
  customer_name: string; pincode: string; city: string; address: string; date: string; quote_no: string;
  kw: string; system_type: string; battery: string; battery_unit: string; total: string;
  subsidised: boolean; central_subsidy: string;
  make_panel: string; make_inverter: string; roof_type: string; make_structure: string;
  make_acdb: string; make_dcdb: string; make_cable: string; make_battery: string;
};
const BATTERY_UNITS = ["V", "Ah", "kWh", "VAh"];
const EMPTY: Form = {
  customer_name: "", pincode: "", city: "", address: "", date: todayDDMMYYYY(), quote_no: "",
  kw: "", system_type: "Hybrid", battery: "", battery_unit: "V", total: "",
  subsidised: true, central_subsidy: "",
  make_panel: "", make_inverter: "", roof_type: "", make_structure: "",
  make_acdb: ACDB_DCDB_OPTIONS[0], make_dcdb: ACDB_DCDB_OPTIONS[0], make_cable: "Havells", make_battery: "",
};

export default function QuotationBuilderPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <Builder />
    </AuthGuard>
  );
}

// The EPC's template decides the form (read by the dashboard already — cached).
function Builder() {
  const router = useRouter();
  const [tpl, setTpl] = useState<QuoteTemplate | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => { fetchQuoteTemplate().then(setTpl, () => setFailed(true)); }, []);
  const customers = tpl?.storage_path === SARVATRA.key;
  useEffect(() => { if (customers) router.replace("/dashboard" as any); }, [customers, router]);
  if (failed) {
    return (
      <div className="min-h-screen bg-bg-soft">
        <BackHeader />
        <p className="max-w-[900px] mx-auto px-5 sm:px-7 py-8 text-[13px] text-red-600">Couldn&apos;t load the quotation builder. Please refresh.</p>
      </div>
    );
  }
  if (tpl === undefined || customers) return null;
  if (tpl?.storage_path === BIJLEE.key) return <BijleeForm serialNext={tpl.serial_next} />;
  return <Inner />;
}

// Generate the quotation and save it; resolves to the next suggested serial no.
// (PDF-template EPCs) or null.
function useQuotationDownload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(body: object): Promise<string | null> {
    setError(null);
    setBusy(true);
    try { return await downloadQuotation(body); }
    catch (e) { setError((e as Error)?.message || "Network error."); return null; }
    finally { setBusy(false); }
  }
  return { busy, error, setError, run };
}

function DownloadBar({ busy, error, onClick }: { busy: boolean; error: string | null; onClick: () => void }) {
  return (
    <>
      {error && <p className="text-[13px] text-red-600 mt-4">{error}</p>}
      <div className="mt-6">
        <button onClick={onClick} disabled={busy}
          className="px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
          {busy ? "Generating…" : "Download quotation"}
        </button>
      </div>
    </>
  );
}

function BackHeader() {
  const router = useRouter();
  return (
    <header className="border-b border-line bg-white">
      <div className="max-w-[900px] mx-auto px-5 sm:px-7 h-14 flex items-center">
        <button onClick={() => router.push("/dashboard" as any)} className="text-[13px] text-text-muted hover:text-text inline-flex items-center gap-1">← Back to dashboard</button>
      </div>
    </header>
  );
}

function Inner() {
  const [f, setF] = useState<Form>(EMPTY);
  const merge = useBrandOptions();
  const { busy, error, setError, run } = useQuotationDownload();
  const [pinBusy, setPinBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [dlOpen, setDlOpen] = useState(false);
  const dlRef = useRef<HTMLDivElement>(null);
  const set = (k: keyof Form, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (dlRef.current && !dlRef.current.contains(e.target as Node)) setDlOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const { formRef, onFormKey } = useKeyNav();

  // Pincode → city + a base address (editable), via the app's pincode lookup.
  async function resolvePincode(pin: string) {
    if (!/^\d{6}$/.test(pin)) return;
    setPinBusy(true);
    try {
      const res = await fetch(`/api/admin/pincode-lookup?pin=${pin}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      const j = await res.json().catch(() => ({}));
      if (j?.state) {
        const city = String(j.city || j.district || "");
        setF((p) => ({
          ...p,
          city,
          address: p.address || [j.district || j.city, j.state].filter(Boolean).join(", ") + ` - ${pin}`,
        }));
      }
    } catch { /* leave fields for manual entry */ }
    finally { setPinBusy(false); }
  }

  // One-photo auto-fill: OCR an uploaded image → pre-fill the form for review.
  const normType = (t: string) => { const v = (t || "").toLowerCase(); return v.includes("hybrid") ? "Hybrid" : v.includes("off") ? "Off-grid" : (v.includes("on") || v.includes("grid")) ? "On-grid" : ""; };
  async function onOcrFile(file: File) {
    setOcrBusy(true); setError(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/epc/quotation/ocr", { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't read the photo."); return; }
      const x = j.fields || {};
      setF((p) => ({
        ...p,
        customer_name: x.customer_name || p.customer_name,
        pincode: x.pincode || p.pincode,
        address: x.address || p.address,
        kw: x.kw ? String(x.kw).replace(/[^\d.]/g, "") : p.kw,
        system_type: normType(x.system_type) || p.system_type,
        total: x.total ? String(x.total).replace(/[^\d]/g, "") : p.total,
        central_subsidy: x.central_subsidy ? String(x.central_subsidy).replace(/[^\d]/g, "") : p.central_subsidy,
        make_panel: x.module_brand || p.make_panel,
        make_inverter: x.inverter_brand || p.make_inverter,
        battery: x.battery ? String(x.battery).replace(/[^\d.]/g, "") : p.battery,
      }));
      if (x.pincode && /^\d{6}$/.test(String(x.pincode))) void resolvePincode(String(x.pincode));
    } catch (e) { setError((e as Error)?.message || "Network error."); }
    finally { setOcrBusy(false); }
  }

  const hasBattery = f.system_type !== "On-grid";

  const kwNum = Number(f.kw) || 0;
  const totalNum = Number(f.total) || 0;
  const centralNum = f.subsidised ? Number(f.central_subsidy) || 0 : 0;
  const stateNum = f.subsidised ? stateSubsidyFor(kwNum) : 0;
  const finalNum = Math.max(0, totalNum - centralNum - stateNum);

  const mountOptions = useMemo(
    () => merge(f.roof_type ? MOUNTS_BY_ROOF[f.roof_type] || [] : [], BRAND_FIELDS.mount),
    [f.roof_type, merge],
  );

  async function download() {
    if (!f.customer_name.trim()) { setError("Customer name is required."); return; }
    if (kwNum <= 0) { setError("Enter the system size (kW)."); return; }
    await run({
      customer_name: f.customer_name, city: f.city, state: f.address, date: f.date, quote_no: f.quote_no,
      kw: kwNum, system_type: f.system_type, battery: hasBattery && f.battery ? `${f.battery} ${f.battery_unit}` : "",
      total: totalNum, subsidised: f.subsidised, central_subsidy: centralNum,
      make_panel: f.make_panel, make_inverter: f.make_inverter, make_structure: f.make_structure,
      make_acdb: f.make_acdb, make_dcdb: f.make_dcdb, make_cable: f.make_cable,
      make_battery: hasBattery ? f.make_battery : "",
    });
  }

  const lbl = "text-[12.5px] font-medium text-text-mid";

  return (
    <div className="min-h-screen bg-bg-soft">
      <BackHeader />

      <div className="max-w-[900px] mx-auto px-5 sm:px-7 py-8" ref={formRef} onKeyDown={onFormKey}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="font-display text-[24px] sm:text-[28px] font-bold text-text">Quotation builder</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Blank details form to write on (pen), print, photograph, and auto-fill */}
            <div className="relative" ref={dlRef}>
              <button type="button" onClick={() => setDlOpen((o) => !o)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13.5px] font-semibold border border-line bg-white text-text hover:border-[#1e3a8a]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download blank form
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {dlOpen && (
                <div className="absolute right-0 z-30 mt-1 w-40 bg-white border border-line rounded-xl shadow-lg overflow-hidden">
                  <a href="/quotation/quotation-details-form.pdf" download onClick={() => setDlOpen(false)}
                    className="block px-4 py-2.5 text-[13px] text-text hover:bg-[#f0f5fc]">PDF (for print)</a>
                  <a href="/quotation/quotation-details-form.docx" download onClick={() => setDlOpen(false)}
                    className="block px-4 py-2.5 text-[13px] text-text hover:bg-[#f0f5fc] border-t border-line">Word (editable)</a>
                </div>
              )}
            </div>
            {/* One-photo auto-fill */}
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-[13.5px] font-semibold cursor-pointer disabled:opacity-60" style={{ background: NAVY }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              {ocrBusy ? "Reading photo…" : "Auto-fill from a photo"}
              <input type="file" accept="image/*" className="hidden" disabled={ocrBusy}
                onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void onOcrFile(fl); e.currentTarget.value = ""; }} />
            </label>
          </div>
        </div>

        {/* Customer */}
        <Section title="Customer">
          <Field l="Customer name" req><input className={input} value={f.customer_name} onChange={(e) => set("customer_name", e.target.value)} placeholder="Full name" /></Field>
          <Field l={`Pincode${f.city ? ` · ${f.city}` : pinBusy ? " · looking up…" : ""}`}>
            <input className={input} inputMode="numeric" value={f.pincode}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); set("pincode", v); if (v.length === 6) void resolvePincode(v); }}
              placeholder="6-digit pincode" />
          </Field>
          <Field l="Address"><input className={input} value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Full installation address" /></Field>
          <Field l="Date"><input className={input} value={f.date} onChange={(e) => set("date", e.target.value)} placeholder="DD/MM/YYYY" /></Field>
          <Field l="Quotation no."><input className={input} value={f.quote_no} onChange={(e) => set("quote_no", e.target.value)} placeholder="e.g. GES/26-27/B/18" /></Field>
        </Section>

        {/* System */}
        <Section title="System">
          <Field l="System size (kW)" req><input className={input} inputMode="decimal" value={f.kw} onChange={(e) => set("kw", e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 3" /></Field>
          <Field l="System type">
            <select className={input} value={f.system_type} onChange={(e) => set("system_type", e.target.value)}>
              {SYSTEM_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          {hasBattery && (
            <Field l="Battery">
              <div className="flex gap-2">
                <input className={input} inputMode="decimal" value={f.battery} onChange={(e) => set("battery", e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 150" />
                <select className={input + " max-w-[100px]"} value={f.battery_unit} onChange={(e) => set("battery_unit", e.target.value)}>
                  {BATTERY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </Field>
          )}
        </Section>

        {/* Pricing + subsidy */}
        <Section title="Pricing & subsidy">
          <Field l="Total price (GST incl.) ₹" req><input className={input} inputMode="numeric" value={f.total} onChange={(e) => set("total", e.target.value.replace(/[^\d]/g, ""))} placeholder="e.g. 237000" /></Field>
          <Field l="Subsidised plan?"><YesNo value={f.subsidised} onChange={(v) => set("subsidised", v)} /></Field>
          {f.subsidised && (
            <>
              <Field l="Central subsidy ₹ (you enter)"><input className={input} inputMode="numeric" value={f.central_subsidy} onChange={(e) => set("central_subsidy", e.target.value.replace(/[^\d]/g, ""))} placeholder="e.g. 60000" /></Field>
              <Field l="State subsidy ₹ (auto by kW)"><input className={input + " bg-bg-soft"} readOnly value={inr(stateNum)} /></Field>
            </>
          )}
          <Field l="Final effective price ₹"><input className={input + " bg-bg-soft font-semibold"} readOnly value={inr(finalNum)} /></Field>
        </Section>

        {/* Bill of material */}
        <Section title="Bill of material">
          <SearchableSelect label="Solar module brand" value={f.make_panel} onChange={(v) => set("make_panel", v)} options={merge(MODULE_BRANDS, BRAND_FIELDS.module)} field={BRAND_FIELDS.module} />
          <SearchableSelect label="Inverter brand" value={f.make_inverter} onChange={(v) => set("make_inverter", v)} options={merge(INVERTER_BRANDS, BRAND_FIELDS.inverter)} field={BRAND_FIELDS.inverter} />
          <div className="flex flex-col gap-1">
            <span className={lbl}>Roof type</span>
            <select className={input} value={f.roof_type} onChange={(e) => { set("roof_type", e.target.value); set("make_structure", ""); }}>
              <option value="">Select roof type…</option>
              {ROOF_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {f.roof_type && <SearchableSelect label="Mounting structure" value={f.make_structure} onChange={(v) => set("make_structure", v)} options={mountOptions} field={BRAND_FIELDS.mount} />}
          <SearchableSelect label="ACDB" value={f.make_acdb} onChange={(v) => set("make_acdb", v)} options={merge(ACDB_DCDB_OPTIONS, BRAND_FIELDS.acdb)} field={BRAND_FIELDS.acdb} />
          <SearchableSelect label="DCDB" value={f.make_dcdb} onChange={(v) => set("make_dcdb", v)} options={merge(ACDB_DCDB_OPTIONS, BRAND_FIELDS.dcdb)} field={BRAND_FIELDS.dcdb} />
          <SearchableSelect label="Cables (AC & DC)" value={f.make_cable} onChange={(v) => set("make_cable", v)} options={merge(CABLE_OPTIONS, BRAND_FIELDS.cable)} field={BRAND_FIELDS.cable} />
          {hasBattery && <SearchableSelect label="Battery make" value={f.make_battery} onChange={(v) => set("make_battery", v)} options={merge(BATTERY_OPTIONS, BRAND_FIELDS.battery)} field={BRAND_FIELDS.battery} />}
        </Section>

        <DownloadBar busy={busy} error={error} onClick={() => void download()} />
      </div>
    </div>
  );
}

// Bijlee Solar — their own PDF; only these values change (date is automatic,
// serial no. auto-numbered, every other detail is their standard).
type BijleeFields = {
  customer_name: string; location: string; kw: string; serial: string;
  project_location: string; client_name: string; msedcl_division: string; contracted_demand: string;
  module_brand: string; inverter_brand: string; cable_brand: string;
  rate_per_kw: string; structure_rate_per_kw: string;
};

function BijleeForm({ serialNext }: { serialNext: number | null }) {
  const [f, setF] = useState<BijleeFields>({
    customer_name: "", location: "", kw: "", serial: serialNext ? BIJLEE.serial(serialNext) : "",
    project_location: "", client_name: "", msedcl_division: "", contracted_demand: "",
    module_brand: BIJLEE.module, inverter_brand: BIJLEE.inverter, cable_brand: BIJLEE.cable,
    rate_per_kw: "", structure_rate_per_kw: "",
  });
  const merge = useBrandOptions();
  const { formRef, onFormKey } = useKeyNav();
  const { busy, error, setError, run } = useQuotationDownload();
  const set = (k: keyof BijleeFields, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function download() {
    if (!f.customer_name.trim()) { setError("Customer name is required."); return; }
    if (!(Number(f.kw) > 0)) { setError("Enter the system size (kW)."); return; }
    if (!(Number(f.rate_per_kw) > 0)) { setError("Enter the price per kW."); return; }
    const next = await run({ ...f, kw: Number(f.kw), contracted_demand: f.contracted_demand || f.kw });
    if (next) set("serial", next);
  }

  return (
    <div className="min-h-screen bg-bg-soft">
      <BackHeader />
      <div className="max-w-[900px] mx-auto px-5 sm:px-7 py-8" ref={formRef} onKeyDown={onFormKey}>
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold text-text">Quotation builder</h1>

        <Section title="Customer">
          <Field l="Customer name" req><input className={input} value={f.customer_name} onChange={(e) => set("customer_name", e.target.value)} placeholder="Full name" /></Field>
          <Field l="Location"><input className={input} value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Koradi Nagpur" /></Field>
          <Field l="System size (kW)" req><input className={input} inputMode="decimal" value={f.kw} onChange={(e) => set("kw", decimal(e.target.value))} placeholder="e.g. 15" /></Field>
          <Field l="Serial no."><input className={input} value={f.serial} onChange={(e) => set("serial", e.target.value)} placeholder={BIJLEE.serial(1)} /></Field>
        </Section>

        <Section title="Site survey">
          <Field l="Project location"><input className={input} value={f.project_location} onChange={(e) => set("project_location", e.target.value)} placeholder="e.g. KORADI" /></Field>
          <Field l="Client name"><input className={input} value={f.client_name} onChange={(e) => set("client_name", e.target.value)} /></Field>
          <Field l="MSEDCL division"><input className={input} value={f.msedcl_division} onChange={(e) => set("msedcl_division", e.target.value)} /></Field>
          <Field l="Contracted demand (kW)"><input className={input} inputMode="decimal" value={f.contracted_demand} onChange={(e) => set("contracted_demand", decimal(e.target.value))} placeholder={f.kw || "e.g. 15"} /></Field>
        </Section>

        <Section title="Products">
          <SearchableSelect label="Solar module brand" value={f.module_brand} onChange={(v) => set("module_brand", v)} options={merge([BIJLEE.module, ...MODULE_BRANDS], BRAND_FIELDS.module)} field={BRAND_FIELDS.module} />
          <SearchableSelect label="Inverter brand" value={f.inverter_brand} onChange={(v) => set("inverter_brand", v)} options={merge([BIJLEE.inverter, ...INVERTER_BRANDS], BRAND_FIELDS.inverter)} field={BRAND_FIELDS.inverter} />
          <SearchableSelect label="Cable brand" value={f.cable_brand} onChange={(v) => set("cable_brand", v)} options={merge(CABLE_OPTIONS, BRAND_FIELDS.cable)} field={BRAND_FIELDS.cable} />
        </Section>

        <Section title="Cost">
          <Field l="Price per kW ₹" req><input className={input} inputMode="numeric" value={f.rate_per_kw} onChange={(e) => set("rate_per_kw", digits(e.target.value))} placeholder="e.g. 38000" /></Field>
          <Field l="Structure price per kW ₹"><input className={input} inputMode="numeric" value={f.structure_rate_per_kw} onChange={(e) => set("structure_rate_per_kw", digits(e.target.value))} placeholder="0" /></Field>
        </Section>

        <DownloadBar busy={busy} error={error} onClick={() => void download()} />
      </div>
    </div>
  );
}
