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
import { supabase } from "@/lib/supabase";
import { getDocumentUrl } from "@/lib/storage";
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

  async function openDoc(id: string) {
    const url = await getDocumentUrl(id);
    if (url) window.open(url, "_blank", "noopener");
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
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => router.push(`/admin/app/${loan.id}/step-1` as any)}>
            Edit application
          </Button>
          <Button variant="outline" onClick={() => router.push(`/admin/app/${loan.id}/step-6` as any)}>
            Review page
          </Button>
        </div>

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

            {/* Documents */}
            <SectionCard title="Documents">
              {docs.length === 0 ? (
                <p className="text-[13px] text-text-muted">No documents uploaded.</p>
              ) : (
                <ul className="space-y-2">
                  {docs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-white border border-line rounded-input">
                      <div className="min-w-0">
                        <p className="text-[12px] text-text-muted uppercase tracking-wide font-semibold">
                          {DOC_LABEL[d.category] ?? d.category.replace(/_/g, " ")}
                        </p>
                        <p className="text-[13px] text-text truncate">{d.file_name || "Document"}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void openDoc(d.id)}
                        title="View document"
                        className="p-1.5 rounded hover:bg-bg-tint text-[#185fa5] transition-colors"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
