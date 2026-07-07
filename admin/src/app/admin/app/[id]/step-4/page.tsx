"use client";

// Loan Application — Step 4 (Personal Details)
//
// Sections stacked vertically inside the standard tracker card:
//   a. Header (tracker at step 4 of 6)
//   b. Verified Information — collapsible KYC recap from Step 2
//   c. Employment Information
//         · Two toggle cards: Salaried / Self-employed
//         · Profession dropdown (options depend on employment type)
//         · "Please specify profession" when Other is picked
//         · Organization name + Annual income
//   d. Bank Statement — two method cards (Manual E-PDF / Scanned PDF)
//         · Selecting a method reveals the file picker
//         · Upload triggers extract-bank-statement → prefill retrieved bank info
//   e. Retrieved Bank Information — labeled fields, OCR-prefilled, editable
//         · "Details Extracted" badge; confirm checkbox
//   f. Previous / Next

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import LoanAppStepTracker from "@/components/LoanAppStepTracker";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
import { IFSC_RE, MOBILE_RE, EMAIL_RE } from "@/lib/validators";

// ── Static option lists ──────────────────────────────────────────────

const SALARIED_PROFESSIONS = [
  "Government",
  "Private Sector",
  "PSU",
  "Other",
];

const SELF_EMPLOYED_PROFESSIONS = [
  "Business Owner",
  "Professional (Doctor / CA / Lawyer)",
  "Service Provider",
  "Trader",
  "Other",
];

const ACCOUNT_TYPES = [
  "Savings", "Current", "Salary", "NRE", "NRO", "Overdraft", "Fixed Deposit",
];

// ── Types ────────────────────────────────────────────────────────────

type Loan = {
  id: string;
  current_step: number;
  created_at: string;
  aadhaar_name:          string | null;
  aadhaar_dob:           string | null;
  aadhaar_address:       string | null;
  aadhaar_number_masked: string | null;
  epc_business: {
    contact_name: string | null;
    trade_name: string | null;
    legal_name: string | null;
    epc_display_id: string | null;
  } | null;
};

type BankFields = {
  account_holder: string | null;
  bank_name:      string | null;
  account_no:     string | null;
  ifsc:           string | null;
  account_type:   string | null;
  mobile:         string | null;
  email:          string | null;
};

type BankDoc = {
  path: string;
  uploaded_at: string;
  signed_url: string | null;
  file_name: string;
  method: "manual_epdf" | "scanned_pdf";
} | null;

// ── Page ─────────────────────────────────────────────────────────────

export default function LoanAppStep4Page() {
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

  // Employment
  const [employment, setEmployment] = useState<"salaried" | "self_employed" | "">("");
  const [profession, setProfession] = useState("");
  const [professionOther, setProfessionOther] = useState("");
  const [organization, setOrganization] = useState("");
  const [annualIncome, setAnnualIncome] = useState("");

  // Bank statement
  const [method, setMethod] = useState<"manual_epdf" | "scanned_pdf" | "">("");
  const [bankDoc, setBankDoc] = useState<BankDoc>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Retrieved bank info (editable)
  const [accountHolder, setAccountHolder] = useState("");
  const [bankName,      setBankName]      = useState("");
  const [accountNo,     setAccountNo]     = useState("");
  // OCR-fetched account number, kept separate from the editable input
  // so we can flag a mismatch if admin edits away from the OCR value
  // (cheque-flow style — Step 4 of the EPC onboarding does the same).
  const [ocrAccountNo, setOcrAccountNo]   = useState<string | null>(null);
  const [ifsc,          setIfsc]          = useState("");
  const [accountType,   setAccountType]   = useState("");
  const [bankMobile,    setBankMobile]    = useState("");
  const [bankEmail,     setBankEmail]     = useState("");
  const [bankConfirmed, setBankConfirmed] = useState(false);

  // KYC recap
  const [kycOpen, setKycOpen] = useState(false);

  // Submit
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("epc_applications")
        .select(
          "id, current_step, created_at, " +
          "aadhaar_name, aadhaar_dob, aadhaar_address, aadhaar_number_masked, " +
          "employment_type, profession, profession_other, organization_name, annual_income, " +
          "bank_statement_method, bank_statement_path, bank_statement_uploaded_at, step4_completed_at, " +
          "bank_account_holder, bank_name, bank_account_no, bank_ifsc, bank_account_type, bank_mobile, " +
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .eq("id", params.id)
        .maybeSingle();
      const row = data as unknown as (Loan & Record<string, any>) | null;
      setLoan(row);
      // Prefill from a previous Step 4 save (edit / resume pass). No
      // forward-redirect — the flow stays editable from the Step-6 review.
      if (row && row.step4_completed_at) {
        if (row.employment_type)   setEmployment(row.employment_type);
        if (row.profession)        setProfession(row.profession);
        if (row.profession_other)  setProfessionOther(row.profession_other);
        if (row.organization_name) setOrganization(row.organization_name);
        if (row.annual_income != null) setAnnualIncome(String(row.annual_income));
        if (row.bank_statement_method) setMethod(row.bank_statement_method);
        if (row.bank_statement_path) {
          setBankDoc({
            path: row.bank_statement_path,
            uploaded_at: row.bank_statement_uploaded_at ?? row.step4_completed_at,
            signed_url: null,
            file_name: String(row.bank_statement_path).split("/").pop() ?? "Bank statement",
            method: row.bank_statement_method ?? "manual_epdf",
          });
        }
        if (row.bank_account_holder) setAccountHolder(row.bank_account_holder);
        if (row.bank_name)           setBankName(row.bank_name);
        if (row.bank_account_no)     setAccountNo(row.bank_account_no);
        if (row.bank_ifsc)           setIfsc(row.bank_ifsc);
        if (row.bank_account_type)   setAccountType(row.bank_account_type);
        if (row.bank_mobile)         setBankMobile(row.bank_mobile);
        setBankConfirmed(true);   // was confirmed at the previous save
      }
      setLoading(false);
    })();
  }, [params.id]);

  const professionOptions = useMemo(() => {
    if (employment === "salaried")      return SALARIED_PROFESSIONS;
    if (employment === "self_employed") return SELF_EMPLOYED_PROFESSIONS;
    return [];
  }, [employment]);

  // ── Bank statement upload ──────────────────────────────────────────

  async function uploadBankStatement(file: File) {
    if (!loan || !method) return;
    setUploadError(null);
    setUploading(true);
    // On re-upload we blow away the previously-shown retrieved fields
    // and confirm state — admin needs to re-review the new extraction.
    setBankConfirmed(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("method", method);
      const res = await fetch(`/api/admin/loan-app/${loan.id}/extract-bank-statement`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setUploadError(data?.error || `Upload failed (HTTP ${res.status}).`);
        return;
      }
      setBankDoc({
        path: data.storage_path,
        uploaded_at: data.uploaded_at,
        signed_url: data.signed_url,
        file_name: file.name,
        method,
      });
      // Prefill retrieved bank info — never blow away what admin
      // already typed manually.
      const f = data.fields as BankFields;
      if (!accountHolder && f.account_holder) setAccountHolder(f.account_holder);
      if (!bankName      && f.bank_name)      setBankName(f.bank_name);
      if (f.account_no) setOcrAccountNo(f.account_no);
      if (!accountNo     && f.account_no)     setAccountNo(f.account_no);
      if (!ifsc          && f.ifsc)           setIfsc(f.ifsc);
      if (!accountType   && f.account_type)   setAccountType(f.account_type);
      if (!bankMobile    && f.mobile)         setBankMobile(f.mobile);
      if (!bankEmail     && f.email)          setBankEmail(f.email);
    } catch (e) {
      setUploadError((e as Error)?.message || "Network error.");
    } finally {
      setUploading(false);
    }
  }

  // ── Derived validity ───────────────────────────────────────────────

  const validIncome = Number(annualIncome) > 0;
  const validEmployment =
    (employment === "salaried" || employment === "self_employed") &&
    profession.length > 0 &&
    (profession !== "Other" || professionOther.trim().length > 0) &&
    validIncome;

  const validBankBasics =
    accountHolder.trim().length > 0 &&
    bankName.trim().length > 0 &&
    accountNo.trim().length >= 6 &&
    IFSC_RE.test(ifsc.trim().toUpperCase()) &&
    (!bankMobile || MOBILE_RE.test(bankMobile)) &&
    (!bankEmail  || EMAIL_RE.test(bankEmail));

  const canNext =
    validEmployment &&
    !!bankDoc &&
    validBankBasics &&
    bankConfirmed &&
    !saving;

  // ── Submit ─────────────────────────────────────────────────────────

  async function saveAndNext() {
    if (!loan || !canNext) return;
    setSaveError(null);
    setSaving(true);
    try {
      const body = {
        employment_type:   employment,
        profession,
        profession_other:  profession === "Other" ? professionOther.trim() : null,
        organization_name: organization.trim() || null,
        annual_income:     Number(annualIncome),
        bank_statement_method:      bankDoc!.method,
        bank_statement_path:        bankDoc!.path,
        bank_statement_uploaded_at: bankDoc!.uploaded_at,
        bank_account_holder: accountHolder.trim(),
        bank_name:           bankName.trim(),
        bank_account_no:     accountNo.trim(),
        bank_ifsc:           ifsc.trim().toUpperCase(),
        bank_account_type:   accountType || null,
        bank_mobile:         bankMobile || null,
        bank_email:          bankEmail.trim() || null,
      };
      const res = await fetch(`/api/admin/loan-app/${loan.id}/complete-step-4`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setSaveError(data?.error || `Save failed (HTTP ${res.status}).`);
        setSaving(false);
        return;
      }
      const fromReview = new URLSearchParams(window.location.search).get("from") === "review";
      router.push(`/admin/app/${loan.id}/${fromReview ? "step-6" : "step-5"}` as any);
    } catch (e) {
      setSaveError((e as Error)?.message || "Network error.");
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-text-muted">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Loan application not found.</p></main>;
  }

  const customerName =
    loan.epc_business?.trade_name ||
    loan.epc_business?.legal_name ||
    loan.epc_business?.contact_name ||
    "(customer)";

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-[20px] grad-text">Capital Craft</span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">
              Loan Application · Step 4
            </span>
          </div>
          <a href="/admin" className="text-[13px] text-text-muted hover:text-text">← Back to console</a>
        </div>
      </header>

      <section className="max-w-[880px] mx-auto px-5 sm:px-7 py-8 space-y-5">
        <LoanAppStepTracker
          applicationId={loan.id}
          displayId={loan.epc_business?.epc_display_id ?? null}
          name={customerName}
          createdAt={loan.created_at}
          currentStep={4}
        />

        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-[#0f3d2e]">
            Personal Details
          </h1>
          <p className="text-text-mid mt-2 text-[15px]">
            Capture the customer&rsquo;s employment info and verify bank details from
            a recent statement. All bank fields are prefilled from OCR — every one
            is editable, so correct anything before confirming.
          </p>
        </div>

        {/* b. Verified Information (collapsible) */}
        <Card className="p-0 overflow-hidden">
          <button
            type="button"
            onClick={() => setKycOpen((v) => !v)}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-bg-tint transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#178a5c] flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="text-[14px] font-semibold text-[#0f3d2e]">
                Details verified via KYC
              </span>
            </div>
            <svg
              width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="#5a8a76" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={"transition-transform " + (kycOpen ? "rotate-180" : "")}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {kycOpen && (
            <div className="px-6 pb-6 pt-1 border-t border-line bg-[#f0faf5]">
              <dl className="grid gap-2 sm:grid-cols-2 text-[13px] pt-4">
                <KycRow label="Name"    value={loan.aadhaar_name} />
                <KycRow label="DOB"     value={loan.aadhaar_dob} />
                <KycRow label="Aadhaar (masked)" value={loan.aadhaar_number_masked} mono />
                <KycRow label="Address" value={loan.aadhaar_address} full />
              </dl>
            </div>
          )}
        </Card>

        {/* c. Employment Information */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Employment information</h2>

          <div>
            <p className="block mb-2 text-[13px] font-medium text-text-mid">Employment type</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <EmploymentTile
                active={employment === "salaried"}
                onClick={() => { setEmployment("salaried"); setProfession(""); setProfessionOther(""); }}
                title="Salaried"
                desc="Employee of a company / organisation"
              />
              <EmploymentTile
                active={employment === "self_employed"}
                onClick={() => { setEmployment("self_employed"); setProfession(""); setProfessionOther(""); }}
                title="Self-employed"
                desc="Business owner or independent professional"
              />
            </div>
          </div>

          {employment && (
            <>
              <Select
                label="Profession"
                placeholder="Select profession"
                options={professionOptions.map((p) => ({ value: p, label: p }))}
                value={profession}
                onChange={(e) => setProfession(e.target.value)}
              />
              {profession === "Other" && (
                <Input
                  label="Please specify profession"
                  value={professionOther}
                  onChange={(e) => setProfessionOther(e.target.value)}
                />
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <Input
                  label={employment === "salaried" ? "Organization name (employer)" : "Business name"}
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                />
                <Input
                  label="Annual income (₹)"
                  type="text"
                  inputMode="numeric"
                  value={annualIncome}
                  onChange={(e) => setAnnualIncome(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="e.g. 800000"
                />
              </div>
            </>
          )}
        </Card>

        {/* d. Bank Statement */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Bank statement</h2>
          <p className="text-[13px] text-text-mid">
            Upload a recent bank statement so we can verify income and pull the
            customer&rsquo;s account details. Pick the source that matches the file.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <MethodTile
              active={method === "manual_epdf"}
              onClick={() => setMethod("manual_epdf")}
              title="Manual E-PDF Upload"
              desc="E-PDF downloaded from netbanking / bank email"
            />
            <MethodTile
              active={method === "scanned_pdf"}
              onClick={() => setMethod("scanned_pdf")}
              title="Scanned PDF Upload"
              desc="Photo or scanned copy of the printed statement"
            />
          </div>

          {method && (
            <div>
              <BankDocSlot
                doc={bankDoc}
                uploading={uploading}
                onFile={(f) => void uploadBankStatement(f)}
              />
            </div>
          )}

          {uploadError && (
            <div className="p-3 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700">
              {uploadError}
            </div>
          )}
        </Card>

        {/* e. Retrieved Bank Information */}
        {bankDoc && (
          <Card className="p-6 bg-[#f0faf5] border-[#cdeadd] space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#178a5c] flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">
                Details Extracted
              </h2>
            </div>
            <p className="text-[12px] text-text-muted">
              Review the retrieved fields. Correct anything wrong before confirming.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                label="Account holder"
                value={accountHolder}
                onChange={(e) => setAccountHolder(e.target.value)}
              />
              <Input
                label="Bank name"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
              />
              <Input
                label="Account number"
                value={accountNo}
                onChange={(e) => setAccountNo(e.target.value.replace(/\s+/g, ""))}
                hint={
                  ocrAccountNo && accountNo && ocrAccountNo !== accountNo
                    ? `⚠ Doesn't match the account number OCR read from the statement (${ocrAccountNo}). Please double-check before saving.`
                    : ocrAccountNo && !accountNo
                    ? "Cleared. The statement OCR read " + ocrAccountNo + "."
                    : undefined
                }
              />
              <Input
                label="IFSC code"
                value={ifsc}
                onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                maxLength={11}
              />
              <Select
                label="Account type"
                placeholder="Select account type"
                options={ACCOUNT_TYPES.map((a) => ({ value: a, label: a }))}
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
              />
              <Input
                label="Bank-registered mobile"
                inputMode="numeric"
                maxLength={10}
                value={bankMobile}
                onChange={(e) => setBankMobile(e.target.value.replace(/\D/g, ""))}
              />
              {/* Bank-registered email intentionally removed per spec —
                  DB column bank_email in migration 0025 is kept for
                  compatibility but no longer collected from the UI. */}
            </div>

            <label className="flex items-start gap-2 text-[14px] cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={bankConfirmed}
                onChange={(e) => setBankConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-[#178a5c]"
              />
              <span className="text-text">
                I have reviewed the retrieved bank information above and confirm
                it is correct.
              </span>
            </label>
          </Card>
        )}

        {/* f. Previous / Next */}
        <Card className="p-6">
          {saveError && (
            <div className="p-3 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700 mb-4">
              {saveError}
            </div>
          )}
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/admin/app/${loan.id}/step-3` as any)}
            >
              ← Previous
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={saveAndNext}
              loading={saving}
              disabled={!canNext}
            >
              Next
            </Button>
          </div>
        </Card>
      </section>
    </main>
  );
}

// ── Small helpers ────────────────────────────────────────────────────

const ACCEPT = "image/*,application/pdf";

function EmploymentTile({
  active, onClick, title, desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "text-left rounded-input border-2 p-4 transition-colors relative",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#185fa5]",
        active
          ? "border-[#178a5c] bg-[#f0faf5]"
          : "border-line bg-white hover:border-[#185fa5]",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-3 right-3 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
          active ? "border-[#178a5c]" : "border-line",
        ].join(" ")}
        aria-hidden
      >
        {active && <span className="w-2 h-2 rounded-full bg-[#178a5c]" />}
      </span>
      <p className={"font-display font-semibold text-[14px] pr-6 " + (active ? "text-[#0f3d2e]" : "text-text")}>
        {title}
      </p>
      <p className="text-[12px] text-text-muted mt-1">{desc}</p>
    </button>
  );
}

function MethodTile({
  active, onClick, title, desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  // Same visual shape as EmploymentTile — kept as a separate helper in
  // case the two diverge later (icons, chips, etc.).
  return <EmploymentTile active={active} onClick={onClick} title={title} desc={desc} />;
}

function BankDocSlot({
  doc, uploading, onFile,
}: {
  doc: BankDoc;
  uploading: boolean;
  onFile: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const has = !!doc;
  const uploaded = has && doc ? new Date(doc.uploaded_at) : null;
  return (
    <div>
      {has ? (
        <div className="rounded-input border-2 border-[#178a5c] bg-[#f0faf5] p-4 space-y-2">
          <p className="text-[13px] font-semibold text-[#0f3d2e]">{doc!.file_name}</p>
          {uploaded && (
            <p className="text-[11px] text-[#5a8a76]">
              Uploaded on {uploaded.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            {doc!.signed_url && (
              <a
                href={doc!.signed_url}
                target="_blank"
                rel="noopener"
                title="View uploaded document"
                aria-label="View uploaded document"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#185fa5] hover:underline"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                View
              </a>
            )}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-[12px] font-semibold text-[#178a5c] hover:underline disabled:opacity-60"
            >
              {uploading ? "Uploading…" : "Re-upload"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={[
            "w-full h-[140px] rounded-input border-2 border-dashed transition-colors flex items-center justify-center text-center px-4",
            "border-line bg-white text-text-muted hover:border-[#185fa5] hover:text-[#185fa5]",
            uploading ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
        >
          <div>
            <p className="text-[13px] font-semibold">
              {uploading ? "Uploading & extracting…" : "Click to upload"}
            </p>
            <p className="text-[11px] mt-1">PDF or image</p>
          </div>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
        className="hidden"
      />
    </div>
  );
}

function KycRow({
  label, value, mono, full,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] uppercase tracking-wide text-[#5a8a76] font-semibold">{label}</dt>
      <dd className={(mono ? "font-mono " : "") + "text-[13px] font-semibold text-[#0f3d2e] break-words"}>
        {value || <span className="text-text-muted font-normal">—</span>}
      </dd>
    </div>
  );
}
