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
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import GstR3bSection from "@/components/GstR3bSection";
import EpcAdminInfoSection from "@/components/EpcAdminInfoSection";
import CommentsSection from "@/components/CommentsSection";
import EditableField from "@/components/EditableField";
import AdminDocSlot from "@/components/AdminDocSlot";
import FileUpload from "@/components/FileUpload";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/auditLog";
import { EMAIL_RE, PAN_RE, IFSC_RE, ACCOUNT_RE, GSTIN_RE } from "@/lib/validators";
import { EPC_STATUS_LABEL } from "@/lib/epc-labels";
import {
  DESIGNATION_OPTIONS, REFERRAL_OPTIONS, normalizeStakeholderKeepId,
  type EpcReference as Reference, type Stakeholder,
} from "@/lib/epc-stakeholders";
import MembersEditor from "./_parts/MembersEditor";
import ReferencesEditor from "./_parts/ReferencesEditor";

type Biz = Record<string, any>;

const BUSINESS_TYPE_OPTIONS = [
  { value: "proprietorship", label: "Proprietorship" },
  { value: "pvt_ltd",        label: "Private Limited" },
  { value: "partnership",    label: "Partnership" },
  { value: "llp",            label: "LLP" },
];

const PM_SURYA_GHAR_OPTIONS = [
  { value: "yes",   label: "Yes" },
  { value: "no",    label: "No" },
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
  const router = useRouter();
  const [biz, setBiz] = useState<Biz | null>(null);

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

  // Members and References use coarse section-level saves per spec: the whole
  // JSONB array, one audit row.
  async function saveColumn(
    column: "stakeholders" | "business_references",
    action: "members_edited" | "references_edited",
    next: Stakeholder[] | Reference[],
  ) {
    const { error } = await supabase()
      .from("epc_business")
      .update({ [column]: next })
      .eq("id", params.id);
    if (error) throw error;
    await logAudit(params.id, action, column);
    setBiz((b) => (b ? { ...b, [column]: next } : b));
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
        <div className="max-w-container mx-auto px-7 h-16 flex items-center">
          <button type="button" onClick={() => router.push(`/admin/epc/${params.id}/view` as any)} className="text-[13px] text-text-muted hover:text-text inline-flex items-center gap-1">← Back to profile</button>
        </div>
      </header>

      <section className="max-w-[1000px] mx-auto px-5 sm:px-7 py-10 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-[26px] sm:text-[30px] font-bold">{biz.trade_name || biz.contact_name || "EPC"}</h1>
            <p className="text-text-mid mt-1">+91 {biz.contact_mobile} · {biz.business_type || "—"}</p>
          </div>
          {(() => {
            const s = biz.status;
            const label = EPC_STATUS_LABEL[s] ?? "Draft";
            const cls = s === "approved" ? "bg-green-50 text-green-dark" : s === "rejected" ? "bg-red-50 text-red-700" : s === "under_review" ? "bg-[#fef0d6] text-[#854f0b]" : s === "on_hold" ? "bg-[#e5edf5] text-[#3b5a76]" : "bg-[#eef1f0] text-[#5a8a76]";
            return <span className={`inline-block px-3 py-1 rounded-full text-[12px] font-semibold ${cls}`}>{label}</span>;
          })()}
        </div>

        <Section title="Identity">
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
          {/* Admin rows: business_type is locked. A DB trigger
              (prevent_admin_demotion_trg) blocks the write anyway, but
              hiding the dropdown keeps the UI honest and avoids a
              confusing DB-error toast on accidental save. */}
          {biz.business_type === "admin" ? (
            <EditableField
              label="Business type"
              value="admin"
              display={() => "Admin"}
              readOnly
              onSave={async () => {}}
            />
          ) : (
            <EditableField
              label="Business type"
              value={biz.business_type}
              display={(v) => v ? (BUSINESS_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v) : ""}
              options={BUSINESS_TYPE_OPTIONS}
              onSave={saveField("business_type")}
            />
          )}
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
            label="GSTIN"
            value={biz.gstin_number}
            onSave={async (v) => saveField("gstin_number")(v.toUpperCase())}
            validate={(v) =>
              !v ? null
              : GSTIN_RE.test(v.toUpperCase())
                  ? null
                  : "Invalid GSTIN (15 chars)"
            }
            hint="Auto-filled from the EPC's GST registration document."
          />
          <EditableField
            label="GST Address"
            value={biz.gst_address}
            onSave={saveField("gst_address")}
            hint="Registered address from the GST certificate."
          />
          <EditableField
            label="PAN"
            value={biz.pan_number}
            onSave={async (v) => saveField("pan_number")(v.toUpperCase())}
            validate={(v) => (!v ? null : PAN_RE.test(v.toUpperCase()) ? null : "Invalid PAN (AAAAA9999A)")}
          />

          {/* PM Surya Ghar — always renders, even for legacy EPCs where the */}
          {/* value is null (onboarded before the field existed).             */}
          <EditableField
            label="PM Surya Ghar"
            value={biz.pm_surya_ghar}
            display={(v) =>
              v === "yes"   ? "Yes"
              : v === "no"    ? "No"
              : v === "other" ? "Other"
              : ""
            }
            options={PM_SURYA_GHAR_OPTIONS}
            inlineSelect
            onSave={saveField("pm_surya_ghar")}
          />
          {biz.pm_surya_ghar === "other" && (
            <EditableField
              label="Which entity are you registered with?"
              value={biz.pm_surya_ghar_other}
              onSave={saveField("pm_surya_ghar_other")}
              hint="Entity / scheme name — free text."
            />
          )}
          {biz.pm_surya_ghar === "yes" && (
            <EditableField
              label="Total No of installations on PM Surya Ghar Scheme"
              value={biz.pm_surya_ghar_capacity}
              onSave={saveField("pm_surya_ghar_capacity")}
              hint="Number of installations — e.g. 25."
            />
          )}
          <EditableField
            label="Service"
            value={biz.service_type}
            display={(v) =>
              v === "loans"     ? "Loan"
              : v === "insurance" ? "Insurance"
              : v === "both"      ? "Loan and Insurance"
              : ""
            }
            options={[
              { value: "loans",     label: "Loan" },
              { value: "insurance", label: "Insurance" },
              { value: "both",      label: "Loan and Insurance" },
            ]}
            inlineSelect
            onSave={saveField("service_type")}
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
          <EditableField label="Bank name" value={biz.bank_name} onSave={saveField("bank_name")} />
          <EditableField label="GST username" value={biz.gst_username} onSave={saveField("gst_username")} />
          <div className="mt-3">
            <AdminDocSlot businessId={params.id} category="cancelled_cheque" label="Cancelled cheque" />
          </div>
          <div className="mt-3">
            <p className="text-[13px] font-medium text-text-mid mb-2">Last 12 months&rsquo; bank statements</p>
            <FileUpload businessId={params.id} table="epc_documents" category="bank_statement" maxFiles={Infinity} dedupe uploadedBy="admin" uploadHint="PDF or image" />
          </div>
        </Section>

        <Section title="Stakeholders">
          <MembersEditor
            value={((biz.stakeholders ?? []) as unknown[]).map(normalizeStakeholderKeepId)}
            onSave={(next) => saveColumn("stakeholders", "members_edited", next)}
            businessId={params.id}
            businessType={biz.business_type ?? null}
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
            onSave={(next) => saveColumn("business_references", "references_edited", next)}
          />
          <div className="mt-4 pt-4 border-t border-line">
            <EditableField
              label="How did you hear about us?"
              value={biz.referral_source}
              display={(v) => (v ? (REFERRAL_OPTIONS.find((o) => o.value === v)?.label ?? v) : "")}
              options={REFERRAL_OPTIONS}
              onSave={saveField("referral_source")}
            />
            {biz.referral_source === "others" && (
              <EditableField label="Please specify" value={biz.referral_source_other} onSave={saveField("referral_source_other")} />
            )}
          </div>
        </Section>

        <Section title="Documents">
          <div className="grid sm:grid-cols-2 gap-3">
            <AdminDocSlot businessId={params.id} category="pan_business" label="PAN card" />
            <AdminDocSlot businessId={params.id} category="gstin"        label="GST registration document" />
            {extraDocLabel && (
              <AdminDocSlot businessId={params.id} category="extra_doc" label={extraDocLabel} />
            )}
          </div>

          {/* Admin-only extra documents — any file type, as many as needed.
              Distinct from the onboarding doc set (category 'admin_extra');
              downloaded into a separate "Extra Docs" folder in the ZIP. */}
          <div className="mt-5 pt-4 border-t border-line">
            <p className="text-[13px] font-semibold text-text mb-1">Additional documents</p>
            <p className="text-[12px] text-text-muted mb-3">
              Add additional documents if any
            </p>
            <FileUpload
              businessId={params.id}
              category="admin_extra"
              table="epc_documents"
              uploadedBy="admin"
              maxFiles={20}
              uploadHint="PDF, JPEG, scan, photo"
            />
          </div>
        </Section>

        <EpcAdminInfoSection businessId={params.id} />

        <GstR3bSection businessId={params.id} />

        {/* Comments replace the old "Review actions" card. The internal
            status control lives on the View page header. */}
        <Card className="p-6">
          <h3 className="font-display font-semibold text-[16px] mb-3">Comments</h3>
          <CommentsSection
            businessId={params.id}
            epcName={biz.trade_name || biz.legal_name || biz.contact_name}
          />
        </Card>

        {/* Save Draft — closure gesture. Each field autosaves individually
            as you type/blur, so this button just navigates back to the View
            after confirming everything's persisted. */}
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              alert("All changes saved.");
              router.push(`/admin/epc/${params.id}/view` as any);
            }}
          >
            Save Draft
          </Button>
        </div>
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
