"use client";

// Settings → Quotation preferences — what every new quotation starts with:
// the number series, how GST is charged, and per kind (residential /
// commercial) the validity, timeline and payment schedule; then the warranty
// rows, terms and notes. Each quotation can still be changed on its own.

import { useEffect, useState } from "react";
import { Card, Row, SaveBar } from "@/components/partner/SettingsKit";
import { PaymentRows, PairRows, paymentTotal } from "@/components/partner/RowEditors";
import { input, Toggle } from "@/components/quotation/form-kit";
import { fetchOrgSettings, saveOrgSettings } from "@/lib/org-settings";
import { resolveQuoteDefaults, type OrgProfile } from "@/lib/org-profile";
import { STANDARD, type PaymentStage, type Segment } from "@/lib/quotation-brands";

const SEGMENTS: [Segment, string][] = [["residential", "Residential"], ["commercial", "Commercial"]];
type Prefs = {
  prefix: string; next: string; gst_mode: OrgProfile["gst_mode"];
  validity: Record<Segment, string>; timeline: Record<Segment, string>; payment: Record<Segment, PaymentStage[]>;
  warranty: [string, string][]; terms: string; notes: string;
};

function fromProfile(p: OrgProfile): Prefs {
  const r = resolveQuoteDefaults(p, "residential"), c = resolveQuoteDefaults(p, "commercial");
  return {
    prefix: p.quote_prefix, next: String(p.quote_next), gst_mode: p.gst_mode,
    validity: { residential: String(r.validity), commercial: String(c.validity) },
    timeline: { residential: r.timeline, commercial: c.timeline },
    payment: { residential: r.payment.map((x) => [...x] as PaymentStage), commercial: c.payment.map((x) => [...x] as PaymentStage) },
    warranty: r.warranty.map((x) => [...x] as [string, string]), terms: r.terms, notes: r.notes,
  };
}

export default function QuotePreferences() {
  const [f, setF] = useState<Prefs | null>(null);
  const [seg, setSeg] = useState<Segment>("residential");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchOrgSettings().then((p) => setF(fromProfile(p)), () => setFailed(true)); }, []);

  if (failed) return <p className="text-[13px] text-red-600">Couldn&apos;t load your preferences. Please refresh.</p>;
  if (!f) return <p className="text-[13px] text-text-muted">Loading…</p>;

  const up = (patch: Partial<Prefs>) => { setF({ ...f, ...patch }); setSaved(false); };

  async function save() {
    if (!f) return;
    const next = Math.floor(Number(f.next));
    if (!(next >= 1)) { setError("The next number must be 1 or more."); return; }
    for (const [s, label] of SEGMENTS) {
      if (Math.abs(paymentTotal(f.payment[s]) - 100) > 0.001) { setError(`${label} payment schedule must add up to 100%.`); setSeg(s); return; }
      if (!(Number(f.validity[s]) >= 1)) { setError(`${label} validity must be at least 1 day.`); setSeg(s); return; }
    }
    setBusy(true); setError(null);
    try {
      await saveOrgSettings({
        quote_prefix: f.prefix.trim(), quote_next: next, gst_mode: f.gst_mode,
        quote_defaults: {
          validity: { residential: Number(f.validity.residential), commercial: Number(f.validity.commercial) },
          timeline: { residential: f.timeline.residential.trim(), commercial: f.timeline.commercial.trim() },
          payment: {
            residential: f.payment.residential.filter(([s]) => s.trim()).map(([s, p]) => [s.trim(), Number(p) || 0]),
            commercial: f.payment.commercial.filter(([s]) => s.trim()).map(([s, p]) => [s.trim(), Number(p) || 0]),
          },
          warranty: f.warranty.filter(([a, b]) => a.trim() && b.trim()).map(([a, b]) => [a.trim(), b.trim()]),
          terms: f.terms.trim(), notes: f.notes.trim(),
        },
      });
      setSaved(true);
    } catch (e) { setError((e as Error)?.message || "Couldn't save."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Card title="Quotation number">
        <Row label="Prefix"><input className={input + " max-w-[200px]"} value={f.prefix} onChange={(e) => up({ prefix: e.target.value })} /></Row>
        <Row label="Next number">
          <div className="flex items-center gap-3">
            <input className={input + " max-w-[140px]"} inputMode="numeric" value={f.next} onChange={(e) => up({ next: e.target.value.replace(/\D/g, "") })} />
            <span className="text-[13px] text-text-muted">{`${f.prefix}${f.next || 1}`}</span>
          </div>
        </Row>
      </Card>

      <Card title="GST">
        <Row label="Charge GST">
          <div className="flex gap-2 flex-wrap">
            <Toggle label={`Lump sum (${STANDARD.gst}%)`} on={f.gst_mode === "blended"} onClick={() => up({ gst_mode: "blended" })} />
            <Toggle label="Per item" on={f.gst_mode === "lines"} onClick={() => up({ gst_mode: "lines" })} />
          </div>
        </Row>
      </Card>

      <Card title="Validity, timeline & payment"
        right={<div className="flex gap-2">{SEGMENTS.map(([s, label]) => <Toggle key={s} label={label} on={seg === s} onClick={() => setSeg(s)} />)}</div>}>
        <Row label="Valid for (days)">
          <input className={input + " max-w-[140px]"} inputMode="numeric" value={f.validity[seg]}
            onChange={(e) => up({ validity: { ...f.validity, [seg]: e.target.value.replace(/\D/g, "") } })} />
        </Row>
        <Row label="Timeline">
          <input className={input} value={f.timeline[seg]} onChange={(e) => up({ timeline: { ...f.timeline, [seg]: e.target.value } })} />
        </Row>
        <Row label="Payment schedule">
          <PaymentRows rows={f.payment[seg]} onChange={(rows) => up({ payment: { ...f.payment, [seg]: rows } })} />
        </Row>
      </Card>

      <Card title="Warranty">
        <PairRows rows={f.warranty} onChange={(rows) => up({ warranty: rows })} placeholders={["Component", "Warranty"]} />
      </Card>

      <Card title="Terms & notes">
        <Row label="Terms & conditions">
          <textarea className={input + " min-h-[120px]"} value={f.terms} onChange={(e) => up({ terms: e.target.value })} />
        </Row>
        <Row label="Notes">
          <textarea className={input + " min-h-[72px]"} value={f.notes} onChange={(e) => up({ notes: e.target.value })} />
        </Row>
      </Card>

      <SaveBar busy={busy} saved={saved} error={error} onSave={() => void save()} />
    </>
  );
}

