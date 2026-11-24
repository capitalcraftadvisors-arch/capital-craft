"use client";

// Loan Application — Step 3 (Loan Requirements)
//
// Seven sections stacked vertically inside the standard tracker card:
//   a. Header (tracker at step 3 of 6)
//   b. Document upload — Proforma + E-bill (mandatory)
//         · Each upload triggers OCR via /api/admin/loan-app/[id]/extract-loan-docs
//         · On success we prefill downstream sections with OCR values
//   c. Project & Loan Details — size + unit, cost, loan amount
//         · Inline validation: loan ≤ cost
//   d. Project Summary — read-only computed card
//   e. Electricity Connection — bill amount, DISCOM, CA no
//   f. Installation Address — line, pincode → auto-fill state/city
//   g. Bill Ownership — Yes / No
//         · No reveals the co-applicant block
//   h. Co-applicant (conditional): PAN upload w/ OCR + fields
//   i. Previous / Next buttons
//
// The page frame, section cards, upload box and the save / OCR / pincode calls
// come from the shared loan-form kit (components/loan-form).

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import FileUpload from "@/components/FileUpload";
import { supabase } from "@/lib/supabase";
import { signLoanPath } from "@/lib/storage";
import { MOBILE_RE, EMAIL_RE, PAN_RE, PINCODE_RE, AADHAAR_RE } from "@/lib/validators";
import { INDIA_STATES } from "@/lib/india-states";
import { amountInput, numberInput, fmtRupees } from "@/lib/money";
import LoanShareChips from "@/components/LoanShareChips";
import {
  StepHeader, StepLoading, StepNotFound, StepTracker, StepTitle, StepNav,
  FormSection, H16_GREEN, FIELD_LABEL, ErrorBox,
  EPC_JOIN, INCOMPLETE_NOTE, postLoanFiles, fetchPincode, saveStep, nextStepPath, type EpcNames,
} from "@/components/loan-form";
import { DocSlot, OwnershipTile, SummaryRow, type DocState } from "./_parts/tiles";
import CoappSection, { EMPTY_COAPP, useCoappUploads, type Coapp } from "./_parts/CoappSection";

// ── Types (the document slot and the co-applicant ones: ./_parts) ────────

type Loan = {
  id: string;
  current_step: number;
  created_at: string;
  install_pincode: string | null;
  install_state:   string | null;
  install_city:    string | null;
  borrower_mobile: string | null;
  borrower_email:  string | null;
  rooftop_photo_path: string | null;
  system_type: string | null;
  epc_business: EpcNames | null;
};

// ── Page ─────────────────────────────────────────────────────────────

export default function LoanAppStep3Page() {
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

  // Uploaded documents
  const [proforma, setProforma] = useState<DocState>(null);
  const [ebill,    setEbill]    = useState<DocState>(null);
  const [proformaUploading, setProformaUploading] = useState(false);
  const [ebillUploading,    setEbillUploading]    = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Project + loan
  const [projectSize,    setProjectSize]    = useState<string>("");
  const [projectUnit,    setProjectUnit]    = useState<"kw" | "mw">("kw");
  const [totalCost,      setTotalCost]      = useState<string>("");
  const [loanAmount,     setLoanAmount]     = useState<string>("");

  // Electricity
  const [monthlyBill,    setMonthlyBill]    = useState<string>("");
  const [discomName,     setDiscomName]     = useState<string>("");
  const [caNumber,       setCaNumber]       = useState<string>("");

  // Installation address
  const [addressLine,    setAddressLine]    = useState<string>("");
  // OCR-fetched address from the e-bill — kept separate so we can flag
  // a mismatch if the admin edits the installation address away from
  // what the bill said (spec: "should match the electricity bill").
  const [ocrEbillAddressLine, setOcrEbillAddressLine] = useState<string | null>(null);
  const [pincode,        setPincode]        = useState<string>("");
  const [city,           setCity]           = useState<string>("");
  const [state,          setState]          = useState<string>("");
  const [pincodeBusy,    setPincodeBusy]    = useState(false);
  const [pincodeError,   setPincodeError]   = useState<string | null>(null);
  const [ebillName,      setEbillName]      = useState<string>("");

  // Rooftop photo — geo-tagged. Reuses the GeoOfficeUpload pipeline that
  // the EPC office photos use (exifr + camera GPS).
  // uploaded_at: the stored time on reload, the pick time on a fresh upload.
  const [rooftopDoc,       setRooftopDoc]       = useState<{ id: string; storage_path: string; file_name: string | null; uploaded_at: string | null } | null>(null);
  const [rooftopGps,       setRooftopGps]       = useState<{ lat: number; lng: number; captured_at: string } | null>(null);

  // Bill ownership + co-applicant
  const [ownership, setOwnership] = useState<"yes" | "no" | null>(null);
  const [coapp, setCoapp] = useState<Coapp>(EMPTY_COAPP);
  const coappUploads = useCoappUploads(params.id, setCoapp);

  // Submit
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("epc_applications")
        .select(
          "id, current_step, created_at, " +
          "install_pincode, install_state, install_city, step3_completed_at, " +
          "borrower_mobile, borrower_email, rooftop_photo_path, rooftop_photo_uploaded_at, rooftop_photo_gps, system_type, " +
          "proforma_invoice_path, proforma_uploaded_at, ebill_path, ebill_uploaded_at, " +
          "project_size, project_size_unit, total_project_cost, loan_amount_required, " +
          "monthly_bill_amount, discom_name, ca_number, ebill_address_line, ebill_name, " +
          "bill_on_applicant_name, " +
          "coapp_pan, coapp_name, coapp_father_name, coapp_dob, coapp_relation, " +
          "coapp_mobile, coapp_email, coapp_pan_path, " +
          "coapp_aadhaar_name, coapp_aadhaar_dob, coapp_aadhaar_gender, coapp_aadhaar_number, " +
          "coapp_aadhaar_care_of, coapp_aadhaar_address, coapp_aadhaar_front_path, coapp_aadhaar_back_path, " +
          EPC_JOIN,
        )
        .eq("id", params.id)
        .maybeSingle();
      const l = data as unknown as (Loan & Record<string, any>) | null;
      setLoan(l);
      // Prefill from whatever is already saved — do NOT gate on
      // step3_completed_at. Every setter below is individually guarded on its
      // own value/path, so a first visit (all columns null) still starts blank,
      // while an edit/resume ALWAYS re-hydrates uploaded docs + fields even if
      // the step was never formally "completed". Gating on the completion flag
      // was hiding already-uploaded docs on edit (fresh upload box) and letting
      // the subsequent save null-out their *_path columns.
      if (l) {
        setPincode(l.install_pincode ?? "");
        setState(l.install_state ?? "");
        setCity(l.install_city ?? "");
        if (l.proforma_invoice_path) {
          setProforma({
            path: l.proforma_invoice_path,
            uploaded_at: l.proforma_uploaded_at ?? l.step3_completed_at,
            signed_url: await signLoanPath(params.id, l.proforma_invoice_path),
            file_name: String(l.proforma_invoice_path).split("/").pop() ?? "Proforma",
          });
        }
        if (l.ebill_path) {
          setEbill({
            path: l.ebill_path,
            uploaded_at: l.ebill_uploaded_at ?? l.step3_completed_at,
            signed_url: await signLoanPath(params.id, l.ebill_path),
            file_name: String(l.ebill_path).split("/").pop() ?? "E-bill",
          });
        }
        // Re-hydrate an already-uploaded rooftop photo so the (now mandatory)
        // Next gate isn't re-blocked on reopen. Its stored upload time + GPS
        // come along so a re-save keeps them (only a fresh upload changes them).
        if (l.rooftop_photo_path) {
          setRooftopDoc({
            id: "",
            storage_path: l.rooftop_photo_path,
            file_name: String(l.rooftop_photo_path).split("/").pop() ?? "Rooftop photo",
            uploaded_at: l.rooftop_photo_uploaded_at ?? null,
          });
          if (l.rooftop_photo_gps) setRooftopGps(l.rooftop_photo_gps);
        }
        if (l.project_size != null)         setProjectSize(String(l.project_size));
        if (l.project_size_unit === "mw")   setProjectUnit("mw");
        if (l.total_project_cost != null)   setTotalCost(String(l.total_project_cost));
        if (l.loan_amount_required != null) setLoanAmount(String(l.loan_amount_required));
        if (l.monthly_bill_amount != null)  setMonthlyBill(String(l.monthly_bill_amount));
        if (l.discom_name)                  setDiscomName(l.discom_name);
        if (l.ca_number)                    setCaNumber(l.ca_number);
        if (l.ebill_address_line)           setAddressLine(l.ebill_address_line);
        if (l.ebill_name)                   setEbillName(l.ebill_name);
        if (typeof l.bill_on_applicant_name === "boolean") {
          setOwnership(l.bill_on_applicant_name ? "yes" : "no");
        }
        if (l.bill_on_applicant_name === false) {
          // Sign the co-applicant doc paths up front so View works on reload.
          const [coappPanU, coappFrontU, coappBackU] = await Promise.all([
            l.coapp_pan_path ? signLoanPath(params.id, l.coapp_pan_path) : Promise.resolve(null),
            l.coapp_aadhaar_front_path ? signLoanPath(params.id, l.coapp_aadhaar_front_path) : Promise.resolve(null),
            l.coapp_aadhaar_back_path ? signLoanPath(params.id, l.coapp_aadhaar_back_path) : Promise.resolve(null),
          ]);
          setCoapp({
            ...EMPTY_COAPP,
            pan:         l.coapp_pan ?? "",
            name:        l.coapp_name ?? "",
            father_name: l.coapp_father_name ?? "",
            dob:         l.coapp_dob ?? "",
            relation:    l.coapp_relation ?? "",
            mobile:      l.coapp_mobile ?? "",
            email:       l.coapp_email ?? "",
            pan_path:        l.coapp_pan_path ?? null,
            pan_uploaded_at: null, // no PAN upload time is stored for the co-applicant
            pan_signed_url:  coappPanU,
            aadhaar_name:    l.coapp_aadhaar_name ?? "",
            aadhaar_dob:     l.coapp_aadhaar_dob ?? "",
            aadhaar_gender:  l.coapp_aadhaar_gender ?? "",
            aadhaar_number:  l.coapp_aadhaar_number ?? "",
            aadhaar_care_of: l.coapp_aadhaar_care_of ?? "",
            aadhaar_address: l.coapp_aadhaar_address ?? "",
            aadhaar_front_path: l.coapp_aadhaar_front_path ?? null,
            aadhaar_back_path:  l.coapp_aadhaar_back_path ?? null,
            aadhaar_front_signed_url: coappFrontU,
            aadhaar_back_signed_url:  coappBackU,
          });
        }
      }
      setLoading(false);
    })();
  }, [params.id]);

  // No forward-redirect — every step stays editable (Step-6 review's
  // Edit links land here even when the application is further along).

  // ── Uploads ────────────────────────────────────────────────────────

  async function uploadDoc(kind: "proforma" | "ebill", file: File) {
    setUploadError(null);
    if (kind === "proforma") setProformaUploading(true); else setEbillUploading(true);
    try {
      const r = await postLoanFiles(loan!.id, "extract-loan-docs", { [kind]: file });
      if (!r.ok) {
        setUploadError(r.error);
        return;
      }
      const data = r.data;
      if (kind === "proforma" && data.proforma) {
        const p = data.proforma;
        setProforma({
          path: p.storage_path,
          uploaded_at: p.uploaded_at,
          signed_url: p.signed_url,
          file_name: file.name,
        });
        // Prefill downstream (editable). Never overwrite what admin already typed.
        if (!totalCost && p.fields.total_project_cost != null) {
          setTotalCost(String(p.fields.total_project_cost));
        }
        if (!projectSize && p.fields.project_size != null) {
          setProjectSize(String(p.fields.project_size));
          if (p.fields.project_size_unit === "mw") setProjectUnit("mw");
        }
      }
      if (kind === "ebill" && data.ebill) {
        const e = data.ebill;
        setEbill({
          path: e.storage_path,
          uploaded_at: e.uploaded_at,
          signed_url: e.signed_url,
          file_name: file.name,
        });
        if (!monthlyBill && e.fields.monthly_bill_amount != null) {
          setMonthlyBill(String(e.fields.monthly_bill_amount));
        }
        if (!discomName && e.fields.discom_name) setDiscomName(e.fields.discom_name);
        if (!caNumber   && e.fields.ca_number)   setCaNumber(e.fields.ca_number);
        if (e.fields.ebill_address_line) setOcrEbillAddressLine(e.fields.ebill_address_line);
        if (!addressLine && e.fields.ebill_address_line) setAddressLine(e.fields.ebill_address_line);
        // Deliberately NOT prefilling pincode from the bill — the
        // installation site may be at a different place than the bill
        // address. Admin enters the pincode manually; India Post lookup
        // fills city/state.
        if (!ebillName   && e.fields.ebill_name)         setEbillName(e.fields.ebill_name);
      }
    } catch (e) {
      setUploadError((e as Error)?.message || "Network error.");
    } finally {
      if (kind === "proforma") setProformaUploading(false); else setEbillUploading(false);
    }
  }

  async function lookupPincode(pin: string) {
    setPincodeError(null);
    if (!PINCODE_RE.test(pin)) return;
    setPincodeBusy(true);
    const r = await fetchPincode(pin);
    setPincodeBusy(false);
    if (!r.ok) {
      setPincodeError(r.error);
      return;
    }
    if (!state) setState(r.state);
    if (!city)  setCity(r.city);
  }

  // ── Derived ────────────────────────────────────────────────────────

  const costN = Number(totalCost);
  const loanN = Number(loanAmount);
  const sizeN = Number(projectSize);
  const validCost = Number.isFinite(costN) && costN > 0;
  const validLoan = Number.isFinite(loanN) && loanN > 0;
  const validSize = Number.isFinite(sizeN) && sizeN > 0;
  const loanExceedsCost = validCost && validLoan && loanN > costN;

  const downPayment = validCost && validLoan ? Math.max(0, costN - loanN) : null;
  const ltvPct      = validCost && validLoan ? (loanN / costN) * 100 : null;
  // Cost per KW: convert MW → KW if needed.
  const sizeKw      = validSize ? (projectUnit === "mw" ? sizeN * 1000 : sizeN) : null;
  const costPerKw   = validCost && sizeKw ? costN / sizeKw : null;

  const addressComplete =
    addressLine.trim().length > 0 &&
    PINCODE_RE.test(pincode) &&
    city.trim().length > 0 &&
    state.trim().length > 0;

  // Applicant contact from Step 1 (for cross-check)
  const applicantMobile = (loan?.borrower_mobile ?? "").trim();
  const applicantEmail  = (loan?.borrower_email  ?? "").trim().toLowerCase();

  // Co-applicant vs applicant mismatch checks (spec: must NOT be same)
  const coappMobileConflict = ownership === "no" &&
    coapp.mobile.trim().length > 0 &&
    applicantMobile.length > 0 &&
    coapp.mobile.trim() === applicantMobile;
  const coappEmailConflict  = ownership === "no" &&
    coapp.email.trim().length > 0 &&
    applicantEmail.length > 0 &&
    coapp.email.trim().toLowerCase() === applicantEmail;

  const coappComplete =
    ownership === "no" &&
    !!coapp.pan_path &&
    PAN_RE.test(coapp.pan.trim().toUpperCase()) &&
    coapp.name.trim().length > 0 &&
    coapp.father_name.trim().length > 0 &&
    coapp.dob.trim().length > 0 &&
    !!coapp.relation &&
    MOBILE_RE.test(coapp.mobile) &&
    EMAIL_RE.test(coapp.email) &&
    !coappMobileConflict &&
    !coappEmailConflict;

  const canNext =
    // Rooftop photo is NOT required to proceed — requiring it blocked editing
    // (incl. saving the e-bill name) on applications without one. Off-grid
    // needs no electricity bill.
    !!proforma && (!!ebill || loan?.system_type === "off_grid") &&
    validSize && validCost && validLoan && !loanExceedsCost &&
    addressComplete &&
    ownership !== null &&
    (ownership === "yes" || coappComplete) &&
    !saving;

  // ── Submit ─────────────────────────────────────────────────────────

  async function saveAndNext() {
    if (!loan) return; // admin-only flow: never block on missing fields/docs
    setSaveError(null);
    setSaving(true);
    try {
      // Admin-only flow: docs may be absent — save whatever is present as a
      // draft (null-safe; never block, never crash on a missing upload).
      const body: Record<string, unknown> = {
        proforma_invoice_path: proforma?.path ?? null,
        proforma_uploaded_at:  proforma?.uploaded_at ?? null,
        ebill_path:            ebill?.path ?? null,
        ebill_uploaded_at:     ebill?.uploaded_at ?? null,
        project_size:          sizeN,
        project_size_unit:     projectUnit,
        total_project_cost:    costN,
        loan_amount_required:  loanN,
        monthly_bill_amount:   monthlyBill.trim() === "" || !Number.isFinite(Number(monthlyBill)) ? null : Number(monthlyBill),
        discom_name:           discomName || null,
        ca_number:             caNumber || null,
        ebill_address_line:    addressLine,
        ebill_name:            ebillName || null,
        install_pincode:       pincode,
        install_state:         state,
        install_city:          city,
        bill_on_applicant_name: ownership === "yes" ? true : ownership === "no" ? false : null,
      };
      if (ownership === "no") {
        body.coapp_pan         = coapp.pan.trim().toUpperCase();
        body.coapp_name        = coapp.name.trim();
        body.coapp_father_name = coapp.father_name.trim();
        body.coapp_dob         = coapp.dob.trim();
        body.coapp_relation    = coapp.relation;
        body.coapp_mobile      = coapp.mobile;
        body.coapp_email       = coapp.email.trim();
        body.coapp_pan_path    = coapp.pan_path;
        // Co-applicant Aadhaar KYC (optional — only if any of the fields
        // are populated). Server accepts nulls for missing pieces.
        if (coapp.aadhaar_name)        body.coapp_aadhaar_name        = coapp.aadhaar_name.trim();
        if (coapp.aadhaar_dob)         body.coapp_aadhaar_dob         = coapp.aadhaar_dob.trim();
        if (coapp.aadhaar_gender)      body.coapp_aadhaar_gender      = coapp.aadhaar_gender.trim();
        if (coapp.aadhaar_care_of)     body.coapp_aadhaar_care_of     = coapp.aadhaar_care_of.trim();
        if (coapp.aadhaar_address)     body.coapp_aadhaar_address     = coapp.aadhaar_address.trim();
        if (coapp.aadhaar_number && AADHAAR_RE.test(coapp.aadhaar_number)) {
          body.coapp_aadhaar_number = coapp.aadhaar_number;
        }
        if (coapp.aadhaar_front_path)  body.coapp_aadhaar_front_path  = coapp.aadhaar_front_path;
        if (coapp.aadhaar_back_path)   body.coapp_aadhaar_back_path   = coapp.aadhaar_back_path;
        if (coapp.aadhaar_face_path)   body.coapp_aadhaar_face_path   = coapp.aadhaar_face_path;
      }
      // Rooftop photo — optional (spec adds it under installation address).
      if (rooftopDoc) {
        body.rooftop_photo_path = rooftopDoc.storage_path;
        body.rooftop_photo_uploaded_at = rooftopDoc.uploaded_at;
        if (rooftopGps) body.rooftop_photo_gps = rooftopGps;
      }
      const error = await saveStep(loan.id, 3, body);
      if (error) {
        setSaveError(error);
        setSaving(false);
        return;
      }
      router.push(nextStepPath(loan.id, "step-4") as any);
    } catch (e) {
      setSaveError((e as Error)?.message || "Network error.");
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) return <StepLoading />;
  if (!loan) return <StepNotFound />;

  return (
    <main className="min-h-screen bg-bg-soft">
      <StepHeader step={3} backTo={`/admin/app/${params.id}/step-2`} />

      <section className="max-w-[880px] mx-auto px-5 sm:px-7 py-8 space-y-5">
        <StepTracker loan={loan} step={3} />

        <StepTitle title="Loan Requirements">
          Upload the proforma invoice and the latest electricity bill. Project,
          loan, and connection details are prefilled from OCR — every field below
          is editable so you can correct anything before saving.
        </StepTitle>

        {/* b. Document Upload */}
        <FormSection title="Document upload">
          <div className="grid sm:grid-cols-2 gap-4">
            <DocSlot
              label="Proforma Invoice / Quotation"
              doc={proforma}
              uploading={proformaUploading}
              onFile={(f) => void uploadDoc("proforma", f)}
            />
            <DocSlot
              label="Latest Electricity Bill"
              doc={ebill}
              uploading={ebillUploading}
              onFile={(f) => void uploadDoc("ebill", f)}
            />
          </div>
          <ErrorBox message={uploadError} />
        </FormSection>

        {/* c. Project & Loan Details */}
        <FormSection title="Project & loan details">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className={FIELD_LABEL}>Project size</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={projectSize}
                  onChange={(e) => setProjectSize(numberInput(e.target.value))}
                  placeholder="e.g. 5"
                  className="flex-1 min-w-0 border border-line rounded-input px-3.5 py-2.5 text-[14px] outline-none focus:border-blue bg-white"
                />
                <select
                  value={projectUnit}
                  onChange={(e) => setProjectUnit(e.target.value as "kw" | "mw")}
                  className={
                    "w-[100px] border border-line rounded-input pl-3 pr-8 py-2.5 text-[14px] outline-none focus:border-blue bg-white " +
                    "appearance-none bg-[url('data:image/svg+xml;utf8,<svg fill=%22%236B8294%22 viewBox=%220 0 20 20%22 xmlns=%22http://www.w3.org/2000/svg%22><path d=%22M5 8l5 5 5-5z%22/></svg>')] bg-no-repeat bg-[length:18px] bg-[right_8px_center]"
                  }
                >
                  <option value="kw">KW</option>
                  <option value="mw">MW</option>
                </select>
              </div>
            </div>
            <Input
              label="Total project cost (₹)"
              type="text"
              inputMode="numeric"
              value={totalCost}
              onChange={(e) => setTotalCost(amountInput(e.target.value))}
              placeholder="e.g. 350000"
            />
            <Input
              label="Loan amount required (₹)"
              type="text"
              inputMode="numeric"
              value={loanAmount}
              onChange={(e) => setLoanAmount(amountInput(e.target.value))}
              placeholder="e.g. 250000"
              error={loanExceedsCost ? "Loan amount cannot exceed total project cost." : undefined}
            />
          </div>
          {/* Applied loan amount: 80 / 90 / 100 % of the project cost, or Custom. */}
          <div className="mt-3"><LoanShareChips cost={Number(totalCost) || 0} value={loanAmount} onPick={setLoanAmount} /></div>
        </FormSection>

        {/* d. Project Summary — read-only computed */}
        {(validCost || validLoan || sizeKw) && (
          <FormSection
            title="Project summary"
            className="p-6 bg-[#f0faf5] border-[#cdeadd] space-y-3"
            titleClassName={H16_GREEN}
          >
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <SummaryRow label="Project size"
                value={sizeKw ? `${projectSize} ${projectUnit.toUpperCase()} (${sizeKw.toLocaleString("en-IN")} KW)` : "—"} />
              <SummaryRow label="Project cost"
                value={validCost ? `₹${costN.toLocaleString("en-IN")}` : "—"} />
              <SummaryRow label="Loan amount"
                value={validLoan ? `₹${loanN.toLocaleString("en-IN")}` : "—"} />
              <SummaryRow label="Down payment"
                value={downPayment !== null ? `₹${downPayment.toLocaleString("en-IN")}` : "—"} />
              <SummaryRow label="Loan-to-value ratio"
                value={ltvPct !== null ? `${ltvPct.toFixed(1)}%` : "—"} />
              <SummaryRow label="Cost per KW"
                value={costPerKw !== null ? fmtRupees(costPerKw) : "—"} />
            </div>
          </FormSection>
        )}

        {/* e. Electricity Connection */}
        <FormSection title="Electricity connection">
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Monthly electricity bill (₹)"
              type="text"
              inputMode="numeric"
              value={monthlyBill}
              onChange={(e) => setMonthlyBill(e.target.value.replace(/[^\d.-]/g, "").replace(/(?!^)-/g, ""))}
              placeholder="e.g. 3500"
            />
            <Input
              label="DISCOM name"
              value={discomName}
              onChange={(e) => setDiscomName(e.target.value)}
              placeholder="e.g. BSES Rajdhani"
            />
            <Input
              label="Consumer / CA number"
              value={caNumber}
              onChange={(e) => setCaNumber(e.target.value)}
              placeholder="From the bill"
            />
          </div>
        </FormSection>

        {/* f. Installation Address */}
        <FormSection title="Installation address">
          <p className="text-[12px] text-text-mid -mt-2">
            Should match the address on the electricity bill. Edit if the site
            differs from what OCR pulled.
          </p>
          <Input
            label="Address line"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            placeholder="Flat / building / street"
            hint={
              ocrEbillAddressLine && addressLine.trim() && addressLine.trim() !== ocrEbillAddressLine.trim()
                ? `⚠ Doesn't match the e-bill address OCR read (${ocrEbillAddressLine}). Confirm before saving.`
                : undefined
            }
          />
          <div className="grid sm:grid-cols-3 gap-4">
            <Input
              label="Pincode"
              inputMode="numeric"
              maxLength={6}
              value={pincode}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
              onBlur={(e) => void lookupPincode(e.target.value)}
              error={pincodeError ?? undefined}
              hint={pincodeBusy ? "Looking up…" : undefined}
            />
            <Input
              label="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City / district"
            />
            <Select
              label="State"
              placeholder="Select state"
              options={INDIA_STATES.map((s) => ({ value: s, label: s }))}
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
          </div>

          {/* Rooftop photo — geo-tagged, reuses EPC office-photo pipeline */}
          <div className="pt-2 border-t border-line">
            <p className="text-[13px] font-medium text-text-mid mb-1.5">
              Rooftop photo (geo-tagged)
            </p>
            <p className="text-[12px] text-text-muted mb-3">
              Take a photo of the installation rooftop so the site can be verified.
              Location is captured with the photo.
            </p>
            <FileUpload
              applicationId={loan.id}
              category="borrower_photo"
              table="user_application_docs"
              uploadedBy="admin"
              captureGps
              hint="Photo, scan, or PDF. Location is captured with the upload."
              onUploaded={(info) => {
                setRooftopDoc({
                  id: info.docId,
                  storage_path: info.storagePath,
                  file_name: info.file?.name ?? null,
                  uploaded_at: new Date().toISOString(),
                });
                // The previous photo's GPS doesn't belong to this one.
                setRooftopGps(null);
                // Capture live GPS in parallel (best-effort) so we can save it
                // to rooftop_photo_gps. FileUpload also stores gps in doc.metadata
                // server-side via /api/upload; this local copy is what
                // complete-step-3 persists into the epc_applications column.
                if ("geolocation" in navigator) {
                  navigator.geolocation.getCurrentPosition(
                    (p) => setRooftopGps({
                      lat: p.coords.latitude,
                      lng: p.coords.longitude,
                      captured_at: new Date().toISOString(),
                    }),
                    () => { /* silent — GPS optional */ },
                    { timeout: 6000 },
                  );
                }
              }}
            />
          </div>
        </FormSection>

        {/* g. Bill Ownership Confirmation */}
        <FormSection
          title="Please confirm the electricity bill is in the name of the applicant."
          className="p-6 bg-[#f0faf5] border-[#cdeadd] space-y-4"
          titleClassName={H16_GREEN}
        >
          {/* Name on e-bill — always an editable field so it is captured even
              when the OCR can't read it off the bill (auto-filled when it can,
              otherwise the admin types it). */}
          <Input
            label="Name on e-bill"
            value={ebillName}
            onChange={(e) => setEbillName(e.target.value)}
            placeholder="Name as printed on the electricity bill"
            hint={ebillName ? "Auto-filled from the bill — edit if it doesn't match." : "Not auto-detected — type the name shown on the bill."}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <OwnershipTile
              active={ownership === "yes"}
              onClick={() => { setOwnership("yes"); setCoapp(EMPTY_COAPP); }}
              title="Yes, the bill is in the applicant’s name"
              note="No co-applicant needed."
            />
            <OwnershipTile
              active={ownership === "no"}
              onClick={() => setOwnership("no")}
              title="No, the bill is not in the applicant’s name (add a co-applicant)"
              note="Bill is on someone else’s name."
            />
          </div>
        </FormSection>

        {/* h. Co-Applicant block (conditional) */}
        {ownership === "no" && (
          <CoappSection
            coapp={coapp}
            setCoapp={setCoapp}
            uploads={coappUploads}
            mobileConflict={coappMobileConflict}
            emailConflict={coappEmailConflict}
          />
        )}

        {/* i. Prev / Next */}
        <StepNav
          error={saveError}
          prevTo={`/admin/app/${loan.id}/step-2`}
          onNext={saveAndNext}
          saving={saving}
          nextTitle={canNext ? undefined : INCOMPLETE_NOTE}
        />
      </section>
    </main>
  );
}
