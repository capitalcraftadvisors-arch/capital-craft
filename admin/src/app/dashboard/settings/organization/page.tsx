"use client";

// Settings → Organization — the partner's organization profile: the details it
// shows on its quotations (editable; first filled from its KYC) and the details
// CC verified at onboarding (read-only).

import { useEffect, useState } from "react";
import { Card, Row, Value, SaveBar } from "@/components/partner/SettingsKit";
import { input } from "@/components/quotation/form-kit";
import { fetchKyc, fetchOrgSettings, saveOrgSettings, type Kyc } from "@/lib/org-settings";
import { type OrgProfile } from "@/lib/org-profile";
import { BUSINESS_TYPE_LABEL, maskAcct, peopleHeading } from "@/lib/epc-labels";
import { INDIA_STATES, stateOfGstin } from "@/lib/india-states";
import { formatGstAddress } from "@/lib/gst-address";

type Fields = Pick<OrgProfile, "display_name" | "address_line" | "city" | "state" | "pincode" | "phone" | "email" | "website">;
type Person = { name?: string | null; mobile?: string | null; email?: string | null };

// Saved details, else the KYC's — so a first visit shows a filled form.
function initial(p: OrgProfile, k: Kyc): Record<keyof Fields, string> {
  return {
    display_name: p.display_name ?? k.trade_name ?? k.legal_name ?? "",
    address_line: p.address_line ?? formatGstAddress(k.gst_address) ?? "",
    city: p.city ?? "",
    state: p.state ?? stateOfGstin(k.gstin_number),
    pincode: p.pincode ?? (/\b\d{6}\b/.exec(String(k.gst_address ?? ""))?.[0] ?? ""),
    phone: p.phone ?? k.contact_mobile ?? "",
    email: p.email ?? k.contact_email ?? "",
    website: p.website ?? "",
  };
}

export default function OrganizationSettings() {
  const [kyc, setKyc] = useState<Kyc | null>(null);
  const [f, setF] = useState<Record<keyof Fields, string> | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchOrgSettings(), fetchKyc()]).then(([p, k]) => { setKyc(k); setF(initial(p, k)); }, () => setFailed(true));
  }, []);

  if (failed) return <p className="text-[13px] text-red-600">Couldn&apos;t load your organization. Please refresh.</p>;
  if (!kyc || !f) return <p className="text-[13px] text-text-muted">Loading…</p>;

  const set = (k: keyof Fields, v: string) => { setF({ ...f, [k]: v }); setSaved(false); };
  async function save() {
    if (!f) return;
    if (!f.display_name.trim()) { setError("Enter the organization name."); return; }
    setBusy(true); setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])) as Partial<OrgProfile>;
      await saveOrgSettings(clean);
      setSaved(true);
    } catch (e) { setError((e as Error)?.message || "Couldn't save."); }
    finally { setBusy(false); }
  }

  const people = ((kyc.stakeholders ?? []) as Person[]).filter((p) => p?.name);
  return (
    <>
      <Card title="Organization profile">
        <Row label="Organization name"><input className={input} value={f.display_name} onChange={(e) => set("display_name", e.target.value)} /></Row>
        <Row label="Address">
          <div className="flex flex-col gap-2">
            <textarea className={input + " min-h-[64px]"} value={f.address_line} onChange={(e) => set("address_line", e.target.value)} placeholder="Street, area" />
            <div className="grid grid-cols-2 gap-2">
              <input className={input} value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="City" />
              <input className={input} inputMode="numeric" value={f.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="PIN code" />
            </div>
            <select className={input} value={f.state} onChange={(e) => set("state", e.target.value)}>
              <option value="">State</option>
              {INDIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </Row>
        <Row label="Phone"><input className={input} inputMode="numeric" value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} /></Row>
        <Row label="Email"><input className={input} type="email" value={f.email} onChange={(e) => set("email", e.target.value.trim())} /></Row>
        <Row label="Website"><input className={input} value={f.website} onChange={(e) => set("website", e.target.value.trim())} placeholder="www.example.com" /></Row>
        <div className="pt-1"><SaveBar busy={busy} saved={saved} error={error} onSave={() => void save()} /></div>
      </Card>

      <Card title="Registered details">
        <Value label="Legal name" v={kyc.legal_name} />
        <Value label="Trade name" v={kyc.trade_name} />
        <Value label="Constitution" v={BUSINESS_TYPE_LABEL[kyc.business_type ?? ""] ?? kyc.business_type} />
        <Value label="Partner ID" v={kyc.epc_display_id} />
        <Value label="PAN" v={kyc.pan_number} />
        <Value label="GSTIN" v={kyc.gstin_number} />
        <Value label="GST address" v={formatGstAddress(kyc.gst_address)} />
      </Card>

      <Card title="Primary contact">
        <Value label="Name" v={kyc.contact_name} />
        <Value label="Designation" v={kyc.contact_designation} />
        <Value label="Mobile" v={kyc.contact_mobile ? `+91 ${kyc.contact_mobile}` : null} />
        <Value label="Email" v={kyc.contact_email} />
      </Card>

      {people.length > 0 && (
        <Card title={peopleHeading(kyc.business_type)}>
          {people.map((p, i) => <Value key={i} label={p.name || ""} v={[p.mobile ? `+91 ${p.mobile}` : null, p.email].filter(Boolean).join(" · ")} />)}
        </Card>
      )}

      <Card title="Bank">
        <Value label="Bank" v={kyc.bank_name} />
        <Value label="Account holder" v={kyc.bank_account_holder} />
        <Value label="Account no." v={kyc.bank_account_number ? maskAcct(kyc.bank_account_number) : null} />
        <Value label="IFSC" v={kyc.bank_ifsc} />
        <Value label="Branch" v={kyc.bank_branch} />
      </Card>
    </>
  );
}
