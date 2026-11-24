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
//
// The page frame, choice cards, upload box and the save / OCR calls come from
// the shared loan-form kit (components/loan-form).

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import FileUpload from "@/components/FileUpload";
import { supabase } from "@/lib/supabase";
import { openDocument, openLoanPath } from "@/lib/storage";
import { IFSC_RE, MOBILE_RE, EMAIL_RE } from "@/lib/validators";
import { professionsFor } from "@/lib/loan-form";
import { amountInput } from "@/lib/money";
// Type only (erased at build) — lib/bank-statement itself is server-side OCR code.
import type { BankStatementFields } from "@/lib/bank-statement";
import {
  StepHeader, StepLoading, StepNotFound, StepTracker, StepTitle, StepNav,
  FormSection, H16_GREEN, ErrorBox, TickCircle, CheckRow, ChoiceTile, UploadedDoc, HiddenFileInput,
  EPC_JOIN, INCOMPLETE_NOTE, postLoanFiles, saveStep, nextStepPath, type EpcNames,
} from "@/components/loan-form";

// ── Static option lists ──────────────────────────────────────────────

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
  epc_business: EpcNames | null;
};

type BankDoc = {
  path: string;
  uploaded_at: string | null;
  signed_url: string | null;
  file_name: string;
  method: "manual_epdf" | "scanned_pdf";
  docId?: string; // set → it's a document row (the EPC flow), not the column
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
          "bank_account_holder, bank_name, bank_account_no, bank_ifsc, bank_account_type, bank_mobile, bank_email, " +
          EPC_JOIN,
        )
        .eq("id", params.id)
        .maybeSingle();
      const row = data as unknown as (Loan & Record<string, any>) | null;
      setLoan(row);
      // Prefill from whatever is saved — NOT gated on step4_completed_at, so an
      // already-uploaded bank statement + bank details re-hydrate on edit even
      // if the step was never formally completed (each setter is guarded on its
      // own value, so a blank first visit stays blank).
      if (row) {
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
        } else {
          // The EPC's chatbot files the bank statement / cheque / passbook as a
          // document row only — show its latest one as THE bank statement, not
          // under "Additional bank statements".
          const { data: bd } = await supabase()
            .from("user_application_docs")
            .select("id, storage_path, file_name, created_at")
            .eq("application_id", params.id)
            .eq("category", "bank_statement")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (bd) {
            const m = row.bank_statement_method ?? "scanned_pdf";
            setMethod(m);
            setBankDoc({ path: bd.storage_path, uploaded_at: bd.created_at, signed_url: null, file_name: bd.file_name ?? "Bank statement", method: m, docId: bd.id });
          }
        }
        if (row.bank_account_holder) setAccountHolder(row.bank_account_holder);
        if (row.bank_name)           setBankName(row.bank_name);
        if (row.bank_account_no)     setAccountNo(row.bank_account_no);
        if (row.bank_ifsc)           setIfsc(row.bank_ifsc);
        if (row.bank_account_type)   setAccountType(row.bank_account_type);
        if (row.bank_mobile)         setBankMobile(row.bank_mobile);
        // No field on screen — kept so a save doesn't wipe it (a malformed one,
        // which the save would reject, is dropped).
        setBankEmail(validEmailOrEmpty(row.bank_email));
        // Only treat the bank as pre-confirmed when there IS saved bank data —
        // otherwise a blank first visit would skip confirmation.
        if (row.bank_statement_path || row.bank_account_no) setBankConfirmed(true);
      }
      setLoading(false);
    })();
  }, [params.id]);

  const professionOptions = useMemo(() => professionsFor(employment), [employment]);

  // ── Bank statement upload ──────────────────────────────────────────

  async function uploadBankStatement(file: File) {
    if (!loan || !method) return;
    // A statement already on screen → this upload replaces it (read below).
    const replacing = !!bankDoc;
    setUploadError(null);
    setUploading(true);
    // On re-upload we blow away the previously-shown retrieved fields
    // and confirm state — admin needs to re-review the new extraction.
    setBankConfirmed(false);
    try {
      const r = await postLoanFiles(loan.id, "extract-bank-statement", { file, method });
      if (!r.ok) {
        setUploadError(r.error);
        return;
      }
      const data = r.data;
      setBankDoc({
        path: data.storage_path,
        uploaded_at: data.uploaded_at,
        signed_url: data.signed_url,
        file_name: file.name,
        method,
      });
      // Prefill retrieved bank info. Replacing a statement: this one's read
      // values replace the old one's, and a field it didn't read is cleared
      // for the team to fill. First statement: only empty fields are filled.
      const f = data.fields as BankStatementFields;
      const fill = (cur: string, read: string | null) => (replacing ? read || "" : cur || read || "");
      // Account-holder NAME is deliberately NOT auto-filled — OCR gets it wrong
      // too often, so the admin types it manually. (The parser still extracts it
      // into ocr_raw_text/debug; we just don't populate the form field.)
      setBankName(fill(bankName, f.bank_name));
      setOcrAccountNo(f.account_no || null);
      setAccountNo(fill(accountNo, f.account_no));
      setIfsc(fill(ifsc, f.ifsc));
      setAccountType(fill(accountType, f.account_type));
      setBankMobile(fill(bankMobile, f.mobile));
      // No email field on screen — an OCR email the save would reject is dropped.
      setBankEmail(fill(bankEmail, validEmailOrEmpty(f.email)));
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
    if (!loan) return; // admin-only flow: never block on missing fields/docs
    setSaveError(null);
    setSaving(true);
    try {
      // Admin-only flow: the bank statement / fields may be absent — save
      // whatever is present as a draft (null-safe; never block, never crash).
      const body = {
        employment_type:   employment,
        profession,
        profession_other:  profession === "Other" ? professionOther.trim() : null,
        organization_name: organization.trim() || null,
        annual_income:     Number(annualIncome) || null,
        bank_statement_method:      bankDoc?.method ?? null,
        // A document-row statement stays a row (the column would show it twice).
        bank_statement_path:        bankDoc?.docId ? null : bankDoc?.path ?? null,
        bank_statement_uploaded_at: bankDoc?.docId ? null : bankDoc?.uploaded_at ?? null,
        bank_account_holder: accountHolder.trim(),
        bank_name:           bankName.trim(),
        bank_account_no:     accountNo.trim(),
        bank_ifsc:           ifsc.trim().toUpperCase(),
        bank_account_type:   accountType || null,
        bank_mobile:         bankMobile || null,
        bank_email:          bankEmail.trim() || null,
      };
      const error = await saveStep(loan.id, 4, body);
      if (error) {
        setSaveError(error);
        setSaving(false);
        return;
      }
      router.push(nextStepPath(loan.id, "step-5") as any);
    } catch (e) {
      setSaveError((e as Error)?.message || "Network error.");
      setSaving(false);
    }
  }

  if (loading) return <StepLoading />;
  if (!loan) return <StepNotFound />;

  return (
    <main className="min-h-screen bg-bg-soft">
      <StepHeader step={4} backTo={`/admin/app/${params.id}/step-3`} />

      <section className="max-w-[880px] mx-auto px-5 sm:px-7 py-8 space-y-5">
        <StepTracker loan={loan} step={4} />

        <StepTitle title="Personal Details">
          Capture the customer&rsquo;s employment info and verify bank details from
          a recent statement. All bank fields are prefilled from OCR — every one
          is editable, so correct anything before confirming.
        </StepTitle>

        {/* b. Verified Information (collapsible) */}
        <Card className="p-0 overflow-hidden">
          <button
            type="button"
            onClick={() => setKycOpen((v) => !v)}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-bg-tint transition-colors"
          >
            <div className="flex items-center gap-2">
              <TickCircle />
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
        <FormSection title="Employment information">
          <div>
            <p className="block mb-2 text-[13px] font-medium text-text-mid">Employment type</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <ChoiceTile
                fadeDot
                active={employment === "salaried"}
                onClick={() => { setEmployment("salaried"); setProfession(""); setProfessionOther(""); }}
                title="Salaried"
                desc="Employee of a company / organisation"
              />
              <ChoiceTile
                fadeDot
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
                  onChange={(e) => setAnnualIncome(amountInput(e.target.value))}
                  placeholder="e.g. 800000"
                />
              </div>
            </>
          )}
        </FormSection>

        {/* d. Bank Statement */}
        <FormSection title="Bank statement">
          <p className="text-[13px] text-text-mid">
            Upload a recent bank statement so we can verify income and pull the
            customer&rsquo;s account details. Pick the source that matches the file.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <ChoiceTile
              fadeDot
              active={method === "manual_epdf"}
              onClick={() => setMethod("manual_epdf")}
              title="Manual E-PDF Upload"
              desc="E-PDF downloaded from netbanking / bank email"
            />
            <ChoiceTile
              fadeDot
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
                onView={bankDoc ? () => {
                  // A fresh upload already has a valid signed URL; only fall back
                  // to the sign-doc route (whitelisted on the persisted *_path)
                  // for a reloaded doc where no signed_url is in hand.
                  if (bankDoc.signed_url) window.open(bankDoc.signed_url, "_blank", "noopener");
                  else if (bankDoc.docId) void openDocument(bankDoc.docId);
                  else void openLoanPath(params.id, bankDoc.path);
                } : undefined}
              />
            </div>
          )}

          <ErrorBox message={uploadError} />

          {/* Additional bank statements — stored as user_application_docs rows
              (category "bank_statement"), separate from the primary column
              above. The primary statement drives OCR; these are extra
              supporting statements (more months / a second account). The
              view profile and the download ZIP both dual-read the two stores. */}
          <div className="pt-4 border-t border-line">
            <p className="text-[13px] font-medium text-text-mid mb-1">
              Additional bank statements{" "}
              <span className="text-text-muted font-normal">(optional)</span>
            </p>
            <FileUpload
              applicationId={loan.id}
              category="bank_statement"
              table="user_application_docs"
              uploadedBy="admin"
              maxFiles={6}
              uploadHint="PDF or image — up to 6 files"
              hideIds={bankDoc?.docId ? [bankDoc.docId] : undefined}
            />
          </div>
        </FormSection>

        {/* Other supporting documents — any extra files, as many as needed. */}
        <FormSection
          title={<>Other documents <span className="text-text-muted font-normal text-[13px]">(optional)</span></>}
          className="p-6 space-y-2"
          titleClassName={H16_GREEN}
        >
          <p className="text-[12px] text-text-muted">
            Add any other supporting documents for this application — add as many as you need.
          </p>
          <FileUpload
            applicationId={loan.id}
            category="other"
            table="user_application_docs"
            uploadedBy="admin"
            maxFiles={20}
            uploadHint="PDF or image — add as many as needed"
          />
        </FormSection>

        {/* e. Retrieved Bank Information */}
        {bankDoc && (
          <Card className="p-6 bg-[#f0faf5] border-[#cdeadd] space-y-4">
            <div className="flex items-center gap-2">
              <TickCircle />
              <h2 className={H16_GREEN}>
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

            <CheckRow
              checked={bankConfirmed}
              onChange={setBankConfirmed}
              className="flex items-start gap-2 text-[14px] cursor-pointer pt-1"
            >
              I have reviewed the retrieved bank information above and confirm
              it is correct.
            </CheckRow>
          </Card>
        )}

        {/* f. Previous / Next */}
        <StepNav
          error={saveError}
          prevTo={`/admin/app/${loan.id}/step-3`}
          onNext={saveAndNext}
          saving={saving}
          nextTitle={canNext ? undefined : INCOMPLETE_NOTE}
        />
      </section>
    </main>
  );
}

// ── Small helpers ────────────────────────────────────────────────────

// The email when it passes complete-step-4's check, else "".
function validEmailOrEmpty(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return EMAIL_RE.test(s) ? s : "";
}

// The bank statement slot: the shared "file on record" box once uploaded,
// otherwise this page's own large upload tile (with an upload icon).
function BankDocSlot({
  doc, uploading, onFile, onView,
}: {
  doc: BankDoc;
  uploading: boolean;
  onFile: (f: File) => void;
  onView?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      {doc ? (
        <UploadedDoc
          fileName={doc.file_name}
          uploadedAt={doc.uploaded_at}
          onView={onView}
          onReupload={() => inputRef.current?.click()}
          uploading={uploading}
        />
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={[
            "w-full min-h-[140px] rounded-input border-2 border-dashed border-[#185fa5] bg-white text-[#185fa5] transition-colors flex flex-col items-center justify-center text-center px-4",
            "hover:bg-[#f2f7fc]",
            uploading ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#185fa5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mb-2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-[14px] font-semibold">
            {uploading ? "Uploading & extracting…" : "Click to upload"}
          </p>
          <p className="text-[12px] text-[#5a86b3] mt-0.5">Photo, scan, or PDF</p>
        </button>
      )}
      <HiddenFileInput ref={inputRef} onFile={onFile} />
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
