"use client";

// EPC onboarding chat · the members dock (Step 3): a card per proprietor /
// partner / director, each with PAN + Aadhaar uploads read by extract-stakeholder.

import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth";
import FileUpload from "@/components/FileUpload";
import DateField from "@/components/ui/DateField";
import { toIsoDate } from "@/lib/dates";
import { clearChatDraft, loadChatDraft, saveChatDraft } from "@/lib/chat-draft";
import type { Stakeholder } from "@/lib/epc-stakeholders";

// ── Stakeholders dock — mirrors classic onboarding step-3 (cards per member,
// PAN/Aadhaar upload with OCR via the extract-stakeholder route). ──
type StkCfg = { roleLabel: string; addLabel: string | null; defDesig: string; minRows: number; maxRows: number };
function configFor(bt?: string): StkCfg {
  switch (bt) {
    case "proprietorship": return { roleLabel: "Proprietor", addLabel: null, defDesig: "Proprietor", minRows: 1, maxRows: 1 };
    case "pvt_ltd": return { roleLabel: "Director", addLabel: "+ Add Director", defDesig: "Director", minRows: 2, maxRows: Infinity };
    case "partnership":
    case "llp": return { roleLabel: "Partner", addLabel: "+ Add Partner", defDesig: "Partner", minRows: 2, maxRows: Infinity };
    default: return { roleLabel: "Member", addLabel: "+ Add Member", defDesig: "", minRows: 1, maxRows: Infinity };
  }
}
function emptyMember(desig: string): Stakeholder {
  return { id: crypto.randomUUID(), name: "", designation: desig, mobile: "", email: "", father_name: "", dob: "", aadhaar_number: "", aadhaar_address: "" };
}

export default function StakeholdersDock({ epcId, businessType, initial, busy, onContinue }: {
  epcId: string; businessType?: string; initial: Stakeholder[]; busy: boolean; onContinue: (list: Stakeholder[]) => void;
}) {
  const cfg = configFor(businessType);
  // Members being filled in are kept in this browser (lib/chat-draft) until
  // "Save members & continue" — a refresh keeps every Aadhaar / PAN read so far,
  // and the same member ids keep their uploaded documents.
  const memberDraft = `cc_chat:epc_members:${epcId}`;
  const [list, setList] = useState<Stakeholder[]>(() => {
    const d = loadChatDraft<Stakeholder[]>(memberDraft);
    return d?.length ? d : initial.length ? initial : [emptyMember(cfg.defDesig)];
  });
  useEffect(() => { saveChatDraft(memberDraft, list); }, [memberDraft, list]);
  const [stkError, setStkError] = useState<string | null>(null);
  const [panKey, setPanKey] = useState(0); // remounts the proprietor's PAN slot once it's filed

  // Proprietorship: the business PAN IS the proprietor's PAN — file it for them
  // (and read it) instead of asking for the same card again.
  useEffect(() => {
    const id = list[0]?.id;
    if (businessType !== "proprietorship" || !id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/epc/${epcId}/proprietor-pan`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ stakeholder_id: id }),
        });
        const j = await res.json().catch(() => ({}));
        if (!j?.ok || !j.copied) return;
        setPanKey((k) => k + 1);
        fillMember(id, "pan", (j.fields ?? {}) as Record<string, string>);
      } catch { /* the PAN slot stays a normal upload */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(id: string, key: keyof Omit<Stakeholder, "id">, value: string) {
    setList((arr) => arr.map((s) => (s.id === id ? { ...s, [key]: value } : s)));
  }
  function add() { setList((arr) => [...arr, emptyMember(cfg.defDesig)]); }
  function remove(id: string) { setList((arr) => arr.filter((s) => s.id !== id)); }

  // OCR a just-uploaded member document and fill that member's empty fields.
  async function ocrMember(id: string, kind: "pan" | "aadhaar_front" | "aadhaar_back", file: File) {
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch(`/api/admin/epc/${epcId}/extract-stakeholder`, { method: "POST", headers: authHeaders(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!j?.ok || !j.fields) return;
      fillMember(id, kind, j.fields as Record<string, string>);
    } catch { /* silent — the RM can type the fields */ }
  }

  // Fill a member's EMPTY fields from what a PAN / Aadhaar read returned.
  function fillMember(id: string, kind: "pan" | "aadhaar_front" | "aadhaar_back", fx: Record<string, string>) {
    setList((arr) => arr.map((s) => {
      if (s.id !== id) return s;
      const n = { ...s };
      if (kind === "pan") {
        if (!n.name && fx.name) n.name = fx.name;
        if (!n.father_name && fx.father_name) n.father_name = fx.father_name;
        if (!n.dob && fx.dob) n.dob = toIsoDate(fx.dob) || fx.dob;
      } else if (kind === "aadhaar_front") {
        if (!n.name && fx.name) n.name = fx.name;
        if (!n.dob && fx.dob) n.dob = toIsoDate(fx.dob) || fx.dob;
        if (!n.aadhaar_number && fx.aadhaar_number) n.aadhaar_number = fx.aadhaar_number;
      } else if (kind === "aadhaar_back") {
        if (!n.aadhaar_address && fx.address) n.aadhaar_address = fx.address;
      }
      return n;
    }));
  }

  function cont() {
    const cleaned = list
      .filter((s) => s.name.trim() || s.mobile.trim())
      .map((s) => ({
        ...s, name: s.name.trim(), designation: s.designation.trim() || cfg.defDesig, mobile: s.mobile.trim(),
        email: s.email.trim(), father_name: s.father_name.trim(), dob: s.dob.trim(), aadhaar_number: s.aadhaar_number.trim(), aadhaar_address: s.aadhaar_address.trim(),
      }));
    // Proper data: every kept member needs a name, and the entity's minimum
    // (Pvt Ltd / partnership / LLP = 2) must be met — same rule as the classic form.
    if (cleaned.some((s) => !s.name)) { setStkError("Every member needs a name (or remove the empty row)."); return; }
    if (cleaned.length < cfg.minRows) { setStkError(`Add at least ${cfg.minRows} ${cfg.roleLabel.toLowerCase()}${cfg.minRows > 1 ? "s" : ""}.`); return; }
    setStkError(null);
    clearChatDraft(memberDraft); // saved on the profile from here
    onContinue(cleaned);
  }

  return (
    <div className="flex flex-col gap-3 max-h-[56vh] overflow-y-auto pr-0.5">
      <div className="text-[12px] text-text-muted">{cfg.roleLabel} details{cfg.minRows > 1 ? ` — add at least ${cfg.minRows}` : ""}.</div>
      {list.map((s, i) => (
        <div key={s.id} className="rounded-xl border border-line bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold text-text">{cfg.roleLabel} {list.length > 1 ? i + 1 : ""}</span>
            {list.length > 1 && <button onClick={() => remove(s.id)} className="text-[12px] text-text-muted hover:text-red-500">Delete</button>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={s.name} onChange={(e) => update(s.id, "name", e.target.value)} placeholder="Name" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <input value={s.designation} onChange={(e) => update(s.id, "designation", e.target.value)} placeholder="Designation" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <input value={s.mobile} onChange={(e) => update(s.id, "mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="Mobile" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <input value={s.email} onChange={(e) => update(s.id, "email", e.target.value)} placeholder="Email" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <input value={s.father_name} onChange={(e) => update(s.id, "father_name", e.target.value)} placeholder="Father's name" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <DateField value={toIsoDate(s.dob) ?? ""} onChange={(iso) => update(s.id, "dob", iso)} className="rounded-lg border border-line py-2 text-[13px] px-2.5 outline-none focus:border-[#185fa5]" />
            <input value={s.aadhaar_number} onChange={(e) => update(s.id, "aadhaar_number", e.target.value.replace(/\D/g, "").slice(0, 12))} inputMode="numeric" placeholder="Aadhaar no." className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
            <input value={s.aadhaar_address} onChange={(e) => update(s.id, "aadhaar_address", e.target.value)} placeholder="Address (as per Aadhaar)" className="border border-line rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#185fa5]" />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <div className="rounded-lg border border-line p-2">
              <FileUpload key={`pan-${s.id}-${panKey}`} businessId={epcId} stakeholderId={s.id} table="epc_documents" category="stakeholder_pan" maxFiles={1} uploadedBy="admin" label="PAN" onUploaded={({ file }) => void ocrMember(s.id, "pan", file)} />
            </div>
            <div className="rounded-lg border border-line p-2">
              <FileUpload businessId={epcId} stakeholderId={s.id} table="epc_documents" category={"stakeholder_aadhaar_front" as any} maxFiles={1} uploadedBy="admin" label="Aadhaar front" onUploaded={({ file }) => void ocrMember(s.id, "aadhaar_front", file)} />
            </div>
            <div className="rounded-lg border border-line p-2">
              <FileUpload businessId={epcId} stakeholderId={s.id} table="epc_documents" category={"stakeholder_aadhaar_back" as any} maxFiles={1} uploadedBy="admin" label="Aadhaar back" onUploaded={({ file }) => void ocrMember(s.id, "aadhaar_back", file)} />
            </div>
          </div>
        </div>
      ))}
      {stkError && <div className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">{stkError}</div>}
      <div className="flex items-center gap-2">
        {cfg.addLabel && list.length < cfg.maxRows && <button onClick={add} className="px-3 py-2 rounded-lg border border-line text-[13px] text-text-mid hover:border-[#185fa5]">{cfg.addLabel}</button>}
        <button onClick={cont} disabled={busy} className="ml-auto px-4 py-2 rounded-lg bg-[#185fa5] text-white text-[13px] font-semibold hover:bg-[#124a82] disabled:opacity-60">Save members & continue →</button>
      </div>
    </div>
  );
}
