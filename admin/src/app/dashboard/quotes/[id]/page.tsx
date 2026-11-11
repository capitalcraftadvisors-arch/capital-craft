"use client";

// Quotation editor (Zoho-style) — /dashboard/quotes/new?segment=… | ?from=<id>
// (copy) | /dashboard/quotes/<id>. Everything on the quotation can be changed:
// the customer (billing / site, place of supply), the system, the item rows
// (prefilled with the standard bill of material; lump sum at 8.9 % or each row
// at its own GST), discount, subsidy, payment, warranty, scope, terms and notes.
// Totals are live (lib/quote-calc — the same maths as the PDF). Nothing saves
// until Save; the PDF saves first when there are changes.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { NAVY } from "@/components/partner/PartnerShell";
import { input, Toggle, useBrandOptions } from "@/components/quotation/form-kit";
import SearchableSelect from "@/components/quotation/SearchableSelect";
import DateField from "@/components/ui/DateField";
import { PairRows, PaymentRows, RemoveBtn, paymentTotal } from "@/components/partner/RowEditors";
import { fetchKyc, fetchOrgSettings } from "@/lib/org-settings";
import { resolveQuoteDefaults, type OrgProfile } from "@/lib/org-profile";
import { addDays, GST_RATES, newQuoteDoc, quoteTotals, standardItems, withAutoItems, withBatteryRow, type QuoteDoc, type QuoteItem } from "@/lib/quote-calc";
import { deleteQuote, downloadQuotePdf, fetchQuote, saveQuote, setQuoteStatus, QUOTE_STATUSES, QUOTE_STATUS_LABEL, QUOTE_STATUS_PILL, type QuoteRow, type QuoteStatus } from "@/lib/quotes";
import { BRAND_FIELDS, DISCOMS, STANDARD, STANDARD_BOM, STANDARD_EXTRAS, boqField, type Segment } from "@/lib/quotation-brands";
import { centralSubsidyFor } from "@/lib/emi";
import { INDIA_STATES, stateOfGstin } from "@/lib/india-states";
import { amountInput, fmtRupees } from "@/lib/money";
import { rupeesInWords } from "@/lib/numberToWords";
import { getBusiness } from "@/lib/auth";
import { canWork } from "@/lib/epc-roles";

const today = () => new Date().toISOString().slice(0, 10);

export default function QuoteEditor({ params }: { params: { id: string } }) {
  const router = useRouter();
  const work = canWork(getBusiness()); // a viewer reads and downloads only
  const [doc, setDoc] = useState<QuoteDoc | null>(null);
  const [row, setRow] = useState<QuoteRow | null>(null);        // the saved quotation (number, status)
  const [epcState, setEpcState] = useState("");
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [price, setPrice] = useState("");                       // typed amounts (strings while typing)
  const [discount, setDiscount] = useState("");
  const [subsidy, setSubsidy] = useState("");
  const [stateSub, setStateSub] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "pdf" | "delete" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const merge = useBrandOptions();
  // Undo: earlier versions of the quotation (a burst of typing = one step; a
  // removed or added row always its own). Ctrl+Z outside a text box too.
  const [past, setPast] = useState<QuoteDoc[]>([]);
  const lastStep = useRef(0);
  const undoRef = useRef<() => void>(() => {});
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !t?.closest("input, textarea, select")) {
        e.preventDefault(); undoRef.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    (async () => {
      const [org, kyc] = await Promise.all([fetchOrgSettings(), fetchKyc()]);
      setEpcState(stateOfGstin(kyc.gstin_number) || org.state || "");
      setOrg(org);
      const sp = new URLSearchParams(window.location.search);
      let d: QuoteDoc;
      if (params.id !== "new") {
        const got = await fetchQuote(params.id);
        setRow(got.row);
        d = got.doc;
      } else if (sp.get("from")) {
        const src = (await fetchQuote(sp.get("from")!)).doc;   // a copy: new number, today's dates
        const days = resolveQuoteDefaults(org, src.segment).validity;
        d = { ...src, date: today(), valid_till: addDays(today(), days) };
        setDirty(true);
      } else {
        d = newQuoteDoc(sp.get("segment") === "commercial" ? "commercial" : "residential", org);
        setDirty(true);
      }
      setDoc(d);
      setPrice(d.price ? String(d.price) : "");
      setDiscount(d.discount ? String(d.discount) : "");
      setSubsidy(d.subsidy == null ? "" : String(d.subsidy));
      setStateSub(d.state_subsidy ? String(d.state_subsidy) : "");
    })().catch((e) => setFailed((e as Error)?.message || "Couldn't open this quotation."));
  }, [params.id]);

  const totals = useMemo(() => (doc ? quoteTotals(doc, epcState) : null), [doc, epcState]);
  if (failed) return <p className="text-[13px] text-red-600">{failed}</p>;
  if (!doc || !totals) return <p className="text-[13px] text-text-muted">Loading…</p>;

  const resi = doc.segment === "residential";
  const pays = resi && totals.eligible ? totals.net : totals.total;
  const autoSubsidy = totals.eligible ? centralSubsidyFor(doc.kw, false) : 0;

  const up = (patch: Partial<QuoteDoc>) => {
    let next = { ...doc, ...patch };
    if ("system_type" in patch) next = withBatteryRow(next);
    if ("kw" in patch || "phase" in patch || "system_type" in patch) next = withAutoItems(next);
    // A row added / removed is always its own undo step; typing joins one step until a 1 s pause.
    const rows = (["items", "payment", "warranty"] as const).some((k) => k in patch && (patch[k] as unknown[]).length !== doc[k].length);
    if (rows || Date.now() - lastStep.current > 1000) setPast((p) => [...p.slice(-49), doc]);
    lastStep.current = Date.now();
    setDoc(next);
    setDirty(true); setError(null);
  };
  // Back one step — the typed amounts follow the restored quotation.
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    lastStep.current = 0;
    setDoc(prev);
    setPrice(prev.price ? String(prev.price) : "");
    setDiscount(prev.discount ? String(prev.discount) : "");
    setSubsidy(prev.subsidy == null ? "" : String(prev.subsidy));
    setStateSub(prev.state_subsidy ? String(prev.state_subsidy) : "");
    setDirty(true); setError(null);
  };
  undoRef.current = work ? undo : () => {};
  const upCust = (patch: Partial<QuoteDoc["customer"]>) => up({ customer: { ...doc.customer, ...patch } });
  const setItem = (i: number, patch: Partial<QuoteItem>) => {
    const items = doc.items.map((it, j) => {
      if (j !== i) return it;
      const auto = it.auto ? { qty: it.auto.qty && !("qty" in patch), spec: it.auto.spec && !("spec" in patch) } : undefined;
      const next = { ...it, ...patch, auto: auto && (auto.qty || auto.spec) ? auto : undefined };
      return patch.spec && it.key === "std_module" && it.auto?.qty ? withAutoItems({ ...doc, items: [next] }).items[0] : next;
    });
    up({ items });
  };
  const amount = (setter: (v: string) => void, key: "price" | "discount" | "state_subsidy") => (v: string) => {
    const s = amountInput(v); setter(s); up({ [key]: Number(s) || 0 } as Partial<QuoteDoc>);
  };

  const validityOf = (s: Segment) => resolveQuoteDefaults(org, s).validity;

  // A new quotation can still switch kind: the kind's defaults, the customer / system / items kept.
  function switchSegment(s: Segment) {
    if (row || s === doc!.segment) return;
    const base = newQuoteDoc(s, org);
    up({ ...base, customer: { ...doc!.customer, category: base.customer.category }, kw: doc!.kw, items: doc!.items, price: doc!.price,
      discount: doc!.discount, gst_mode: doc!.gst_mode, date: doc!.date, valid_till: addDays(doc!.date, validityOf(s)) });
  }

  function problem(): string | null {
    if (!doc!.customer.name.trim()) return "Enter the customer's name.";
    if (!(doc!.kw > 0)) return "Enter the system size (kW).";
    if (!totals!.lines && !(doc!.price > 0)) return "Enter the system price.";
    if (totals!.lines && !(totals!.base > 0)) return "Add the item rates.";
    if (doc!.payment.length && Math.abs(paymentTotal(doc!.payment) - 100) > 0.001) return "The payment schedule must add up to 100%.";
    return null;
  }

  async function save(): Promise<QuoteRow | null> {
    const p = problem();
    if (p) { setError(p); return null; }
    setBusy("save"); setError(null);
    try {
      const saved = await saveQuote(row?.id ?? null, doc!, row?.status ?? "draft", epcState);
      if (!row) window.history.replaceState(null, "", `/dashboard/quotes/${saved.id}`);
      setRow(saved); setDirty(false);
      return saved;
    } catch (e) { setError((e as Error)?.message || "Couldn't save."); return null; }
    finally { setBusy(null); }
  }

  async function pdf() {
    const saved = dirty || !row ? await save() : row;
    if (!saved) return;
    setBusy("pdf");
    try { await downloadQuotePdf(saved.id); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function status(s: QuoteStatus) {
    if (!row || s === row.status) return;
    setBusy("status");
    try { await setQuoteStatus(row.id, s); setRow({ ...row, status: s }); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function remove() {
    if (!row || !window.confirm(`Delete quotation ${row.quote_no}? This can't be undone.`)) return;
    setBusy("delete");
    try { await deleteQuote(row.id); router.push("/dashboard/quotes" as any); }
    catch (e) { setError((e as Error).message); setBusy(null); }
  }

  const bomOf = (key?: string) => STANDARD_BOM.find((r) => r.key === key);
  const lines = totals.lines;
  // "+ Add item": the standard rows not on the quotation (e.g. one removed by
  // mistake — the battery too), then the usual extras; "Write your own" is a blank row.
  const std = standardItems(doc.kw, doc.phase, doc.system_type);
  if (!std.some((s) => s.key === "std_battery")) std.splice(2, 0, standardItems(doc.kw, doc.phase, "Hybrid").find((s) => s.key === "std_battery")!);
  const addOptions = [
    ...std.filter((s) => !doc.items.some((it) => it.key === s.key)).map((s) => ({ label: s.item, item: s })),
    ...STANDARD_EXTRAS.filter((x) => !doc.items.some((it) => it.item === x.product))
      .map((x) => ({ label: x.product, item: { item: x.product, spec: x.spec, make: "", hsn: "", qty: "1", unit: "", rate: 0, gst: 18 } as QuoteItem })),
  ];

  return (
    <div className="max-w-[1250px]">
      {/* Action bar */}
      <div className="sticky top-0 z-30 -mx-5 sm:-mx-8 px-5 sm:px-8 py-3 mb-4 bg-bg-soft/95 backdrop-blur border-b border-line flex items-center gap-3 flex-wrap">
        <button type="button" onClick={() => router.push("/dashboard/quotes" as any)} className="text-[13px] text-text-muted hover:text-text">← Quotations</button>
        <span className="text-[16px] font-bold text-[#0f3d2e]">{row ? row.quote_no : "New quotation"}</span>
        <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full bg-[#fff5de] text-[#8a5a00]">{resi ? "Residential" : "Commercial"}</span>
        {row && (
          <select value={row.status} onChange={(e) => void status(e.target.value as QuoteStatus)} disabled={busy !== null || !work}
            className={`px-2.5 py-1 rounded-full text-[12px] font-semibold border-0 outline-none cursor-pointer ${QUOTE_STATUS_PILL[row.status]}`}>
            {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {error && <span className="text-[13px] text-red-600 mr-1">{error}</span>}
          {work && (
            <button type="button" onClick={undo} disabled={!past.length || busy !== null} title="Undo (Ctrl+Z)" className={ghost + " inline-flex items-center gap-1.5"}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
              Undo
            </button>
          )}
          {row && work && <button type="button" onClick={() => router.push(`/dashboard/quotes/new?from=${row.id}` as any)} className={ghost}>Copy</button>}
          {row && work && <button type="button" onClick={() => void remove()} disabled={busy !== null} className={ghost + " text-red-600"}>Delete</button>}
          {/* A viewer downloads the saved quotation as it is. */}
          <button type="button" onClick={() => void (work ? pdf() : row && downloadQuotePdf(row.id).catch((e) => setError((e as Error).message)))} disabled={busy !== null} className={ghost}>{busy === "pdf" ? "Preparing…" : "Download PDF"}</button>
          {work && (
            <button type="button" onClick={() => void save()} disabled={busy !== null || (!dirty && !!row)}
              className="px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
              {busy === "save" ? "Saving…" : dirty || !row ? "Save" : "Saved"}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px] items-start">
        <div className="min-w-0">
          <Block title="Customer">
            <Grid>
              <F l="Customer name" req><input className={input} value={doc.customer.name} onChange={(e) => upCust({ name: e.target.value })} /></F>
              <F l="Mobile"><input className={input} inputMode="numeric" value={doc.customer.mobile} onChange={(e) => upCust({ mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></F>
              <F l="Email" opt><input className={input} type="email" value={doc.customer.email} onChange={(e) => upCust({ email: e.target.value.trim() })} /></F>
              <F l="GSTIN" opt><input className={input} value={doc.customer.gstin} onChange={(e) => { const g = e.target.value.toUpperCase().replace(/\s/g, "").slice(0, 15); upCust({ gstin: g, ...(g.length >= 2 && stateOfGstin(g) ? { state: stateOfGstin(g) } : {}) }); }} /></F>
              <F l="Billing address" wide><textarea className={input + " min-h-[60px]"} value={doc.customer.billing} onChange={(e) => upCust({ billing: e.target.value })} /></F>
              <F l="Site address" wide>
                <label className="flex items-center gap-2 text-[13px] text-text-mid mb-1.5">
                  <input type="checkbox" checked={!doc.customer.shipping} onChange={(e) => upCust({ shipping: e.target.checked ? "" : doc.customer.billing || " " })} className="h-4 w-4 accent-[#1e3a8a]" />
                  Same as billing
                </label>
                {!!doc.customer.shipping && <textarea className={input + " min-h-[60px]"} value={doc.customer.shipping.trimStart()} onChange={(e) => upCust({ shipping: e.target.value || " " })} />}
              </F>
              <F l="Place of supply">
                <select className={input} value={doc.customer.state} onChange={(e) => upCust({ state: e.target.value })}>
                  <option value="">—</option>
                  {INDIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </F>
              <F l="K. No."><input className={input} value={doc.customer.k_number} onChange={(e) => upCust({ k_number: e.target.value })} /></F>
              {/* A DISCOM typed once is kept and offered on every quotation after. */}
              <F l="DISCOM">
                <SearchableSelect label="" value={doc.customer.discom} field={BRAND_FIELDS.discom} clearable
                  options={merge([doc.customer.discom, ...DISCOMS].filter(Boolean), BRAND_FIELDS.discom)} onChange={(v) => upCust({ discom: v })} />
              </F>
              {!resi && (
                <>
                  <F l="Category">
                    <select className={input} value={doc.customer.category} onChange={(e) => upCust({ category: e.target.value })}>
                      {STANDARD.categories.commercial.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </F>
                  <F l="Sanctioned load (kW)"><input className={input} inputMode="decimal" value={doc.customer.sanctioned_load} onChange={(e) => upCust({ sanctioned_load: amountInput(e.target.value) })} /></F>
                </>
              )}
            </Grid>
          </Block>

          <Block title="Quotation">
            <Grid>
              {!row && (
                <F l="Kind">
                  <div className="flex gap-2">
                    <Toggle label="Residential" on={resi} onClick={() => switchSegment("residential")} grow />
                    <Toggle label="Commercial" on={!resi} onClick={() => switchSegment("commercial")} grow />
                  </div>
                </F>
              )}
              <F l="Date"><DateField className={input} value={doc.date} onChange={(v) => v && up({ date: v, valid_till: addDays(v, validityOf(doc.segment)) })} /></F>
              <F l="Valid till"><DateField className={input} value={doc.valid_till} min={doc.date} onChange={(v) => v && up({ valid_till: v })} /></F>
            </Grid>
          </Block>

          <Block title="System">
            <Grid>
              <F l="System size (kW)" req>
                <input className={input} inputMode="decimal" value={doc.kw ? String(doc.kw) : ""} onChange={(e) => up({ kw: Number(amountInput(e.target.value)) || 0 })} placeholder="e.g. 5" />
              </F>
              <F l="Phase">
                <div className="flex gap-2">{STANDARD.phases.map((p) => <Toggle key={p} label={p} on={doc.phase === p} onClick={() => up({ phase: p })} grow />)}</div>
              </F>
              <F l="System type">
                <div className="flex gap-2">{STANDARD.systemTypes.map((s) => <Toggle key={s} label={s} on={doc.system_type === s} onClick={() => up({ system_type: s })} grow />)}</div>
              </F>
              <F l="Solar modules">
                <div className="flex gap-2">
                  <Toggle label="DCR" on={doc.dcr} onClick={() => up({ dcr: true })} grow />
                  <Toggle label="Non-DCR" on={!doc.dcr} onClick={() => up({ dcr: false })} grow />
                </div>
              </F>
              <F l="Electricity tariff (₹ / unit)">
                <input className={input} inputMode="decimal" value={doc.tariff ? String(doc.tariff) : ""} onChange={(e) => up({ tariff: Number(amountInput(e.target.value)) || 0 })} />
              </F>
            </Grid>
          </Block>

          <Block title={lines ? "Items" : "Bill of material"}
            right={<div className="flex gap-2">
              <Toggle label={`Lump sum ${STANDARD.gst}%`} on={!lines} onClick={() => up({ gst_mode: "blended" })} />
              <Toggle label="Per item" on={lines} onClick={() => up({ gst_mode: "lines" })} />
            </div>}>
            <div className="flex flex-col gap-3">
              {doc.items.map((it, i) => {
                const bom = bomOf(it.key);
                const pick = (col: "spec" | "make", value: string) => (
                  bom ? (
                    <SearchableSelect label="" value={value} field={boqField(bom.key, col)} placeholder={col === "spec" ? "Specification" : "Make"}
                      options={merge([value, ...bom[col]].filter(Boolean), boqField(bom.key, col))} onChange={(v) => setItem(i, { [col]: v })} />
                  ) : (
                    <input className={input} value={value} placeholder={col === "spec" ? "Specification" : "Make"} onChange={(e) => setItem(i, { [col]: e.target.value })} />
                  )
                );
                return (
                  <div key={i} className="rounded-xl border border-line p-3 bg-white">
                    <div className={`grid gap-2 items-start ${lines ? "md:grid-cols-[1.1fr_1.6fr_1fr]" : "md:grid-cols-[1.1fr_1.6fr_1fr_0.7fr]"}`}>
                      <input className={input + " font-semibold"} value={it.item} placeholder="Item" onChange={(e) => setItem(i, { item: e.target.value })} />
                      {pick("spec", it.spec)}
                      {pick("make", it.make)}
                      {!lines && <input className={input} value={it.qty} placeholder="Qty" onChange={(e) => setItem(i, { qty: e.target.value })} />}
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {lines && (
                        <>
                          <input className={input + " w-[110px]"} value={it.hsn} placeholder="HSN/SAC" onChange={(e) => setItem(i, { hsn: e.target.value.replace(/\D/g, "").slice(0, 8) })} />
                          <input className={input + " w-[90px]"} value={it.qty} placeholder="Qty" onChange={(e) => setItem(i, { qty: e.target.value })} />
                          <input className={input + " w-[80px]"} value={it.unit} placeholder="Unit" onChange={(e) => setItem(i, { unit: e.target.value })} />
                          <input className={input + " w-[120px] text-right"} inputMode="decimal" value={it.rate ? String(it.rate) : ""} placeholder="Rate"
                            onChange={(e) => setItem(i, { rate: Number(amountInput(e.target.value)) || 0 })} />
                          <select className={input + " w-[90px]"} value={it.gst} onChange={(e) => setItem(i, { gst: Number(e.target.value) })}>
                            {GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}
                          </select>
                          <span className="ml-auto text-[13.5px] font-semibold text-text whitespace-nowrap">{fmtRupees(totals.amounts[i])}</span>
                        </>
                      )}
                      <span className={lines ? "" : "ml-auto"}><RemoveBtn onClick={() => up({ items: doc.items.filter((_, j) => j !== i) })} /></span>
                    </div>
                  </div>
                );
              })}
              <AddItemMenu options={addOptions}
                onPick={(it) => up({ items: [...doc.items, it ?? { item: "", spec: "", make: "", hsn: "", qty: lines ? "1" : "", unit: "", rate: 0, gst: 18 }] })} />
            </div>
          </Block>

          <Block title="Price">
            <Grid>
              {!lines && (
                <F l="System price (before GST)" req><input className={input} inputMode="decimal" value={price} onChange={(e) => amount(setPrice, "price")(e.target.value)} placeholder="e.g. 260000" /></F>
              )}
              <F l="Discount (₹)"><input className={input} inputMode="decimal" value={discount} onChange={(e) => amount(setDiscount, "discount")(e.target.value)} /></F>
              {totals.eligible && (
                <>
                  <F l="Central subsidy (₹)">
                    <input className={input} inputMode="decimal" value={subsidy} placeholder={String(autoSubsidy)}
                      onChange={(e) => { const s = amountInput(e.target.value); setSubsidy(s); up({ subsidy: s === "" ? null : Number(s) || 0 }); }} />
                  </F>
                  <F l="State subsidy (₹)"><input className={input} inputMode="decimal" value={stateSub} onChange={(e) => amount(setStateSub, "state_subsidy")(e.target.value)} /></F>
                </>
              )}
              <F l="DISCOM & net-metering fees">
                <div className="flex gap-2">
                  <Toggle label="In the price" on={doc.discom_included} onClick={() => up({ discom_included: true })} grow />
                  <Toggle label="Paid by customer" on={!doc.discom_included} onClick={() => up({ discom_included: false })} grow />
                </div>
              </F>
            </Grid>
          </Block>

          <Block title="Payment & timeline">
            <F l="Payment schedule"><PaymentRows rows={doc.payment} onChange={(rows) => up({ payment: rows })} /></F>
            <div className="mt-3"><F l="Timeline"><input className={input} value={doc.timeline} onChange={(e) => up({ timeline: e.target.value })} /></F></div>
          </Block>

          <Block title="Warranty">
            <PairRows rows={doc.warranty} onChange={(rows) => up({ warranty: rows })} placeholders={["Component", "Warranty"]} />
          </Block>

          <Block title="Scope of work">
            <Grid>
              <F l="Included in our scope"><textarea className={input + " min-h-[110px]"} value={doc.scope_ours.join("\n")} onChange={(e) => up({ scope_ours: e.target.value.split("\n") })} /></F>
              <F l="Customer's scope"><textarea className={input + " min-h-[110px]"} value={doc.scope_theirs.join("\n")} onChange={(e) => up({ scope_theirs: e.target.value.split("\n") })} /></F>
            </Grid>
          </Block>

          <Block title="Terms & notes">
            <F l="Terms & conditions"><textarea className={input + " min-h-[110px]"} value={doc.terms} onChange={(e) => up({ terms: e.target.value })} /></F>
            <div className="mt-3"><F l="Notes"><textarea className={input + " min-h-[64px]"} value={doc.notes} onChange={(e) => up({ notes: e.target.value })} /></F></div>
            <div className="mt-3 flex gap-2 flex-wrap">
              <Toggle label="Savings page" on={doc.show_savings} onClick={() => up({ show_savings: !doc.show_savings })} />
              <Toggle label="EMI box" on={doc.show_emi} onClick={() => up({ show_emi: !doc.show_emi })} />
            </div>
          </Block>
        </div>

        {/* Live totals */}
        <aside className="xl:sticky xl:top-20 bg-white rounded-2xl border border-line p-5">
          <div className="text-[13px] font-semibold text-[#0f3d2e] mb-3">Summary</div>
          <Sum l={lines ? "Sub total" : "System price"} v={totals.base} />
          {!!totals.discount && <Sum l="Discount" v={-totals.discount} />}
          {totals.taxes.map(({ rate, amount }) => totals.intra ? (
            <div key={rate}>
              <Sum l={`CGST @ ${rate / 2}%`} v={Math.round(amount / 2)} />
              <Sum l={`SGST @ ${rate / 2}%`} v={amount - Math.round(amount / 2)} />
            </div>
          ) : <Sum key={rate} l={`IGST @ ${rate}%`} v={amount} />)}
          <div className="border-t border-line my-2" />
          <Sum l="Total" v={totals.total} strong />
          {resi && totals.eligible && (
            <>
              <Sum l="Central subsidy" v={-totals.central} />
              {!!totals.state && <Sum l="State subsidy" v={-totals.state} />}
              <Sum l="After subsidy" v={totals.net} strong />
            </>
          )}
          {pays > 0 && <p className="text-[12px] text-text-muted mt-2">{rupeesInWords(Math.round(pays))}</p>}
          {totals.perKw > 0 && (
            <>
              <div className="border-t border-line my-3" />
              <Sum l="Per kW (incl. GST)" v={totals.perKw} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

const ghost = "px-4 py-2.5 rounded-xl border border-line bg-white text-[13.5px] font-semibold text-[#0f3d2e] hover:bg-bg-soft disabled:opacity-60";

function Block({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-line p-5 mb-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-[14px] font-semibold text-[#0f3d2e]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
// "+ Add item ▾" — a standard row or a usual extra from the list, or a blank row to write your own.
function AddItemMenu({ options, onPick }: { options: { label: string; item: QuoteItem }[]; onPick: (it: QuoteItem | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const pick = (it: QuoteItem | null) => { setOpen(false); onPick(it ? { ...it } : null); };
  const opt = "block w-full text-left px-4 py-2 text-[13px] hover:bg-[#f0f5fc]";
  return (
    <div className="relative self-start" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-[13px] font-semibold text-[#1e3a8a] hover:underline inline-flex items-center gap-1">
        + Add item
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-64 max-h-72 overflow-y-auto bg-white border border-line rounded-xl shadow-lg py-1">
          {options.map((o) => <button key={o.label} type="button" onClick={() => pick(o.item)} className={opt + " text-text"}>{o.label}</button>)}
          <button type="button" onClick={() => pick(null)} className={opt + " font-semibold text-[#1e3a8a]" + (options.length ? " border-t border-line" : "")}>Write your own</button>
        </div>
      )}
    </div>
  );
}

function F({ l, req, opt, wide, children }: { l: string; req?: boolean; opt?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div className={"flex flex-col gap-1 min-w-0" + (wide ? " sm:col-span-2" : "")}>
      <span className="text-[12.5px] font-medium text-text-mid">{l}{req && <span className="text-red-500"> *</span>}{opt && <span className="font-normal text-text-muted"> (optional)</span>}</span>
      {children}
    </div>
  );
}
function Sum({ l, v, text, strong }: { l: string; v?: number; text?: string; strong?: boolean }) {
  return (
    <div className={"flex items-center justify-between gap-3 py-1 " + (strong ? "text-[15px] font-bold text-[#0f3d2e]" : "text-[13.5px] text-text")}>
      <span className={strong ? "" : "text-text-mid"}>{l}</span>
      <span className="whitespace-nowrap">{text ?? (v! < 0 ? `- ${fmtRupees(-v!)}` : fmtRupees(v))}</span>
    </div>
  );
}
