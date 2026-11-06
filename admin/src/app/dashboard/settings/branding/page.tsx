"use client";

// Settings → Branding — the partner's logo (portal + quotations), the accent
// colour of its quotations, and the signature + stamp printed on them.

import { useEffect, useState } from "react";
import { Card, Row } from "@/components/partner/SettingsKit";
import OrgImageSlot from "@/components/partner/OrgImageSlot";
import { NAVY } from "@/components/partner/PartnerShell";
import { fetchKyc, fetchOrgSettings, saveOrgSettings } from "@/lib/org-settings";
import { ACCENTS, type OrgProfile } from "@/lib/org-profile";

export default function BrandingSettings() {
  const [p, setP] = useState<OrgProfile | null>(null);
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    fetchOrgSettings().then(setP, () => setFailed(true));
    fetchKyc().then((k) => setName(k.trade_name || k.legal_name || ""), () => {});
  }, []);

  if (failed) return <p className="text-[13px] text-red-600">Couldn&apos;t load your branding. Please refresh.</p>;
  if (!p) return <p className="text-[13px] text-text-muted">Loading…</p>;

  const accent = p.accent || ACCENTS[0];
  async function pick(c: string) {
    if (!p || c.toLowerCase() === accent.toLowerCase()) return;
    setError(null);
    try { setP(await saveOrgSettings({ accent: c })); }
    catch (e) { setError((e as Error)?.message || "Couldn't save."); }
  }
  const initial = (
    <span className="font-display font-bold text-[40px] text-white w-full h-full grid place-items-center" style={{ background: NAVY }}>
      {(p.display_name || name || "C").slice(0, 1).toUpperCase()}
    </span>
  );
  const blank = <span className="text-[12px] text-text-muted">—</span>;

  return (
    <>
      <Card title="Organization logo">
        <OrgImageSlot kind="logo" path={p.logo_path} empty={initial} onChange={(v) => setP({ ...p, logo_path: v })} />
      </Card>

      <Card title="Accent colour">
        <Row label="Quotation colour">
          <div className="flex items-center gap-2.5 flex-wrap">
            {ACCENTS.map((c) => {
              const on = c.toLowerCase() === accent.toLowerCase();
              return (
                <button key={c} type="button" onClick={() => void pick(c)} aria-label={c} title={c}
                  className={["w-9 h-9 rounded-full border-2 grid place-items-center", on ? "border-[#0f3d2e]" : "border-transparent"].join(" ")}>
                  <span className="w-7 h-7 rounded-full block" style={{ background: c }} />
                </button>
              );
            })}
            {/* Custom: previewed while dragging, saved once when the picker closes. */}
            <label className="relative w-9 h-9 rounded-full border-2 border-dashed border-line grid place-items-center cursor-pointer overflow-hidden" title="Custom colour">
              <input type="color" value={draft ?? accent} onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (draft) void pick(draft); setDraft(null); }}
                className="absolute inset-0 w-full h-full cursor-pointer opacity-0" />
              <span className="w-7 h-7 rounded-full block" style={{ background: draft ?? (ACCENTS.some((c) => c.toLowerCase() === accent.toLowerCase()) ? "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" : accent) }} />
            </label>
          </div>
          {error && <p className="text-[12.5px] text-red-600 mt-2">{error}</p>}
        </Row>
      </Card>

      <Card title="Signature & stamp">
        <Row label="Authorised signature">
          <OrgImageSlot kind="signature" path={p.signature_path} empty={blank} onChange={(v) => setP({ ...p, signature_path: v })} />
        </Row>
        <Row label="Company stamp">
          <OrgImageSlot kind="stamp" path={p.stamp_path} empty={blank} onChange={(v) => setP({ ...p, stamp_path: v })} />
        </Row>
      </Card>
    </>
  );
}
