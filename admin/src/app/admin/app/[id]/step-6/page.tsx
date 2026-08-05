"use client";

// Loan Application — Step 6 (Review & Submit)
//
// Read-only review of everything captured in Steps 1-5. Each section
// card has an "Edit" link that navigates back to that step; the data
// stays editable through the whole flow (no lock even after submit).
//
// On Submit → complete-step-6 sets status='submitted' + submitted_at.
// Then the page swaps to a full-screen thank-you confirmation showing
// the SOL-RES application id derived from the row uuid.
//
// Guardrails observed:
//   - All data reads from epc_applications (the loan application table).
//   - Never touches epc_business — the EPC partner is shown only for
//     display via the joined row and only reads name/display_id.
//   - Capital Craft branding throughout. No "Solfin" or "pre-approved" copy.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoanAppStepTracker from "@/components/LoanAppStepTracker";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";

type Loan = Record<string, any>;

const SYSTEM_LABEL: Record<string, string> = {
  on_grid:  "On-Grid Solar System",
  off_grid: "Off-Grid Solar System",
  hybrid:   "Hybrid Solar System",
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  salaried:      "Salaried",
  self_employed: "Self-employed",
};

const METHOD_LABEL: Record<string, string> = {
  manual_epdf: "Manual E-PDF Upload",
  scanned_pdf: "Scanned PDF Upload",
};

// Customer-facing application id. Prefers the stored loan_display_id
// (LA-<last5 mobile>-<seq>, assigned by the 0030 trigger when Step 1
// lands the mobile). Falls back to a uuid-derived reference for rows
// created before the migration ran.
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

export default function LoanAppStep6Page() {
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
  const [loading, setLoading] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedNow, setSubmittedNow] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("epc_applications")
        .select(
          "*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .eq("id", params.id)
        .maybeSingle();
      setLoan(data as unknown as Loan | null);
      setLoading(false);
    })();
  }, [params.id]);

  useEffect(() => {
    // Kick apps that haven't reached step 6 back to the last incomplete step.
    if (loan && loan.current_step < 6) {
      const target = Math.max(1, Math.min(5, loan.current_step ?? 1));
      router.replace(`/admin/app/${loan.id}/step-${target}` as any);
    }
  }, [loan, router]);

  const epcName = useMemo(() => {
    if (!loan?.epc_business) return "(customer)";
    return loan.epc_business.trade_name ||
           loan.epc_business.legal_name ||
           loan.epc_business.contact_name ||
           "(customer)";
  }, [loan]);

  async function submit() {
    if (!loan || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/loan-app/${loan.id}/complete-step-6`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setSubmitError(data?.error || `Submit failed (HTTP ${res.status}).`);
        setSubmitting(false);
        return;
      }
      // Update local copy so re-visits show the submitted state.
      setLoan({ ...loan, status: data.status, submitted_at: data.submitted_at });
      setSubmittedNow(true);
    } catch (e) {
      setSubmitError((e as Error)?.message || "Network error.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-text-muted">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Loan application not found.</p></main>;
  }

  // Thank-you takeover on successful submit
  if (submittedNow) {
    return <ThankYou loan={loan} onBack={() => router.push("/admin")} />;
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Back to previous page"
              className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#185fa5] hover:text-[#0f3d2e] transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              Back
            </button>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">
              Loan Application · Step 6
            </span>
          </div>
        </div>
      </header>

      <section className="max-w-[900px] mx-auto px-5 sm:px-7 py-8 space-y-6">
        <LoanAppStepTracker
          applicationId={loan.id}
          displayId={loan.epc_business?.epc_display_id ?? null}
          name={epcName}
          createdAt={loan.created_at}
          currentStep={6}
        />

        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-[#0f3d2e]">
            Review &amp; Submit
          </h1>
          <p className="text-text-mid mt-2 text-[15px]">
            Every section captured across Steps 1-5 is shown below. Use the
            Edit links to jump back and change anything — nothing is locked,
            even after submitting.
          </p>
        </div>

        {/* Section 1 — Registration */}
        <ReviewSection
          title="Registration"
          badge="Step 1"
          onEdit={() => router.push(`/admin/app/${loan.id}/step-1?from=review` as any)}
        >
          <ReviewRow label="EPC partner" value={epcName} />
          <ReviewRow label="EPC ID" value={loan.epc_business?.epc_display_id ?? "—"} mono />
          <ReviewRow label="Install pincode" value={loan.install_pincode ?? "—"} mono />
          <ReviewRow label="Install state"   value={loan.install_state ?? "—"} />
          <ReviewRow label="Install city"    value={loan.install_city ?? "—"} />
          <ReviewRow label="Customer phone"  value={loan.borrower_mobile ? `+91 ${loan.borrower_mobile}` : "—"} />
          <ReviewRow label="Email"           value={loan.borrower_email ?? "—"} />
          <ReviewRow label="PAN"             value={loan.borrower_pan ?? "—"} mono />
          <ReviewRow label="Father's name"   value={loan.borrower_father_name ?? "—"} />
          <ReviewRow label="System type"     value={loan.system_type ? SYSTEM_LABEL[loan.system_type] ?? loan.system_type : "—"} />
          <ReviewRow label="Plant use"       value={
            loan.plant_use_type === "residential" ? "Residential" :
            loan.plant_use_type === "commercial"  ? "Commercial"  : "—"
          } />
          <ReviewRow label="Consent recorded" value={loan.consent_at ? fmtDate(loan.consent_at) : "—"} />
        </ReviewSection>

        {/* Section 2 — KYC */}
        <ReviewSection
          title="KYC Verification"
          badge="Step 2"
          onEdit={() => router.push(`/admin/app/${loan.id}/step-2?from=review` as any)}
        >
          <div className="grid sm:grid-cols-[1fr_140px] gap-5">
            <div>
              <ReviewRow label="Name"    value={loan.aadhaar_name ?? "—"} />
              <ReviewRow label="DOB"     value={loan.aadhaar_dob ?? "—"} />
              <ReviewRow label="Gender"  value={loan.aadhaar_gender ?? "—"} />
              <ReviewRow label="Aadhaar" value={loan.aadhaar_number ?? loan.aadhaar_number_masked ?? "—"} mono />
              <ReviewRow label="Care of" value={loan.aadhaar_care_of ?? "—"} />
              <ReviewRow label="Address" value={loan.aadhaar_address ?? "—"} multiline />
            </div>
            {loan.aadhaar_face_path && (
              <FaceThumbnail path={loan.aadhaar_face_path} />
            )}
          </div>
        </ReviewSection>

        {/* Section 3 — Loan Requirements */}
        <ReviewSection
          title="Loan Requirements"
          badge="Step 3"
          onEdit={() => router.push(`/admin/app/${loan.id}/step-3?from=review` as any)}
        >
          <ReviewRow label="Project size" value={
            loan.project_size ? `${loan.project_size} ${(loan.project_size_unit ?? "kw").toUpperCase()}` : "—"
          } />
          <ReviewRow label="Total project cost" value={fmtRupees(loan.total_project_cost)} />
          <ReviewRow label="Loan amount required" value={fmtRupees(loan.loan_amount_required)} />
          <ReviewRow label="Monthly electricity bill" value={fmtRupees(loan.monthly_bill_amount)} />
          <ReviewRow label="DISCOM" value={loan.discom_name ?? "—"} />
          <ReviewRow label="Consumer / CA number" value={loan.ca_number ?? "—"} mono />
          <ReviewRow label="Installation address" value={
            [loan.ebill_address_line, loan.install_city, loan.install_state, loan.install_pincode]
              .filter(Boolean).join(", ") || "—"
          } multiline />
          <ReviewRow label="Bill in applicant's name?" value={
            loan.bill_on_applicant_name === true  ? "Yes" :
            loan.bill_on_applicant_name === false ? "No (co-applicant added)" : "—"
          } />

          {loan.bill_on_applicant_name === false && (
            <div className="mt-3 pt-3 border-t border-line">
              <p className="text-[12px] uppercase tracking-wide text-text-muted font-semibold mb-2">
                Co-applicant
              </p>
              <ReviewRow label="Name"          value={loan.coapp_name ?? "—"} />
              <ReviewRow label="Father's name" value={loan.coapp_father_name ?? "—"} />
              <ReviewRow label="DOB"           value={loan.coapp_dob ?? "—"} />
              <ReviewRow label="Relation"      value={loan.coapp_relation ?? "—"} />
              <ReviewRow label="PAN"           value={loan.coapp_pan ?? "—"} mono />
              <ReviewRow label="Mobile"        value={loan.coapp_mobile ? `+91 ${loan.coapp_mobile}` : "—"} />
              <ReviewRow label="Email"         value={loan.coapp_email ?? "—"} />
            </div>
          )}
        </ReviewSection>

        {/* Section 4 — Personal Details */}
        <ReviewSection
          title="Personal Details"
          badge="Step 4"
          onEdit={() => router.push(`/admin/app/${loan.id}/step-4?from=review` as any)}
        >
          <ReviewRow label="Employment type" value={
            loan.employment_type ? EMPLOYMENT_LABEL[loan.employment_type] ?? loan.employment_type : "—"
          } />
          <ReviewRow label="Profession" value={
            loan.profession
              ? (loan.profession === "Other" && loan.profession_other
                  ? `Other — ${loan.profession_other}`
                  : loan.profession)
              : "—"
          } />
          <ReviewRow label="Organization" value={loan.organization_name ?? "—"} />
          <ReviewRow label="Annual income" value={fmtRupees(loan.annual_income)} />
          <div className="mt-3 pt-3 border-t border-line">
            <p className="text-[12px] uppercase tracking-wide text-text-muted font-semibold mb-2">
              Bank details
            </p>
            <ReviewRow label="Account holder" value={loan.bank_account_holder ?? "—"} />
            <ReviewRow label="Bank"           value={loan.bank_name ?? "—"} />
            <ReviewRow label="Account no."    value={loan.bank_account_no ?? "—"} mono />
            <ReviewRow label="IFSC"           value={loan.bank_ifsc ?? "—"} mono />
            <ReviewRow label="Account type"   value={loan.bank_account_type ?? "—"} />
            <ReviewRow label="Statement source" value={
              loan.bank_statement_method ? METHOD_LABEL[loan.bank_statement_method] ?? loan.bank_statement_method : "—"
            } />
          </div>
        </ReviewSection>

        {/* Section 5 — Loan Offers */}
        <ReviewSection
          title="Loan Offers"
          badge="Step 5"
          onEdit={() => router.push(`/admin/app/${loan.id}/step-5?from=review` as any)}
        >
          {/* ROI rate is intentionally NOT shown — the 9.5% is a fixed backend
              value used only in the EMI math, never surfaced as a label. */}
          {loan.plant_use_type !== "commercial" && (
            <>
              <ReviewRow label="Central subsidy" value={fmtRupees(loan.central_subsidy)} />
              <ReviewRow label="State subsidy"   value={fmtRupees(loan.state_subsidy)} />
            </>
          )}
          <ReviewRow label="Selected tenure" value={
            loan.selected_tenure_years
              ? `${loan.selected_tenure_years} ${loan.selected_tenure_years === 1 ? "year" : "years"}`
              : "—"
          } />
          <ReviewRow label="Monthly EMI" value={fmtRupees(loan.selected_monthly_emi)} highlight />
          <ReviewRow label="Subsidy EMI" value={fmtRupees(loan.selected_subsidy_emi)} />
        </ReviewSection>

        {/* Submit strip */}
        <Card className="p-6 bg-[#f0faf5] border-[#cdeadd]">
          {submitError && (
            <div className="p-3.5 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700 mb-4">
              {submitError}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-[#0f3d2e]">
                Ready to submit?
              </p>
              <p className="text-[12px] text-text-mid mt-0.5">
                You can still edit any section after submitting — the record stays open.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/admin/app/${loan.id}/step-5` as any)}
              >
                ← Previous
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={submit}
                loading={submitting}
                disabled={submitting}
              >
                Submit Application
              </Button>
            </div>
          </div>
        </Card>

        {loan.status === "submitted" && loan.submitted_at && !submittedNow && (
          <p className="text-[12px] text-text-muted text-center">
            Application already submitted on {fmtDate(loan.submitted_at)}. Re-submitting will update the timestamp.
          </p>
        )}
      </section>
    </main>
  );
}

// ── Thank-you takeover ───────────────────────────────────────────────

function ThankYou({ loan, onBack }: { loan: Loan; onBack: () => void }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#f0faf5] via-white to-[#dceffb] grid place-items-center px-5 py-10 relative overflow-hidden">
      {/* Soft radial decorations — no external asset needed */}
      <div aria-hidden className="absolute top-0 left-0 w-[420px] h-[420px] rounded-full bg-[#178a5c] opacity-[0.05] blur-3xl -translate-x-1/3 -translate-y-1/3" />
      <div aria-hidden className="absolute bottom-0 right-0 w-[520px] h-[520px] rounded-full bg-[#185fa5] opacity-[0.05] blur-3xl translate-x-1/4 translate-y-1/4" />

      <div className="max-w-[620px] w-full text-center space-y-7 relative">
        {/* Big animated success mark */}
        <div className="relative w-24 h-24 mx-auto">
          <div className="absolute inset-0 rounded-full bg-[#178a5c] opacity-20 animate-ping" />
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-[#178a5c] to-[#12734c] flex items-center justify-center shadow-[0_10px_30px_-8px_rgba(23,138,92,0.6)]">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        <div>
          <p className="text-[12px] uppercase tracking-widest text-[#5a8a76] font-bold">
            Capital Craft Financial Advisors
          </p>
          <h1 className="mt-2 font-display text-[36px] sm:text-[44px] font-bold bg-gradient-to-r from-[#0f3d2e] via-[#178a5c] to-[#185fa5] bg-clip-text text-transparent leading-tight">
            Congratulations!
          </h1>
          <p className="mt-3 font-display text-[18px] sm:text-[20px] font-semibold text-[#0f3d2e]">
            You&rsquo;ve successfully submitted your application.
          </p>
        </div>

        <p className="text-text-mid text-[15px] leading-relaxed max-w-md mx-auto">
          Thank you for submitting your details — our team will review your
          application and reach out to you as soon as possible with next steps.
        </p>

        {/* Application ID card — bigger, more prominent */}
        <div className="rounded-card border-2 border-[#cdeadd] bg-white p-6 mx-auto max-w-[440px] shadow-lg">
          <p className="text-[11px] uppercase tracking-widest text-text-muted font-bold">
            Your Application Reference
          </p>
          <p className="mt-2 font-mono font-bold text-[26px] text-[#0f3d2e] tracking-wider">
            {displayId(loan)}
          </p>
          <div className="mt-3 pt-3 border-t border-[#cdeadd] text-[12px] text-text-muted">
            Submitted on {fmtDate(loan.submitted_at)}
          </div>
        </div>

        {/* Quick info strip */}
        <div className="rounded-input border border-[#d3e9f7] bg-[#dceffb] p-4 flex gap-3 items-start text-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#185fa5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p className="text-[13px] text-[#0f2447] leading-relaxed">
            Save this reference number — you&rsquo;ll be able to check on the status
            of your application using it. Our team will contact you on the phone
            number and email you provided.
          </p>
        </div>

        <div className="pt-2">
          <Button type="button" variant="primary" onClick={onBack}>
            Back to console
          </Button>
        </div>
      </div>
    </main>
  );
}

// ── Small helpers ────────────────────────────────────────────────────

function ReviewSection({
  title, badge, onEdit, children,
}: {
  title: string;
  badge: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display font-semibold text-[18px] text-[#0f3d2e]">{title}</h2>
          <span className="text-[10px] uppercase tracking-wide text-text-muted font-semibold px-2 py-0.5 rounded-full border border-line">
            {badge}
          </span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="text-[12px] font-semibold text-[#185fa5] hover:underline"
        >
          Edit ↗
        </button>
      </div>
      <dl className="space-y-2 text-[13px]">
        {children}
      </dl>
    </Card>
  );
}

function ReviewRow({
  label, value, mono, multiline, highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={multiline ? "" : "flex flex-wrap gap-3"}>
      <dt className="text-text-muted min-w-[170px] shrink-0">{label}</dt>
      <dd
        className={[
          mono ? "font-mono " : "",
          highlight ? "font-bold text-[15px] text-[#185fa5] " : "font-semibold text-text ",
          multiline ? "block mt-0.5" : "",
        ].join("")}
      >
        {value}
      </dd>
    </div>
  );
}

// ── Face thumbnail (KYC recap) ───────────────────────────────────────
// Uses the /api/document/[id] pattern won't work here because the face
// path isn't tied to a document row — it's a direct GCS object. We
// ask the server for a signed URL via a lightweight fetch.

function FaceThumbnail({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      // Fallback: since we don't have a dedicated signed-url endpoint
      // for arbitrary GCS paths, we render the path label as a hint
      // when the URL can't be generated. Face crop was signed at
      // Step 2 extraction time; on subsequent visits we don't have a
      // fresh signed URL. The path is stored for Ops reference only.
      // If a dedicated helper exists it goes here; otherwise the
      // thumbnail slot degrades gracefully.
      setUrl(null);
    })();
  }, [path]);

  return (
    <div className="flex flex-col items-center">
      <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mb-2">
        Detected face
      </p>
      <div className="w-[130px] h-[160px] rounded-input border-2 border-[#cdeadd] bg-white overflow-hidden flex items-center justify-center">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Face" className="w-full h-full object-cover" />
        ) : (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#5a8a76" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        )}
      </div>
    </div>
  );
}
