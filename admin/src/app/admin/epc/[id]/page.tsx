"use client";

// Admin EPC detail page with inline edit on every field except contact_mobile
// (which is the login key — read-only by spec).
//
// Sections:
//   Personal · Business · Bank · Members · Office · References · Documents
//   plus the unchanged GstR3bSection (admin-only) and Review actions card.
//
// Edits flow:
//   - Per-field "Edit" affordance via <EditableField/> → onSave updates
//     epc_business via PostgREST (admin's JWT → admin_all_business RLS)
//     and writes one admin_edit_log row via lib/auditLog.
//   - Members and References (JSONB arrays) use a section-level Save with a
//     coarse 'members_edited' / 'references_edited' audit entry per the spec.
//   - Documents use <AdminDocSlot/> per category. Upload / View / Replace
//     / Remove. The replace path uses /api/upload?replace=true so per-
//     category unique indexes don't trip.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import GstR3bSection from "@/components/GstR3bSection";
import EpcAdminInfoSection from "@/components/EpcAdminInfoSection";
import EditableField from "@/components/EditableField";
import AdminDocSlot from "@/components/AdminDocSlot";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/auditLog";
import { EMAIL_RE, PAN_RE, MOBILE_RE, IFSC_RE, ACCOUNT_RE } from "@/lib/validators";

type Biz = Record<string, any>;
type Stakeholder = { id: string; name: string; designation: string; mobile: string; email: string };
type Reference = { type: "customer" | "supplier"; name: string; mobile: string };

// Backward-compat: legacy stakeholder rows may be missing mobile/email.
function normStakeholder(raw: unknown): Stakeholder {
  const r = raw as Record<string, unknown>;
  return {
    id: (r.id as string) ?? "",
    name: (r.name as string) ?? "",
    designation: (r.designation as string) ?? "",
    mobile: (r.mobile as string) ?? "",
    email: (r.email as string) ?? "",
  };
}

const BUSINESS_TYPE_OPTIONS = [
  { value: "proprietorship", label: "Proprietorship" },
  { value: "pvt_ltd",        label: "Private Limited" },
  { value: "partnership",    label: "Partnership" },
  { value: "llp",            label: "LLP" },
];

const DESIGNATION_OPTIONS = [
  { value: "Partner",    label: "Partner" },
  { value: "Director",   label: "Director" },
  { value: "Proprietor", label: "Proprietor" },
  { value: "Owner",      label: "Owner" },
  { value: "Manager",    label: "Manager" },
];

export default function AdminEpcDetailPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const [biz, setBiz] = useState<Biz | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, [params.id]);

  async function load() {
    const { data: b } = await supabase().from("epc_business").select("*").eq("id", params.id).maybeSingle();
    setBiz(b);
  }

  // Generic field-update helper used by EditableField onSave callbacks.
  // Saves the new value via PostgREST, writes one audit row, refreshes
  // local state.
  function saveField(column: string) {
    return async (next: string) => {
      const oldVal = biz?.[column] ?? null;
      const newVal = next === "" ? null : next;
      const { error } = await supabase()
        .from("epc_business")
        .update({ [column]: newVal })
        .eq("id", params.id);
      if (error) throw error;
      await logAudit(params.id, "field_edit", column, oldVal, newVal);
      setBiz((b) => (b ? { ...b, [column]: newVal } : b));
    };
  }

  // Members and References use coarse section-level saves per spec.
  async function saveStakeholders(next: Stakeholder[]) {
    const { error } = await supabase()
      .from("epc_business")
      .update({ stakeholders: next })
      .eq("id", params.id);
    if (error) throw error;
    await logAudit(params.id, "members_edited", "stakeholders");
    setBiz((b) => (b ? { ...b, stakeholders: next } : b));
  }
  async function saveReferences(next: Reference[]) {
    const { error } = await supabase()
      .from("epc_business")
      .update({ business_references: next })
      .eq("id", params.id);
    if (error) throw error;
    await logAudit(params.id, "references_edited", "business_references");
    setBiz((b) => (b ? { ...b, business_references: next } : b));
  }

  async function changeStatus(next: "approved" | "on_hold" | "rejected" | "under_review") {
    if (!biz) return;
    setBusy(true);
    await supabase().from("epc_business").update({ status: next }).eq("id", biz.id);
    await logAudit(biz.id, "field_edit", "status", biz.status, next);
    setBusy(false);
    void load();
  }

  if (!biz) return null;

  const isPartnership = biz.business_type === "partnership";
  const isPvtLtd      = biz.business_type === "pvt_ltd";
  const isLlp         = biz.business_type === "llp";
  const extraDocLabel =
    isPartnership ? "Partnership Deed"
    : isPvtLtd    ? "Certificate of Incorporation"
    : isLlp       ? "LLP Agreement"
    : null;

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <span className="font-display font-bold text-[20px] grad-text">Capital Craft / Admin</span>
          <a href="/admin" className="text-[13px] text-text-muted hover:text-text">← Back</a>
        </div>
      </header>

      <section className="max-w-[1000px] mx-auto px-5 sm:px-7 py-10 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-[26px] sm:text-[30px] font-bold">{biz.contact_name || "EPC"}</h1>
            <p className="text-text-mid mt-1">+91 {biz.contact_mobile} · {biz.business_type || "—"}</p>
          </div>
          <StatusBadge status={biz.status} updated={biz.epc_self_edited === true} />
        </div>

        <Section title="Personal">
          <EditableField
            label="Point of contact"
            value={biz.contact_name}
            onSave={saveField("contact_name")}
            validate={(v) => (v.length < 2 ? "Name is too short" : v.length > 80 ? "Too long" : null)}
          />
          <EditableField
            label="Email"
            value={biz.contact_email}
            type="email"
            onSave={saveField("contact_email")}
            validate={(v) => (!v ? "Email required" : EMAIL_RE.test(v) ? null : "Invalid email")}
          />
          <EditableField
            label="Mobile (login key)"
            value={biz.contact_mobile}
            readOnly
            onSave={async () => {}}
          />
          <EditableField
            label="Designation"
            value={biz.contact_designation}
            options={DESIGNATION_OPTIONS}
            onSave={saveField("contact_designation")}
          />
        </Section>

        <Section title="Business">
          <EditableField
            label="Business type"
            value={biz.business_type}
            display={(v) => v ? (BUSINESS_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v) : ""}
            options={BUSINESS_TYPE_OPTIONS}
            onSave={saveField("business_type")}
          />
          <EditableField
            label="Legal name"
            value={biz.legal_name}
            onSave={saveField("legal_name")}
            hint="Auto-filled from the EPC's GST registration document. Edit if OCR misread."
          />
          <EditableField
            label="Trade name"
            value={biz.trade_name}
            onSave={saveField("trade_name")}
            hint="Auto-filled from the EPC's GST registration document. Optional."
          />
          <EditableField
            label="PAN"
            value={biz.pan_number}
            onSave={async (v) => saveField("pan_number")(v.toUpperCase())}
            validate={(v) => (!v ? null : PAN_RE.test(v.toUpperCase()) ? null : "Invalid PAN (AAAAA9999A)")}
          />
        </Section>

        <Section title="Bank">
          <EditableField
            label="Account number"
            value={biz.bank_account_number}
            onSave={saveField("bank_account_number")}
            validate={(v) => (!v ? null : ACCOUNT_RE.test(v) ? null : "9-18 digits")}
          />
          <EditableField
            label="IFSC"
            value={biz.bank_ifsc}
            onSave={async (v) => saveField("bank_ifsc")(v.toUpperCase())}
            validate={(v) => (!v ? null : IFSC_RE.test(v.toUpperCase()) ? null : "Invalid IFSC")}
          />
          <EditableField label="Branch" value={biz.bank_branch} onSave={saveField("bank_branch")} />
          <EditableField label="Bank name" value={biz.bank_name} onSave={saveField("bank_name")} />
          <EditableField label="Account holder" value={biz.bank_account_holder} onSave={saveField("bank_account_holder")} />
          <div className="mt-3">
            <AdminDocSlot businessId={params.id} category="cancelled_cheque" label="Cancelled cheque" />
          </div>
        </Section>

        <Section title="Members">
          <MembersEditor
            value={((biz.stakeholders ?? []) as unknown[]).map(normStakeholder)}
            onSave={saveStakeholders}
            businessId={params.id}
          />
        </Section>

        <Section title="Office verification">
          <div className="grid sm:grid-cols-3 gap-3">
            <AdminDocSlot businessId={params.id} category="office_exterior" label="Exterior (signboard)" />
            <AdminDocSlot businessId={params.id} category="office_interior" label="Interior" />
            <AdminDocSlot businessId={params.id} category="office_selfie"   label="Selfie at office" />
          </div>
        </Section>

        <Section title="References">
          <ReferencesEditor
            value={(biz.business_references ?? []) as Reference[]}
            onSave={saveReferences}
          />
        </Section>

        <Section title="Documents">
          <div className="grid sm:grid-cols-2 gap-3">
            <AdminDocSlot businessId={params.id} category="pan_business" label="PAN card" />
            <AdminDocSlot businessId={params.id} category="gstin"        label="GST registration document" />
            {extraDocLabel && (
              <AdminDocSlot businessId={params.id} category="extra_doc" label={extraDocLabel} />
            )}
          </div>
        </Section>

        <EpcAdminInfoSection businessId={params.id} />

        <GstR3bSection businessId={params.id} />

        <Card className="p-6">
          <h3 className="font-display font-semibold text-[16px] mb-3">Review actions</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal review notes (optional — not persisted yet)"
            className="w-full border border-line rounded-input px-3.5 py-3 text-[14px] mb-3 min-h-[80px] focus:border-blue outline-none"
          />
          <div className="flex flex-wrap gap-3">
            {biz.status === "under_review" && <>
              <Button variant="grad" loading={busy} onClick={() => changeStatus("approved")}>Approve</Button>
              <Button variant="outline" loading={busy} onClick={() => changeStatus("on_hold")}>On hold</Button>
              <Button variant="outline" loading={busy} onClick={() => changeStatus("rejected")}>Reject</Button>
            </>}
            {biz.status === "on_hold" && <>
              <Button variant="grad" loading={busy} onClick={() => changeStatus("approved")}>Approve</Button>
              <Button variant="outline" loading={busy} onClick={() => changeStatus("rejected")}>Reject</Button>
            </>}
            {biz.status === "rejected" && (
              <Button variant="outline" loading={busy} onClick={() => changeStatus("under_review")}>Re-open</Button>
            )}
            {biz.status === "draft" && <p className="text-[13px] text-text-muted">EPC hasn&rsquo;t submitted yet.</p>}
            {biz.status === "approved" && <p className="text-[13px] text-text-muted">Approved. EPC has dashboard access.</p>}
          </div>
        </Card>
      </section>
    </main>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h3 className="font-display font-semibold text-[16px] mb-3">{title}</h3>
      <div className="space-y-1">{children}</div>
    </Card>
  );
}

// ── Members editor (edit-only per spec; no add/delete) ────────────────────
function MembersEditor({
  value, onSave, businessId,
}: {
  value: Stakeholder[];
  onSave: (next: Stakeholder[]) => Promise<void>;
  businessId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Stakeholder[]>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(value); }, [value]);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
      setError(null);
    } catch (e) {
      setError((e as Error)?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (value.length === 0) {
    return <p className="text-[13px] text-text-muted">No members.</p>;
  }

  if (!editing) {
    return (
      <div>
        {value.map((s) => (
          <div key={s.id} className="py-3 border-t border-line first:border-0 first:pt-0">
            <p className="text-[14px] font-semibold">
              {s.name} <span className="text-text-muted font-normal">— {s.designation}</span>
            </p>
            <p className="text-[12px] text-text-muted mt-0.5">
              {s.mobile ? `+91 ${s.mobile}` : "—"}
              {s.email ? ` · ${s.email}` : ""}
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mt-2">
              <AdminDocSlot businessId={businessId} stakeholderId={s.id} category="stakeholder_pan"     label="Member PAN card" />
              <AdminDocSlot businessId={businessId} stakeholderId={s.id} category="stakeholder_aadhaar" label="Member Aadhaar card" />
            </div>
          </div>
        ))}
        <div className="mt-3">
          <button
            type="button"
            onClick={() => { setDraft(value); setEditing(true); }}
            className="text-[12px] text-blue hover:underline"
          >
            Edit members
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {draft.map((s, i) => (
        <div key={s.id} className="border border-line rounded-input p-3 bg-bg-soft">
          <p className="text-[11px] text-text-muted mb-2">Member {i + 1}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="border border-line rounded px-2 py-1.5 text-[13px] focus:border-blue outline-none bg-white"
              placeholder="Name"
              value={s.name}
              onChange={(e) => {
                const next = [...draft]; next[i] = { ...next[i], name: e.target.value };
                setDraft(next);
              }}
            />
            <input
              className="border border-line rounded px-2 py-1.5 text-[13px] focus:border-blue outline-none bg-white"
              placeholder="Designation"
              value={s.designation}
              onChange={(e) => {
                const next = [...draft]; next[i] = { ...next[i], designation: e.target.value };
                setDraft(next);
              }}
            />
            <input
              className="border border-line rounded px-2 py-1.5 text-[13px] focus:border-blue outline-none bg-white"
              placeholder="Mobile (10 digits)"
              inputMode="numeric"
              maxLength={10}
              value={s.mobile}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                const next = [...draft]; next[i] = { ...next[i], mobile: v };
                setDraft(next);
              }}
            />
            <input
              className="border border-line rounded px-2 py-1.5 text-[13px] focus:border-blue outline-none bg-white"
              placeholder="Email (optional)"
              type="email"
              value={s.email}
              onChange={(e) => {
                const next = [...draft]; next[i] = { ...next[i], email: e.target.value };
                setDraft(next);
              }}
            />
          </div>
        </div>
      ))}
      {error && <p className="text-[12px] text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 bg-blue text-white rounded text-[12px] font-semibold hover:bg-blue-dark disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save members"}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null); }}
          disabled={saving}
          className="px-3 py-1.5 border border-line rounded text-[12px] hover:border-blue"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── References editor — freeform arrays of customer + supplier ─────────
// No admin-side floor: admins can edit down to 0 during review; the min-2+2
// requirement lives in Step 6 (draft-only). Same JSONB shape (type field).
function ReferencesEditor({
  value, onSave,
}: {
  value: Reference[];
  onSave: (next: Reference[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftCust, setDraftCust] = useState<Reference[]>(value.filter((r) => r.type === "customer"));
  const [draftSupp, setDraftSupp] = useState<Reference[]>(value.filter((r) => r.type === "supplier"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftCust(value.filter((r) => r.type === "customer"));
    setDraftSupp(value.filter((r) => r.type === "supplier"));
  }, [value]);

  async function save() {
    for (const r of [...draftCust, ...draftSupp]) {
      if ((r.name || r.mobile) && !(r.name && MOBILE_RE.test(r.mobile))) {
        setError(`Each ${r.type} reference needs both a name and a valid 10-digit mobile.`);
        return;
      }
    }
    const out: Reference[] = [
      ...draftCust.filter((r) => r.name && r.mobile).map((r) => ({ ...r, type: "customer" as const })),
      ...draftSupp.filter((r) => r.name && r.mobile).map((r) => ({ ...r, type: "supplier" as const })),
    ];
    setSaving(true);
    try {
      await onSave(out);
      setEditing(false);
      setError(null);
    } catch (e) {
      setError((e as Error)?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div>
        {value.length === 0 ? (
          <p className="text-[13px] text-text-muted">No references.</p>
        ) : (
          <>
            <RefReadOnlyGroup title="Customer" refs={value.filter((r) => r.type === "customer")} />
            <RefReadOnlyGroup title="Supplier" refs={value.filter((r) => r.type === "supplier")} />
          </>
        )}
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[12px] text-blue hover:underline"
          >
            Edit references
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RefEditGroup
        title="Customer references"
        which="customer"
        refs={draftCust}
        onChange={setDraftCust}
      />
      <RefEditGroup
        title="Supplier references"
        which="supplier"
        refs={draftSupp}
        onChange={setDraftSupp}
      />
      {error && <p className="text-[12px] text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 bg-blue text-white rounded text-[12px] font-semibold hover:bg-blue-dark disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save references"}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null); }}
          disabled={saving}
          className="px-3 py-1.5 border border-line rounded text-[12px] hover:border-blue"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function RefReadOnlyGroup({ title, refs }: { title: string; refs: Reference[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="text-[12px] text-text-muted mb-1">{title}</p>
      {refs.map((r, i) => (
        <div key={i} className="flex gap-4 text-[13px] py-0.5">
          <dd className="text-text">{r.name} <span className="text-text-muted">· {r.mobile}</span></dd>
        </div>
      ))}
    </div>
  );
}

function RefEditGroup({
  title, which, refs, onChange,
}: {
  title: string;
  which: "customer" | "supplier";
  refs: Reference[];
  onChange: (next: Reference[]) => void;
}) {
  function update(i: number, key: "name" | "mobile", value: string) {
    const next = [...refs];
    next[i] = { ...next[i], [key]: value };
    onChange(next);
  }
  function remove(i: number) {
    onChange(refs.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...refs, { type: which, name: "", mobile: "" }]);
  }
  return (
    <div>
      <p className="text-[12px] text-text-muted mb-2">{title}</p>
      <div className="space-y-2">
        {refs.map((r, i) => (
          <div key={i} className="border border-line rounded-input p-3 bg-bg-soft">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] text-text-muted capitalize">{which} {i + 1}</p>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-[11px] text-text-muted hover:text-red-500 transition-colors"
              >
                Delete
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="border border-line rounded px-2 py-1.5 text-[13px] focus:border-blue outline-none bg-white"
                placeholder="Name"
                value={r.name}
                onChange={(e) => update(i, "name", e.target.value)}
              />
              <input
                className="border border-line rounded px-2 py-1.5 text-[13px] focus:border-blue outline-none bg-white"
                placeholder="Mobile (10 digits)"
                inputMode="numeric"
                maxLength={10}
                value={r.mobile}
                onChange={(e) => update(i, "mobile", e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
        ))}
        {refs.length === 0 && (
          <p className="text-[12px] text-text-muted">No {which} references.</p>
        )}
      </div>
      <div className="mt-2">
        <button
          type="button"
          onClick={add}
          className="text-[12px] text-blue hover:underline"
        >
          + Add {which} reference
        </button>
      </div>
    </div>
  );
}
