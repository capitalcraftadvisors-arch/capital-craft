"use client";

// Loan Application — full-page View dashboard for admin.
//
// Mirrors the EPC View page pattern: a dense, brand-colored dashboard
// that surfaces all data captured across Steps 1-5 plus the submit
// state on Step 6. Every document has an eye-View link.
//
// Data source: the epc_applications row. This never touches
// epc_business except for read-only display of the linked EPC partner
// (trade name + display id).
//
// The "Edit" button routes back to Step 1 of the flow — every step is
// editable, nothing is locked (even after submit), so the customer /
// admin can navigate to whichever step they need.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import DeleteLoanAppModal from "@/components/DeleteLoanAppModal";
import { supabase } from "@/lib/supabase";
import { getDocumentUrl } from "@/lib/storage";
import { getToken } from "@/lib/auth";
import { lenderOutcome, OUTCOME_LABEL, OUTCOME_PILL, type LenderOutcome } from "@/lib/loan-status";

// The three loan-status values an admin can set from the View page, and
// the epc_applications.status each maps to. Loan applications have NO
// internal admin status — this IS the status.
const LOAN_STATUS_ACTIONS: Array<{ outcome: LenderOutcome; status: string; label: string; kind: "review" | "approve" | "reject" }> = [
  { outcome: "review",   status: "under_review", label: "Under Review",       kind: "review" },
  { outcome: "approved", status: "approved",     label: "Approved by lender",  kind: "approve" },
  { outcome: "rejected", status: "rejected",     label: "Rejected by lender",  kind: "reject" },
];

type Loan = Record<string, any>;
type Doc  = { id: string; category: string; storage_path: string; file_name: string | null; mime_type: string | null };

const SYSTEM_LABEL: Record<string, string> = {
  on_grid:  "On-Grid Solar System",
  off_grid: "Off-Grid Solar System",
  hybrid:   "Hybrid Solar System",
};
const EMPLOYMENT_LABEL: Record<string, string> = {
  salaried: "Salaried", self_employed: "Self-employed",
};
const METHOD_LABEL: Record<string, string> = {
  manual_epdf: "Manual E-PDF Upload", scanned_pdf: "Scanned PDF Upload",
};
// Friendly labels for the user_application_docs categories surfaced in
// the Documents card. Falls back to the underscored category name.
const DOC_LABEL: Record<string, string> = {
  customer_photo:   "Applicant photo",
  borrower_photo:   "Rooftop photo",
  borrower_pan:     "PAN card",
  borrower_aadhaar: "Aadhaar",
  quotation:        "Quotation / Proforma",
  electricity_bill: "Electricity bill",
  bank_statement:   "Bank statement",
  income_proof:     "Income proof",
  property_doc:     "Property document",
};

// Prefers the stored loan_display_id (LA-<last5>-<seq>, migration 0030);
// uuid-derived fallback for rows created before the mobile landed.
function displayId(loan: Loan): string {
  if (loan.loan_display_id) return loan.loan_display_id;
  return "LA-" + String(loan.id).replace(/-/g, "").slice(0, 8).toUpperCase();
}
function fmtRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Document grouping (missing-doc visibility) ───────────────────────
//
// The loan flow stores documents two ways: some as user_application_docs
// rows (borrower_pan, customer_photo, borrower_photo, quotation — viewed
// via openDoc/id) and the rest as *_path columns on the epc_applications
// row (Aadhaar, e-bill, proforma, bank statement, co-applicant — viewed
// by path via openPath). This builds the full expected set grouped by
// step so missing documents render greyed as "Not uploaded" beside the
// uploaded ones.

type LoanSlot = { key: string; label: string; docId: string | null; path: string | null };
type LoanDocGroup = { title: string; slots: LoanSlot[] };

function buildLoanDocGroups(loan: Loan, docs: Doc[]): LoanDocGroup[] {
  const usedRowIds = new Set<string>();
  // Satisfied by the first unused user_application_docs row matching any of
  // `cats`, else by a non-null column `path`.
  const slot = (
    key: string, label: string, cats: string[], path: string | null | undefined,
  ): LoanSlot => {
    for (const cat of cats) {
      const row = docs.find((d) => d.category === cat && !usedRowIds.has(d.id));
      if (row) { usedRowIds.add(row.id); return { key, label, docId: row.id, path: null }; }
    }
    return { key, label, docId: null, path: path ?? null };
  };

  const groups: LoanDocGroup[] = [];

  groups.push({
    title: "Identity (Steps 1–2)",
    slots: [
      slot("applicant_pan",   "Applicant PAN card", ["borrower_pan"],   null),
      slot("applicant_photo", "Applicant photo",    ["customer_photo"], loan.customer_photo_path),
      slot("aadhaar_front",   "Aadhaar (front)",    [], loan.aadhaar_front_path),
      slot("aadhaar_back",    "Aadhaar (back)",     [], loan.aadhaar_back_path),
    ],
  });

  groups.push({
    title: "Loan requirement (Step 3)",
    slots: [
      slot("quotation", "Quotation / Proforma invoice", ["quotation"],        loan.proforma_invoice_path),
      slot("ebill",     "Electricity bill",             ["electricity_bill"], loan.ebill_path),
      slot("rooftop",   "Rooftop photo",                ["borrower_photo"],   loan.rooftop_photo_path),
    ],
  });

  // Co-applicant documents — only when a co-applicant is on the file.
  const hasCoapp = loan.bill_on_applicant_name === false ||
    !!(loan.coapp_pan_path || loan.coapp_aadhaar_front_path || loan.coapp_aadhaar_back_path);
  if (hasCoapp) {
    groups.push({
      title: "Co-applicant (Step 3)",
      slots: [
        slot("coapp_pan",           "Co-applicant PAN card",        [], loan.coapp_pan_path),
        slot("coapp_aadhaar_front", "Co-applicant Aadhaar (front)", [], loan.coapp_aadhaar_front_path),
        slot("coapp_aadhaar_back",  "Co-applicant Aadhaar (back)",  [], loan.coapp_aadhaar_back_path),
      ],
    });
  }

  groups.push({
    title: "Financial (Step 4)",
    slots: [
      slot("bank_statement", "Bank statement", ["bank_statement"], loan.bank_statement_path),
    ],
  });

  // Any uploaded rows not matched above → surface so nothing is hidden.
  const others = docs.filter((d) => !usedRowIds.has(d.id));
  if (others.length > 0) {
    groups.push({
      title: "Other documents",
      slots: others.map((d) => ({
        key: `other-${d.id}`,
        label: DOC_LABEL[d.category] ?? d.category.replace(/_/g, " "),
        docId: d.id,
        path: null,
      })),
    });
  }

  return groups;
}

export default function LoanAppViewPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const [{ data: la }, { data: dd }] = await Promise.all([
        supabase().from("epc_applications")
          .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
          .eq("id", params.id)
          .maybeSingle(),
        supabase().from("user_application_docs")
          .select("id, category, storage_path, file_name, mime_type")
          .eq("application_id", params.id),
      ]);
      setLoan(la);
      const docRows = (dd ?? []) as Doc[];
      setDocs(docRows);
      setLoading(false);

      // Sign the applicant's passport photo for the header avatar.
      const photoDoc = docRows.find((d) => d.category === "customer_photo");
      if (photoDoc) {
        const url = await getDocumentUrl(photoDoc.id);
        if (url) setPhotoUrl(url);
      }
    })();
  }, [params.id]);

  const applicantName = useMemo(() => {
    return loan?.borrower_name || loan?.aadhaar_name || "(unnamed applicant)";
  }, [loan]);
  const epcName = useMemo(() => {
    if (!loan?.epc_business) return "—";
    return loan.epc_business.trade_name || loan.epc_business.legal_name || loan.epc_business.contact_name || "—";
  }, [loan]);
  const docGroups = useMemo(() => (loan ? buildLoanDocGroups(loan, docs) : []), [loan, docs]);

  async function openDoc(id: string) {
    const url = await getDocumentUrl(id);
    if (url) window.open(url, "_blank", "noopener");
  }

  // View a document stored as a *_path column (Aadhaar, e-bill, proforma,
  // bank statement, co-applicant) — these have no user_application_docs
  // row, so they're signed by path via the admin-only sign-doc route.
  async function openPath(path: string) {
    try {
      const res = await fetch(`/api/admin/loan-app/${params.id}/sign-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ path }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && data.url) window.open(data.url, "_blank", "noopener");
    } catch {
      /* ignore — the eye icon just won't open */
    }
  }

  // Admin sets the loan's status directly on epc_applications.status.
  // The three buttons map to the same pipeline values the lender-outcome
  // display reads back (under_review / approved / rejected). This is the
  // ONLY status a loan application has — there is no separate internal
  // admin status the way EPC profiles have.
  async function changeStatus(nextStatus: string) {
    if (!loan || statusBusy || loan.status === nextStatus) return;
    setStatusBusy(true);
    setStatusMsg(null);
    const { error } = await supabase()
      .from("epc_applications")
      .update({ status: nextStatus, reviewed_at: loan.reviewed_at ?? new Date().toISOString() })
      .eq("id", loan.id);
    if (error) {
      setStatusMsg("Couldn't update status — " + error.message);
    } else {
      setLoan({ ...loan, status: nextStatus });
      setStatusMsg("Status updated.");
    }
    setStatusBusy(false);
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-text-muted">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Loan application not found.</p></main>;
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-[20px] grad-text">Capital Craft</span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">
              Loan Application
            </span>
          </div>
          <a href="/admin" className="text-[13px] text-text-muted hover:text-text">← Back to console</a>
        </div>
      </header>

      <section className="w-full px-4 sm:px-6 py-6 max-w-[1400px] mx-auto space-y-5">
        {/* Header banner — applicant + EPC + amount + status + actions */}
        <div className="rounded-card border border-[#cdeadd] bg-gradient-to-r from-[#f0faf5] via-white to-[#dceffb] p-5 sm:p-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 flex items-start gap-4">
            {/* Applicant passport photo (falls back to a monogram avatar) */}
            <div className="w-16 h-20 shrink-0 rounded-lg overflow-hidden border border-[#cdeadd] bg-white grid place-items-center">
              {photoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={photoUrl} alt={applicantName} className="w-full h-full object-cover" />
              ) : (
                <span className="font-display font-bold text-[22px] text-[#178a5c]">
                  {applicantName.trim().charAt(0).toUpperCase() || "?"}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-[#5a8a76] font-bold">Applicant</p>
              <h1 className="mt-1 font-display text-[26px] sm:text-[30px] font-bold text-[#0f3d2e] truncate">
                {applicantName}
              </h1>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                <span className="text-text-muted">via</span>
                <span className="font-semibold text-[#185fa5]">{epcName}</span>
                {loan.epc_business?.epc_display_id && (
                  <span className="text-[11px] font-mono text-text-muted">{loan.epc_business.epc_display_id}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* Lender outcome — loan apps have no internal admin status. */}
            <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${OUTCOME_PILL[lenderOutcome(loan.status)]}`}>
              {OUTCOME_LABEL[lenderOutcome(loan.status)]}
            </span>
            <p className="text-[11px] uppercase tracking-widest text-text-muted font-bold">Loan Amount</p>
            <p className="font-display font-bold text-[22px] text-[#0f3d2e]">
              {fmtRupees(loan.loan_amount_required)}
            </p>
            <p className="text-[10px] font-mono text-text-muted">{displayId(loan)}</p>
          </div>
        </div>

        {/* Action strip */}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => router.push(`/admin/app/${loan.id}/step-1` as any)}>
            Edit application
          </Button>
          <Button variant="outline" onClick={() => router.push(`/admin/app/${loan.id}/step-6` as any)}>
            Review page
          </Button>
          <button
            type="button"
            onClick={() => setDelOpen(true)}
            className="ml-auto px-4 py-2 rounded-input text-[13px] font-semibold border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
          >
            Delete application
          </button>
        </div>

        <DeleteLoanAppModal
          open={delOpen}
          onClose={() => setDelOpen(false)}
          onDeleted={() => router.replace("/admin" as any)}
          applicationId={loan.id}
          displayId={displayId(loan)}
          applicant={applicantName}
          mobile={loan.borrower_mobile ?? null}
        />

        {/* Loan status band — admin sets the application's status here.
            The active choice is derived from the current pipeline status. */}
        <div className="rounded-card border border-line bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-[15px] text-[#0f3d2e]">Loan status</h2>
              <p className="text-[12px] text-text-muted mt-0.5">
                Set where this application stands with the lender. Visible to the EPC partner on their dashboard.
              </p>
            </div>
            {statusMsg && (
              <span className="text-[12px] text-text-muted">{statusMsg}</span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {LOAN_STATUS_ACTIONS.map((a) => {
              const active = lenderOutcome(loan.status) === a.outcome;
              return (
                <StatusBtn
                  key={a.status}
                  label={a.label}
                  kind={a.kind}
                  active={active}
                  disabled={statusBusy}
                  onClick={() => void changeStatus(a.status)}
                />
              );
            })}
          </div>
        </div>

        {/* 2-column dense layout */}
        <div className="grid lg:grid-cols-2 gap-5">
          {/* COL 1 */}
          <div className="space-y-5">
            {/* Applicant identity */}
            <SectionCard title="Applicant identity">
              <FieldRow label="Name"        value={loan.aadhaar_name || loan.borrower_name} />
              <FieldRow label="DOB"         value={loan.aadhaar_dob} />
              <FieldRow label="Gender"      value={loan.aadhaar_gender} />
              <FieldRow label="Aadhaar"     value={loan.aadhaar_number ?? loan.aadhaar_number_masked} mono />
              <FieldRow label="Care of"     value={loan.aadhaar_care_of} />
              <FieldRow label="Address"     value={loan.aadhaar_address} multiline />
              <FieldRow label="PAN"         value={loan.borrower_pan} mono />
              <FieldRow label="Mobile"      value={loan.borrower_mobile ? `+91 ${loan.borrower_mobile}` : null} />
              <FieldRow label="Email"       value={loan.borrower_email} />
            </SectionCard>

            {/* Co-applicant */}
            {loan.bill_on_applicant_name === false && (
              <SectionCard title="Co-applicant" tint="green">
                <FieldRow label="Name"          value={loan.coapp_name} />
                <FieldRow label="Father's name" value={loan.coapp_father_name} />
                <FieldRow label="DOB"           value={loan.coapp_dob} />
                <FieldRow label="Relation"      value={loan.coapp_relation} />
                <FieldRow label="PAN"           value={loan.coapp_pan} mono />
                <FieldRow label="Mobile"        value={loan.coapp_mobile ? `+91 ${loan.coapp_mobile}` : null} />
                <FieldRow label="Email"         value={loan.coapp_email} />
                {loan.coapp_aadhaar_number_masked && (
                  <>
                    <div className="pt-2 mt-2 border-t border-line">
                      <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">Co-applicant Aadhaar</p>
                    </div>
                    <FieldRow label="Aadhaar name" value={loan.coapp_aadhaar_name} />
                    <FieldRow label="Aadhaar DOB"  value={loan.coapp_aadhaar_dob} />
                    <FieldRow label="Number"       value={loan.coapp_aadhaar_number ?? loan.coapp_aadhaar_number_masked} mono />
                    <FieldRow label="Care of"      value={loan.coapp_aadhaar_care_of} />
                    <FieldRow label="Address"      value={loan.coapp_aadhaar_address} multiline />
                  </>
                )}
              </SectionCard>
            )}

            {/* Loan requirements */}
            <SectionCard title="Loan requirements">
              <FieldRow label="Project size"    value={loan.project_size ? `${loan.project_size} ${(loan.project_size_unit ?? "kw").toUpperCase()}` : null} />
              <FieldRow label="Project cost"    value={fmtRupees(loan.total_project_cost)} />
              <FieldRow label="Loan required"   value={fmtRupees(loan.loan_amount_required)} highlight />
              <FieldRow label="Down payment"    value={
                loan.total_project_cost && loan.loan_amount_required
                  ? fmtRupees(Math.max(0, Number(loan.total_project_cost) - Number(loan.loan_amount_required)))
                  : null
              } />
              <FieldRow label="System type"     value={loan.system_type ? SYSTEM_LABEL[loan.system_type] ?? loan.system_type : null} />
              <FieldRow label="Monthly bill"    value={fmtRupees(loan.monthly_bill_amount)} />
              <FieldRow label="DISCOM"          value={loan.discom_name} />
              <FieldRow label="CA number"       value={loan.ca_number} mono />
            </SectionCard>

            {/* Installation site */}
            <SectionCard title="Installation site">
              <FieldRow label="Address"  value={loan.ebill_address_line} multiline />
              <FieldRow label="Pincode"  value={loan.install_pincode} mono />
              <FieldRow label="City"     value={loan.install_city} />
              <FieldRow label="State"    value={loan.install_state} />
              {loan.rooftop_photo_gps && (
                <FieldRow
                  label="Rooftop GPS"
                  value={`${(loan.rooftop_photo_gps as any).lat?.toFixed?.(5) ?? "?"}, ${(loan.rooftop_photo_gps as any).lng?.toFixed?.(5) ?? "?"}`}
                  mono
                />
              )}
            </SectionCard>
          </div>

          {/* COL 2 */}
          <div className="space-y-5">
            {/* Employment + bank */}
            <SectionCard title="Employment &amp; bank" tint="sky">
              <FieldRow label="Employment"   value={loan.employment_type ? EMPLOYMENT_LABEL[loan.employment_type] ?? loan.employment_type : null} />
              <FieldRow label="Profession"   value={
                loan.profession === "Other" && loan.profession_other
                  ? `Other — ${loan.profession_other}` : loan.profession
              } />
              <FieldRow label="Organization" value={loan.organization_name} />
              <FieldRow label="Annual income" value={fmtRupees(loan.annual_income)} />
              <div className="pt-2 mt-2 border-t border-line">
                <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">Bank</p>
              </div>
              <FieldRow label="Account holder" value={loan.bank_account_holder} />
              <FieldRow label="Bank"           value={loan.bank_name} />
              <FieldRow label="Account no."    value={loan.bank_account_no} mono />
              <FieldRow label="IFSC"           value={loan.bank_ifsc} mono />
              <FieldRow label="Type"           value={loan.bank_account_type} />
              <FieldRow label="Statement source" value={
                loan.bank_statement_method ? METHOD_LABEL[loan.bank_statement_method] ?? loan.bank_statement_method : null
              } />
            </SectionCard>

            {/* Loan offer */}
            <SectionCard title="Loan offer selected" tint="green">
              <FieldRow label="ROI"            value={loan.roi_percent != null ? `${loan.roi_percent}%` : null} />
              <FieldRow label="Central subsidy" value={fmtRupees(loan.central_subsidy)} />
              <FieldRow label="State subsidy"   value={fmtRupees(loan.state_subsidy)} />
              <FieldRow label="Tenure"          value={loan.selected_tenure_years ? `${loan.selected_tenure_years} ${loan.selected_tenure_years === 1 ? "year" : "years"}` : null} />
              <FieldRow label="Monthly EMI"    value={fmtRupees(loan.selected_monthly_emi)} highlight />
              <FieldRow label="Subsidy EMI"    value={fmtRupees(loan.selected_subsidy_emi)} />
            </SectionCard>

            {/* Consent */}
            <SectionCard title="Consent record" tint="sky">
              <FieldRow label="Recorded on" value={fmtDate(loan.consent_at)} />
              <FieldRow label="Policies"    value={
                Array.isArray(loan.consent_policies) && loan.consent_policies.length > 0
                  ? loan.consent_policies.join(", ")
                  : null
              } />
              <FieldRow label="IP"          value={loan.consent_ip} mono />
            </SectionCard>

            {/* Documents — expected set grouped by step; missing ones greyed. */}
            <SectionCard title="Documents">
              <div className="space-y-4">
                {docGroups.map((g) => (
                  <div key={g.title}>
                    <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">
                      {g.title}
                    </p>
                    <ul className="space-y-2">
                      {g.slots.map((s) => {
                        const present = !!(s.docId || s.path);
                        return (
                          <li
                            key={s.key}
                            className={
                              "flex items-center justify-between gap-3 px-3 py-2 rounded-input border " +
                              (present ? "bg-white border-line" : "bg-bg-tint/40 border-dashed border-line")
                            }
                          >
                            <p className={"text-[13px] truncate " + (present ? "text-text font-medium" : "text-text-muted")}>
                              {s.label}
                            </p>
                            {present ? (
                              <button
                                type="button"
                                onClick={() => { if (s.docId) void openDoc(s.docId); else if (s.path) void openPath(s.path); }}
                                title="View document"
                                className="p-1.5 rounded hover:bg-bg-tint text-[#185fa5] transition-colors shrink-0"
                              >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              </button>
                            ) : (
                              <span className="text-[11px] text-text-muted shrink-0 whitespace-nowrap">Not uploaded</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Submission */}
            <SectionCard title="Submission">
              <FieldRow label="Current step" value={String(loan.current_step ?? "—")} />
              <FieldRow label="Step 1 done"  value={fmtDate(loan.consent_at)} />
              <FieldRow label="Step 2 done"  value={fmtDate(loan.kyc_extracted_at)} />
              <FieldRow label="Step 3 done"  value={fmtDate(loan.step3_completed_at)} />
              <FieldRow label="Step 4 done"  value={fmtDate(loan.step4_completed_at)} />
              <FieldRow label="Step 5 done"  value={fmtDate(loan.step5_completed_at)} />
              <FieldRow label="Submitted"    value={fmtDate(loan.submitted_at)} highlight />
            </SectionCard>
          </div>
        </div>
      </section>
    </main>
  );
}

// ── Small helpers ────────────────────────────────────────────────────

function StatusBtn({
  label, kind, active, disabled, onClick,
}: {
  label: string;
  kind: "review" | "approve" | "reject";
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  // Active = current status, shown filled; inactive = outline the admin
  // can click to switch to.
  const filled =
    kind === "approve" ? "bg-green-dark text-white border-green-dark" :
    kind === "reject"  ? "bg-red-700 text-white border-red-700" :
                         "bg-[#185fa5] text-white border-[#185fa5]";
  const outline =
    kind === "approve" ? "text-green-dark border-[#cdeadd] hover:bg-[#f0faf5]" :
    kind === "reject"  ? "text-red-700 border-red-200 hover:bg-red-50" :
                         "text-[#185fa5] border-[#d3e9f7] hover:bg-[#dceffb]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "px-4 py-2 rounded-input text-[13px] font-semibold border transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        active ? filled : `bg-white ${outline}`,
      ].join(" ")}
    >
      {active && "✓ "}{label}
    </button>
  );
}

function SectionCard({
  title, tint = "neutral", children,
}: {
  title: string;
  tint?: "neutral" | "green" | "sky";
  children: React.ReactNode;
}) {
  const styles =
    tint === "green" ? "bg-[#f0faf5] border-[#cdeadd]" :
    tint === "sky"   ? "bg-[#dceffb] border-[#d3e9f7]" :
                       "bg-white border-line";
  return (
    <Card className={`p-5 border ${styles}`}>
      <h2 className="font-display font-semibold text-[15px] text-[#0f3d2e] mb-3">{title}</h2>
      <dl className="space-y-1.5 text-[13px]">
        {children}
      </dl>
    </Card>
  );
}

function FieldRow({
  label, value, mono, multiline, highlight,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
  multiline?: boolean;
  highlight?: boolean;
}) {
  const shown = value == null || value === "" ? "—" : String(value);
  return (
    <div className={multiline ? "" : "flex flex-wrap gap-2"}>
      <dt className="text-text-muted min-w-[130px] shrink-0">{label}</dt>
      <dd
        className={[
          mono ? "font-mono " : "",
          highlight ? "font-bold text-[15px] text-[#185fa5] " : "font-semibold text-text ",
          multiline ? "block mt-0.5" : "",
        ].join("")}
      >
        {shown}
      </dd>
    </div>
  );
}
