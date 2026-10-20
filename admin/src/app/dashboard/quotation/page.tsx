"use client";

// EPC Quotation Builder — fill a short form, download a quotation in the EPC's
// own format (PDF on prod, .docx fallback). The heavy content/format lives in
// the stored template; this page only collects the ~dozen variable values.
// Bijlee Solar's and Sarvatra Energy's templates (their own PDFs) have their own
// forms; Sarvatra's one form makes their quotation and PCR together.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { getToken } from "@/lib/auth";
import { fetchQuoteTemplate, type QuoteTemplate } from "@/lib/quotation-template";
import { centralSubsidyFor } from "@/lib/emi";
import { INDIA_STATES } from "@/lib/india-states";
import { supabase } from "@/lib/supabase";
import { LENDER_LABEL, type LenderKey } from "@/lib/lender-summary";
import SearchableSelect from "@/components/quotation/SearchableSelect";
import {
  MODULE_BRANDS, INVERTER_BRANDS, ROOF_TYPES, MOUNTS_BY_ROOF,
  ACDB_DCDB_OPTIONS, CABLE_OPTIONS, BATTERY_OPTIONS, SYSTEM_TYPES, BRAND_FIELDS, BIJLEE, SARVATRA,
} from "@/lib/quotation-brands";

const NAVY = "#1e3a8a";
const input = "w-full border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none focus:border-[#1e3a8a]";
const inr = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-IN") : "0");
const decimal = (v: string) => v.replace(/[^\d.]/g, "");
const digits = (v: string) => v.replace(/\D/g, "");
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
  const [tpl, setTpl] = useState<QuoteTemplate | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => { fetchQuoteTemplate().then(setTpl, () => setFailed(true)); }, []);
  if (failed) {
    return (
      <div className="min-h-screen bg-bg-soft">
        <BackHeader />
        <p className="max-w-[900px] mx-auto px-5 sm:px-7 py-8 text-[13px] text-red-600">Couldn&apos;t load the quotation builder. Please refresh.</p>
      </div>
    );
  }
  if (tpl === undefined) return null;
  if (tpl?.storage_path === BIJLEE.key) return <BijleeForm serialNext={tpl.serial_next} />;
  if (tpl?.storage_path === SARVATRA.key) return <SarvatraForm serialNext={tpl.serial_next} />;
  return <Inner />;
}

// Keyboard navigation: Enter / ↓ / → (at caret end) → next field; ↑ / ← (at
// caret start) → previous. Works alongside mouse. Native <select> keeps ↑/↓ for
// its options; custom dropdowns (buttons) handle their own keys.
function useKeyNav() {
  const formRef = useRef<HTMLDivElement>(null);
  function fieldList(): HTMLElement[] {
    const root = formRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("input:not([type=file]), select, textarea, [data-qnav]"))
      .filter((el) => !(el as HTMLInputElement).disabled && el.offsetParent !== null);
  }
  function moveFocus(from: HTMLElement, dir: 1 | -1) {
    const list = fieldList();
    const i = list.indexOf(from);
    if (i < 0) return;
    const to = list[i + dir];
    if (!to) return;
    to.focus();
    const inp = to as HTMLInputElement;
    if (typeof inp.select === "function") { try { inp.select(); } catch { /* not selectable */ } }
  }
  function onFormKey(e: React.KeyboardEvent) {
    const t = e.target as HTMLElement;
    const tag = t.tagName;
    // Custom dropdown trigger (SearchableSelect): ↓/Enter/Space open it (the
    // component handles that); ↑/←/→ just navigate past it.
    if (t.hasAttribute("data-qnav")) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") return;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); moveFocus(t, -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); moveFocus(t, 1); }
      return;
    }
    if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") return;
    const el = t as HTMLInputElement;
    const isText = tag === "INPUT" || tag === "TEXTAREA";
    const len = el.value ? el.value.length : 0;
    const atEnd = isText ? (el.selectionStart ?? len) >= len : true;
    const atStart = isText ? (el.selectionStart ?? 0) === 0 : true;
    switch (e.key) {
      case "Enter": e.preventDefault(); moveFocus(t, 1); break;
      case "ArrowDown": if (tag === "SELECT") break; e.preventDefault(); moveFocus(t, 1); break;
      case "ArrowUp": if (tag === "SELECT") break; e.preventDefault(); moveFocus(t, -1); break;
      case "ArrowRight": if (tag === "SELECT" || (isText && !atEnd)) break; e.preventDefault(); moveFocus(t, 1); break;
      case "ArrowLeft": if (tag === "SELECT" || (isText && !atStart)) break; e.preventDefault(); moveFocus(t, -1); break;
    }
  }
  return { formRef, onFormKey };
}

// Default option lists + the custom values saved from the dropdowns.
function useBrandOptions() {
  const [custom, setCustom] = useState<Record<string, string[]>>({});
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/epc/quotation/brands", { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
        const j = await res.json().catch(() => ({}));
        if (j?.ok) setCustom(j.options || {});
      } catch { /* defaults only */ }
    })();
  }, []);
  return useCallback((base: string[], field: string) => Array.from(new Set([...base, ...(custom[field] || [])])), [custom]);
}

type SavedFile = { name: string; url: string };

function saveUrl(url: string, name: string) {
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

// Save what the server sent back: one file, or several (JSON, each its own PDF).
// Several → also returned as links, in case the browser blocks the extra downloads.
async function saveDownload(res: Response): Promise<SavedFile[]> {
  if ((res.headers.get("Content-Type") || "").includes("application/json")) {
    const j = (await res.json()) as { files: { name: string; data: string }[] };
    const files = j.files.map((f) => ({
      name: f.name,
      url: URL.createObjectURL(new Blob([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], { type: "application/pdf" })),
    }));
    for (const [n, f] of files.entries()) {
      if (n) await new Promise((r) => setTimeout(r, 400)); // let the browser start each download
      saveUrl(f.url, f.name);
    }
    return files;
  }
  const cd = res.headers.get("Content-Disposition") || "";
  const url = URL.createObjectURL(await res.blob());
  saveUrl(url, (cd.match(/filename="([^"]+)"/) || [])[1] || "quotation.pdf");
  URL.revokeObjectURL(url);
  return [];
}

// Generate the quotation and save it; resolves to the next suggested serial no.
// (PDF-template EPCs) or null.
function useQuotationDownload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<SavedFile[]>([]);
  async function run(body: object): Promise<string | null> {
    setError(null);
    setFiles((old) => { old.forEach((f) => URL.revokeObjectURL(f.url)); return []; });
    setBusy(true);
    try {
      const res = await fetch("/api/epc/quotation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j?.error || "Couldn't generate the quotation."); return null; }
      const next = res.headers.get("X-Next-Serial");
      setFiles(await saveDownload(res));
      return next;
    } catch (e) { setError((e as Error)?.message || "Network error."); return null; }
    finally { setBusy(false); }
  }
  return { busy, error, setError, files, run };
}

function DownloadBar({ busy, error, files = [], onClick }: { busy: boolean; error: string | null; files?: SavedFile[]; onClick: () => void }) {
  return (
    <>
      {error && <p className="text-[13px] text-red-600 mt-4">{error}</p>}
      <div className="mt-6 flex items-center gap-4 flex-wrap">
        <button onClick={onClick} disabled={busy}
          className="px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
          {busy ? "Generating…" : "Download quotation"}
        </button>
        {files.map((f) => (
          <a key={f.url} href={f.url} download={f.name} className="text-[12.5px] text-[#1e3a8a] underline">{f.name}</a>
        ))}
      </div>
    </>
  );
}

function Toggle({ on, onClick, label, grow }: { on: boolean; onClick: () => void; label: string; grow?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={[grow ? "flex-1" : "", "px-3 py-2 rounded-xl text-[13px] font-semibold border", on ? "text-white border-transparent" : "bg-white border-line text-text-mid"].join(" ")}
      style={on ? { background: NAVY } : undefined}>{label}</button>
  );
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      {([["Yes", true], ["No", false]] as const).map(([lab, val]) => (
        <Toggle key={lab} label={lab} on={value === val} onClick={() => onChange(val)} grow />
      ))}
    </div>
  );
}

// Pick any number of options (none = not applicable).
function Chips({ options, value, onChange }: { options: readonly string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((o) => (
        <Toggle key={o} label={o} on={value.includes(o)} onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])} />
      ))}
    </div>
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

// Sarvatra Energy (gozerobils) — one form → their quotation + Project Confirmation
// Receipt (PCR), each saved as its own PDF. Quote no. auto-numbered, date automatic;
// generation, savings and financing are worked out from kW and price. A loan
// application ID fills everything that application already has.
type SarvatraFields = {
  loan_id: string;
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

// The loan application's columns that fill the form (RLS: the EPC's own applications only).
const LOAN_COLS = "aadhaar_name, borrower_name, aadhaar_gender, borrower_mobile, borrower_email, ebill_name, ca_number, " +
  "ebill_address_line, aadhaar_address, install_pincode, install_city, install_state, project_size, project_size_unit, " +
  "total_project_cost, system_type, plant_use_type, approved_lender, lead_owner_name";
const SYSTEM_TYPE: Record<string, string> = { on_grid: "On-grid", off_grid: "Off-grid", hybrid: "Hybrid" };
const PLANT_USE: Record<string, string> = { residential: "Domestic", commercial: "Commercial", industrial: "Industrial" };

// Every form field a loan application can fill — reset when a different application is looked up.
const LOAN_FIELDS = [
  "customer_name", "title", "contact", "email", "ebill_name", "k_number", "address", "pincode", "city", "state",
  "kw", "price", "inverter_type", "connection_type", "finance_by", "spc_name", "payment_mode",
] as const satisfies readonly (keyof SarvatraFields)[];

function loanToFields(a: Record<string, unknown>): Partial<SarvatraFields> {
  const t = (k: string) => (a[k] == null ? "" : String(a[k]).trim());
  const gender = t("aadhaar_gender").toLowerCase();
  const size = Number(a.project_size) > 0 ? Number(a.project_size) * (t("project_size_unit").toLowerCase() === "mw" ? 1000 : 1) : 0;
  const out: Partial<SarvatraFields> = {
    customer_name: t("aadhaar_name") || t("borrower_name"),
    title: gender.startsWith("f") ? "Mrs." : gender.startsWith("m") ? "Mr." : "",
    contact: t("borrower_mobile").replace(/\D/g, "").slice(-10),
    email: t("borrower_email"), ebill_name: t("ebill_name"), k_number: t("ca_number"),
    address: t("ebill_address_line") || t("aadhaar_address"), pincode: t("install_pincode"),
    city: t("install_city"), state: INDIA_STATES.includes(t("install_state")) ? t("install_state") : "",
    kw: size ? String(+size.toFixed(2)) : "", price: Number(a.total_project_cost) > 0 ? String(Math.round(Number(a.total_project_cost))) : "",
    inverter_type: SYSTEM_TYPE[t("system_type")] ?? "", connection_type: PLANT_USE[t("plant_use_type")] ?? "",
    finance_by: LENDER_LABEL[t("approved_lender") as LenderKey] ?? t("approved_lender"),
    spc_name: t("lead_owner_name"), payment_mode: "Financing",
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as Partial<SarvatraFields>; // keep what's filled
}

function SarvatraForm({ serialNext }: { serialNext: number | null }) {
  const [f, setF] = useState<SarvatraFields>({
    loan_id: "",
    title: SARVATRA.titles[0], customer_name: "", contact: "", email: "", city: "", state: "Rajasthan",
    address: "", pincode: "", ebill_name: "", k_number: "", aen: "", sanctioned_load: "", spc_name: "",
    quote_no: serialNext ? SARVATRA.serial(serialNext) : "",
    kw: "", panel_brand: SARVATRA.panel, panel_type: SARVATRA.panelType, cell_type: SARVATRA.cellType,
    dcr_type: SARVATRA.dcrTypes[0], wp: SARVATRA.wp, inverter_brand: SARVATRA.inverter, inverter_kw: "",
    phase: SARVATRA.phases[0], inverter_type: SARVATRA.inverterTypes[0], inverter_location: SARVATRA.inverterLocations[0],
    connection_type: SARVATRA.connectionTypes[0], floors: "", solar_care: false,
    roof_type: SARVATRA.roofTypes[0], structure_type: SARVATRA.structureTypes[0],
    price: "", state_subsidy: "", design_payment: "",
    finance_by: "", payment_method: SARVATRA.paymentMethods[0], payment_mode: SARVATRA.paymentModes[0],
    maintenance_plan: "", maintenance_others: "NA", site_readiness: SARVATRA.siteReadiness[0], bill_correction: [],
  });
  const merge = useBrandOptions();
  const { formRef, onFormKey } = useKeyNav();
  const { busy, error, setError, files, run } = useQuotationDownload();
  const set = <K extends keyof SarvatraFields>(k: K, v: SarvatraFields[K]) => setF((p) => ({ ...p, [k]: v }));

  // Loan application ID → fill the form from that application (once per ID entered).
  // A different ID first resets what the previous one filled; a slower earlier
  // lookup can't overwrite a newer one.
  const [loanBusy, setLoanBusy] = useState(false);
  const initial = useRef(f).current;
  const loanFilled = useRef("");
  const loanReq = useRef(0);
  async function fillFromLoan() {
    const id = f.loan_id.trim().toUpperCase();
    if (!id || id === loanFilled.current) return;
    const req = ++loanReq.current;
    setLoanBusy(true); setError(null);
    try {
      const { data } = await supabase().from("epc_applications").select(LOAN_COLS).eq("loan_display_id", id).maybeSingle();
      if (req !== loanReq.current) return;
      if (!data) { setError("No loan application found with this ID."); return; }
      const reset = loanFilled.current ? Object.fromEntries(LOAN_FIELDS.map((k) => [k, initial[k]])) : {};
      loanFilled.current = id;
      setF((p) => ({ ...p, ...reset, ...loanToFields(data as unknown as Record<string, unknown>) }));
    } catch (e) { if (req === loanReq.current) setError((e as Error)?.message || "Network error."); }
    finally { if (req === loanReq.current) setLoanBusy(false); }
  }

  const kwNum = Number(f.kw) || 0;
  const priceNum = Number(f.price) || 0;
  const central = centralSubsidyFor(kwNum, SARVATRA.commercial(f.connection_type));
  const net = Math.max(0, priceNum - central - (Number(f.state_subsidy) || 0));
  const designAuto = Math.round(priceNum * SARVATRA.designShare);

  async function download() {
    if (!f.customer_name.trim()) { setError("Customer name is required."); return; }
    if (kwNum <= 0) { setError("Enter the system size (kW)."); return; }
    if (priceNum <= 0) { setError("Enter the system price."); return; }
    const next = await run({
      ...f, kw: kwNum, inverter_kw: Number(f.inverter_kw) || kwNum, price: priceNum,
      state_subsidy: Number(f.state_subsidy) || 0,
      design_payment: f.design_payment ? Number(f.design_payment) : designAuto,
    });
    if (next) set("quote_no", next);
  }

  const pick = (options: readonly string[]) => options.map((o) => <option key={o} value={o}>{o}</option>);

  return (
    <div className="min-h-screen bg-bg-soft">
      <BackHeader />
      <div className="max-w-[900px] mx-auto px-5 sm:px-7 py-8" ref={formRef} onKeyDown={onFormKey}>
        <h1 className="font-display text-[24px] sm:text-[28px] font-bold text-text">Quotation builder</h1>

        <Section title="Loan application">
          <Field l={`Loan application ID${loanBusy ? " · looking up…" : ""}`}>
            <input className={input} value={f.loan_id} onChange={(e) => set("loan_id", e.target.value)} onBlur={() => void fillFromLoan()} placeholder="e.g. CC-RES-00223" />
          </Field>
        </Section>

        <Section title="Customer">
          <Field l="Title"><select className={input} value={f.title} onChange={(e) => set("title", e.target.value)}>{pick(SARVATRA.titles)}</select></Field>
          <Field l="Customer name" req><input className={input} value={f.customer_name} onChange={(e) => set("customer_name", e.target.value)} placeholder="Full name" /></Field>
          <Field l="Contact no."><input className={input} inputMode="numeric" value={f.contact} onChange={(e) => set("contact", digits(e.target.value).slice(0, 10))} placeholder="10-digit mobile" /></Field>
          <Field l="Email"><input className={input} inputMode="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field l="Address"><input className={input} value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field l="Pincode"><input className={input} inputMode="numeric" value={f.pincode} onChange={(e) => set("pincode", digits(e.target.value).slice(0, 6))} /></Field>
          <Field l="City"><input className={input} value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Jaipur" /></Field>
          <Field l="State"><select className={input} value={f.state} onChange={(e) => set("state", e.target.value)}>{pick(INDIA_STATES)}</select></Field>
          <Field l="Name on electricity bill"><input className={input} value={f.ebill_name} onChange={(e) => set("ebill_name", e.target.value)} /></Field>
          <Field l="K number"><input className={input} value={f.k_number} onChange={(e) => set("k_number", e.target.value)} /></Field>
          <Field l="AEN office"><input className={input} value={f.aen} onChange={(e) => set("aen", e.target.value)} placeholder="e.g. B-IV_DURGAPURA" /></Field>
          <Field l="Sanctioned load (kW)"><input className={input} inputMode="decimal" value={f.sanctioned_load} onChange={(e) => set("sanctioned_load", decimal(e.target.value))} /></Field>
          <Field l="SPC name"><input className={input} value={f.spc_name} onChange={(e) => set("spc_name", e.target.value)} /></Field>
          <Field l="Quote no."><input className={input} value={f.quote_no} onChange={(e) => set("quote_no", e.target.value)} placeholder={SARVATRA.serial(1)} /></Field>
        </Section>

        <Section title="System">
          <Field l="System size (kW)" req><input className={input} inputMode="decimal" value={f.kw} onChange={(e) => set("kw", decimal(e.target.value))} placeholder="e.g. 6" /></Field>
          <SearchableSelect label="Solar panel brand" value={f.panel_brand} onChange={(v) => set("panel_brand", v)} options={merge([SARVATRA.panel, ...MODULE_BRANDS], BRAND_FIELDS.module)} field={BRAND_FIELDS.module} />
          <Field l="Panel type"><input className={input} value={f.panel_type} onChange={(e) => set("panel_type", e.target.value)} /></Field>
          <Field l="Type of cell"><input className={input} value={f.cell_type} onChange={(e) => set("cell_type", e.target.value)} /></Field>
          <Field l="DCR / NDCR"><select className={input} value={f.dcr_type} onChange={(e) => set("dcr_type", e.target.value)}>{pick(SARVATRA.dcrTypes)}</select></Field>
          <Field l="Wp"><input className={input} value={f.wp} onChange={(e) => set("wp", e.target.value)} /></Field>
          <SearchableSelect label="Inverter brand" value={f.inverter_brand} onChange={(v) => set("inverter_brand", v)} options={merge([SARVATRA.inverter, ...INVERTER_BRANDS], BRAND_FIELDS.inverter)} field={BRAND_FIELDS.inverter} />
          <Field l="Inverter size (kW)"><input className={input} inputMode="decimal" value={f.inverter_kw} onChange={(e) => set("inverter_kw", decimal(e.target.value))} placeholder={f.kw || "e.g. 6"} /></Field>
          <Field l="Phase"><select className={input} value={f.phase} onChange={(e) => set("phase", e.target.value)}>{pick(SARVATRA.phases)}</select></Field>
          <Field l="Inverter type"><select className={input} value={f.inverter_type} onChange={(e) => set("inverter_type", e.target.value)}>{pick(SARVATRA.inverterTypes)}</select></Field>
          <SearchableSelect label="Inverter location" value={f.inverter_location} onChange={(v) => set("inverter_location", v)} options={merge(SARVATRA.inverterLocations, BRAND_FIELDS.inverterLocation)} field={BRAND_FIELDS.inverterLocation} />
          <SearchableSelect label="Connection type" value={f.connection_type} onChange={(v) => set("connection_type", v)} options={merge(SARVATRA.connectionTypes, BRAND_FIELDS.connectionType)} field={BRAND_FIELDS.connectionType} />
          <Field l="No. of floors"><input className={input} value={f.floors} onChange={(e) => set("floors", e.target.value)} placeholder="e.g. G+2" /></Field>
          <Field l="GoZeroBils SolarCare™"><YesNo value={f.solar_care} onChange={(v) => set("solar_care", v)} /></Field>
          <SearchableSelect label="Roof type" value={f.roof_type} onChange={(v) => set("roof_type", v)} options={merge(SARVATRA.roofTypes, BRAND_FIELDS.roofType)} field={BRAND_FIELDS.roofType} />
          <SearchableSelect label="Structure type" value={f.structure_type} onChange={(v) => set("structure_type", v)} options={merge(SARVATRA.structureTypes, BRAND_FIELDS.structureType)} field={BRAND_FIELDS.structureType} />
        </Section>

        <Section title="Price">
          <Field l="System price (GST incl.) ₹" req><input className={input} inputMode="numeric" value={f.price} onChange={(e) => set("price", digits(e.target.value))} placeholder="e.g. 300000" /></Field>
          <Field l="State subsidy ₹"><input className={input} inputMode="numeric" value={f.state_subsidy} onChange={(e) => set("state_subsidy", digits(e.target.value))} placeholder="e.g. 17000" /></Field>
          <Field l="Central subsidy ₹ (auto by kW)"><input className={input + " bg-bg-soft"} readOnly value={inr(central)} /></Field>
          <Field l="On design approval ₹"><input className={input} inputMode="numeric" value={f.design_payment} onChange={(e) => set("design_payment", digits(e.target.value))} placeholder={inr(designAuto)} /></Field>
          <Field l="Net effective price ₹"><input className={input + " bg-bg-soft font-semibold"} readOnly value={inr(net)} /></Field>
          <Field l="Finance by (bank / NBFC)"><input className={input} value={f.finance_by} onChange={(e) => set("finance_by", e.target.value)} /></Field>
          <Field l="Mode of payment"><select className={input} value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)}>{pick(SARVATRA.paymentMethods)}</select></Field>
          <Field l="Payment mode"><select className={input} value={f.payment_mode} onChange={(e) => set("payment_mode", e.target.value)}>{pick(SARVATRA.paymentModes)}</select></Field>
        </Section>

        <Section title="Booking">
          <Field l="Maintenance plan">
            <select className={input} value={f.maintenance_plan} onChange={(e) => set("maintenance_plan", e.target.value)}>
              <option value="">None</option>{pick(SARVATRA.maintenancePlans)}
            </select>
          </Field>
          <Field l="Maintenance — others"><input className={input} value={f.maintenance_others} onChange={(e) => set("maintenance_others", e.target.value)} /></Field>
          <Field l="Site readiness"><select className={input} value={f.site_readiness} onChange={(e) => set("site_readiness", e.target.value)}>{pick(SARVATRA.siteReadiness)}</select></Field>
          <Field l="Bill correction">
            <Chips options={SARVATRA.billCorrections} value={f.bill_correction} onChange={(v) => set("bill_correction", v)} />
          </Field>
        </Section>

        <DownloadBar busy={busy} error={error} files={files} onClick={() => void download()} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-line p-5 mt-5">
      <div className="text-[13px] font-semibold text-[#0f3d2e] mb-3">{title}</div>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}
function Field({ l, req, children }: { l: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium text-text-mid">{l}{req && <span className="text-red-500"> *</span>}</span>
      {children}
    </div>
  );
}
