"use client";

// "From bill photo" (Partner Portal v2) — the customer's electricity bill to a
// draft quotation in under 30 seconds: take or choose a photo (or a PDF) → the
// bill is read (lib/bill-quote readBill) → review the customer, units, bill, the
// suggested size and the price per kW, with the total, the central subsidy and
// the EMI against the current bill → "Create quotation" saves a draft
// (lib/quotes saveQuote) and opens it in the editor. Shown on Quotations to a
// login that may work (canWork) on the demo EPC (portalV2).

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAVY } from "@/components/partner/PartnerShell";
import Modal, { OVERLAY } from "@/components/ui/Modal";
import { input, decimal, digits, Field, Toggle } from "@/components/quotation/form-kit";
import { fetchKyc, fetchOrgSettings } from "@/lib/org-settings";
import { saveQuote, type QuoteRow } from "@/lib/quotes";
import { stateOfGstin } from "@/lib/india-states";
import { fmtRupees } from "@/lib/money";
import { MOBILE_RE } from "@/lib/validators";
import { billFigures, billQuoteDoc, defaultPricePerKw, readBill, suggestKw, unitsPerKwMonth, type BillQuoteFields } from "@/lib/bill-quote";
import type { OrgProfile } from "@/lib/org-profile";

type Draft = {
  name: string; mobile: string; address: string; discom: string;
  units: string; bill: string; domestic: boolean;
  per_kw: string | null; // units a kW makes a month; null = the state's starting figure
  kw: string | null;     // null = follows the units
  price: string | null;  // null = the default price per kW
  state: string; k_number: string; sanctioned_kw: number | null;
};

const draftOf = (b: BillQuoteFields | null, mobile = ""): Draft => ({
  name: b?.name ?? "", mobile, address: b?.address ?? "", discom: b?.discom ?? "",
  units: b?.units != null ? String(b.units) : "", bill: b?.bill != null ? String(b.bill) : "",
  domestic: b?.domestic ?? true, per_kw: null, kw: null, price: null,
  state: b?.state ?? "", k_number: b?.k_number ?? "", sanctioned_kw: b?.sanctioned_kw ?? null,
});

export default function BillToQuote({ quotes, onClose }: { quotes: QuoteRow[]; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<"pick" | "reading" | "review">("pick");
  const [preview, setPreview] = useState<string | null>(null);
  const [d, setD] = useState<Draft>(() => draftOf(null));
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [gstState, setGstState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The EPC's preferences and state — cached reads the editor opened next shares.
  useEffect(() => {
    fetchOrgSettings().then(setOrg, () => setError("Couldn't load your quotation preferences. Please refresh."));
    fetchKyc().then((k) => setGstState(stateOfGstin(k.gstin_number)), () => {});
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function read(file: File) {
    setError(null); setStep("reading");
    setPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    let got: BillQuoteFields | null = null;
    try { got = await readBill(file); } catch (e) { setError((e as Error).message); }
    setD((p) => draftOf(got, p.mobile));
    setStep("review");
  }
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((p) => ({ ...p, [k]: v })); setError(null); };

  const epcState = gstState || org?.state || "";
  const perKwText = d.per_kw ?? String(unitsPerKwMonth(d.state || org?.state || null));
  const autoKw = suggestKw(Number(d.units) || null, Number(perKwText) || 0, d.sanctioned_kw);
  const kwText = d.kw ?? (autoKw ? String(autoKw) : "");
  const defPrice = useMemo(() => defaultPricePerKw(org, d.domestic ? "residential" : "commercial", quotes), [org, d.domestic, quotes]);
  const priceText = d.price ?? (defPrice ? String(defPrice) : "");
  const doc = useMemo(() => billQuoteDoc(org, {
    domestic: d.domestic, name: d.name, mobile: d.mobile, address: d.address, discom: d.discom,
    state: d.state, k_number: d.k_number, sanctioned_kw: d.sanctioned_kw,
    kw: Number(kwText) || 0, price_per_kw: Number(priceText) || 0,
  }), [org, d, kwText, priceText]);
  const fig = useMemo(() => billFigures(doc, Number(d.bill) || 0), [doc, d.bill]);

  async function create() {
    if (!d.name.trim()) { setError("Enter the customer's name."); return; }
    if (d.mobile && !MOBILE_RE.test(d.mobile)) { setError("Enter a valid 10-digit mobile."); return; }
    if (!(doc.kw > 0)) { setError("Enter the system size (kW)."); return; }
    if (!(doc.price > 0)) { setError("Enter the price per kW."); return; }
    setBusy(true); setError(null);
    try {
      const saved = await saveQuote(null, doc, "draft", epcState);
      router.push(`/dashboard/quotes/${saved.id}` as any);
    } catch (e) {
      const m = (e as { message?: string })?.message || "";
      setError(/row-level|42501|permission denied/i.test(m) ? "You don't have access to make quotations." : m || "Couldn't save the quotation.");
      setBusy(false);
    }
  }

  const tile = "flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-line bg-white py-9 text-[14px] font-semibold text-[#0f3d2e] hover:border-[#1e3a8a] hover:bg-[#f7f9fd]";
  const icon = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: NAVY, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  return (
    // Escape, ✕, Cancel and the overlay press all wait while the quotation saves.
    <Modal onClose={onClose} busy={busy} closeOnBackdrop="mousedown" closeOnEscape overlayClassName={OVERLAY.soft}
      className="bg-white rounded-2xl shadow-xl w-full max-w-[640px] max-h-[92vh] overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[17px] font-display font-bold text-[#0f3d2e]">Quotation from bill</div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-lg text-text-muted hover:bg-bg-soft">✕</button>
      </div>

      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={pick} />

      {step === "pick" && (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => camRef.current?.click()} className={tile}>
            <svg {...icon}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3.5" /></svg>
            Take photo
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className={tile}>
            <svg {...icon}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="m9 15 3-3 3 3" /></svg>
            Choose file
          </button>
        </div>
      )}

      {step === "reading" && (
        <div className="flex flex-col items-center gap-4 py-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview && <img src={preview} alt="" className="max-h-[240px] max-w-full rounded-xl border border-line object-contain" />}
          <span className="flex items-center gap-2 text-[13.5px] text-text-mid">
            <span className="w-4 h-4 rounded-full border-2 border-[#1e3a8a]/30 border-t-[#1e3a8a] animate-spin" /> Reading…
          </span>
        </div>
      )}

      {step === "review" && (
        <>
          <fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3">
            <Field l="Customer name" req><input className={input} value={d.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field l="Mobile"><input className={input} inputMode="numeric" autoFocus value={d.mobile} onChange={(e) => set("mobile", digits(e.target.value).slice(0, 10))} placeholder="10-digit mobile" /></Field>
            <div className="sm:col-span-2">
              <Field l="Address"><textarea className={input + " min-h-[60px]"} value={d.address} onChange={(e) => set("address", e.target.value)} /></Field>
            </div>
            <Field l="DISCOM"><input className={input} value={d.discom} onChange={(e) => set("discom", e.target.value)} /></Field>
            <Field l="Connection">
              <div className="flex gap-2">
                <Toggle label="Domestic" on={d.domestic} onClick={() => set("domestic", true)} grow />
                <Toggle label="Non-domestic" on={!d.domestic} onClick={() => set("domestic", false)} grow />
              </div>
            </Field>
            <Field l="Units / month"><input className={input} inputMode="decimal" value={d.units} onChange={(e) => set("units", decimal(e.target.value))} /></Field>
            <Field l="Current bill ₹ / month"><input className={input} inputMode="decimal" value={d.bill} onChange={(e) => set("bill", decimal(e.target.value))} /></Field>
            <Field l="Units per kW / month"><input className={input} inputMode="decimal" value={perKwText} onChange={(e) => { set("per_kw", decimal(e.target.value)); set("kw", null); }} /></Field>
            <Field l="System size (kW)" req><input className={input} inputMode="decimal" value={kwText} onChange={(e) => set("kw", decimal(e.target.value))} /></Field>
            <Field l="Price per kW ₹ (before GST)" req><input className={input} inputMode="decimal" value={priceText} onChange={(e) => set("price", decimal(e.target.value))} /></Field>
          </fieldset>

          <div className="mt-5 rounded-2xl border border-line bg-bg-soft p-4">
            <Sum l="Total (incl. GST)" v={fig.total} strong={!fig.subsidy} />
            {fig.subsidy > 0 && (
              <>
                <Sum l="Central subsidy" v={-fig.subsidy} />
                <Sum l="After subsidy" v={fig.pays} strong />
              </>
            )}
            {fig.pays > 0 && (
              <table className="w-full text-[13px] mt-3">
                <thead>
                  <tr className="text-left text-[11.5px] uppercase tracking-wide text-text-muted">
                    <th className="py-1.5 font-semibold">EMI</th>
                    <th className="py-1.5 font-semibold text-right">Per month</th>
                    <th className="py-1.5 font-semibold text-right">Saving / month</th>
                  </tr>
                </thead>
                <tbody>
                  {fig.emis.map((e) => (
                    <tr key={e.years} className="border-t border-line">
                      <td className="py-1.5 text-text-mid">{e.years} {e.years === 1 ? "year" : "years"}</td>
                      <td className="py-1.5 text-right font-semibold text-text">{fmtRupees(e.emi)}</td>
                      <td className={"py-1.5 text-right font-semibold " + (e.saving == null ? "text-text-muted" : e.saving >= 0 ? "text-[#178a5c]" : "text-red-600")}>
                        {e.saving == null ? "—" : e.saving < 0 ? `- ${fmtRupees(-e.saving)}` : fmtRupees(e.saving)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}

      {step === "review" && (
        <div className="flex items-center gap-2 mt-5">
          <button type="button" onClick={() => { setError(null); setStep("pick"); }} disabled={busy}
            className="px-3 py-2 rounded-xl text-[13.5px] font-semibold text-[#1e3a8a] hover:bg-bg-soft disabled:opacity-60">Retake</button>
          <button type="button" onClick={onClose} disabled={busy} className="ml-auto px-4 py-2.5 rounded-xl text-[13.5px] font-semibold text-text-mid hover:bg-bg-soft">Cancel</button>
          <button type="button" onClick={() => void create()} disabled={busy || !org}
            className="px-5 py-2.5 rounded-xl text-white text-[13.5px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
            {busy ? "Creating…" : "Create quotation"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function Sum({ l, v, strong }: { l: string; v: number; strong?: boolean }) {
  return (
    <div className={"flex items-center justify-between gap-3 py-1 " + (strong ? "text-[15px] font-bold text-[#0f3d2e]" : "text-[13.5px] text-text")}>
      <span className={strong ? "" : "text-text-mid"}>{l}</span>
      <span className="whitespace-nowrap">{v < 0 ? `- ${fmtRupees(-v)}` : fmtRupees(v)}</span>
    </div>
  );
}
