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
import { MOBILE_RE, EMAIL_RE, PAN_RE } from "@/lib/validators";

// ── Static option lists ──────────────────────────────────────────────

const INDIA_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

const RELATIONS = [
  "Father", "Mother", "Spouse", "Son", "Daughter", "Brother", "Sister", "Other",
];

// ── Types ────────────────────────────────────────────────────────────

type Loan = {
  id: string;
  current_step: number;
  created_at: string;
  install_pincode: string | null;
  install_state:   string | null;
  install_city:    string | null;
  epc_business: {
    contact_name: string | null;
    trade_name: string | null;
    legal_name: string | null;
    epc_display_id: string | null;
  } | null;
};

type DocState = {
  path: string;
  uploaded_at: string;
  signed_url: string | null;
  file_name: string;
} | null;

type Coapp = {
  pan: string;
  name: string;
  father_name: string;
  dob: string;
  relation: string;
  mobile: string;
  email: string;
  pan_path: string | null;
  pan_uploaded_at: string | null;
  pan_signed_url: string | null;
};

const EMPTY_COAPP: Coapp = {
  pan: "", name: "", father_name: "", dob: "",
  relation: "", mobile: "", email: "",
  pan_path: null, pan_uploaded_at: null, pan_signed_url: null,
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
  const [pincode,        setPincode]        = useState<string>("");
  const [city,           setCity]           = useState<string>("");
  const [state,          setState]          = useState<string>("");
  const [pincodeBusy,    setPincodeBusy]    = useState(false);
  const [pincodeError,   setPincodeError]   = useState<string | null>(null);
  const [ebillName,      setEbillName]      = useState<string>("");

  // Bill ownership + co-applicant
  const [ownership, setOwnership] = useState<"yes" | "no" | null>(null);
  const [coapp, setCoapp] = useState<Coapp>(EMPTY_COAPP);
  const [coappUploading, setCoappUploading] = useState(false);
  const [coappUploadError, setCoappUploadError] = useState<string | null>(null);

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
          "install_pincode, install_state, install_city, " +
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .eq("id", params.id)
        .maybeSingle();
      const l = data as unknown as Loan | null;
      setLoan(l);
      if (l) {
        setPincode(l.install_pincode ?? "");
        setState(l.install_state ?? "");
        setCity(l.install_city ?? "");
      }
      setLoading(false);
    })();
  }, [params.id]);

  // Redirect past-Step-3 apps to Step 4
  useEffect(() => {
    if (loan && loan.current_step > 3) {
      router.replace(`/admin/app/${loan.id}/step-4` as any);
    }
  }, [loan, router]);

  // ── Uploads ────────────────────────────────────────────────────────

  async function uploadDoc(kind: "proforma" | "ebill", file: File) {
    setUploadError(null);
    if (kind === "proforma") setProformaUploading(true); else setEbillUploading(true);
    try {
      const fd = new FormData();
      fd.append(kind, file);
      const res = await fetch(`/api/admin/loan-app/${loan!.id}/extract-loan-docs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setUploadError(data?.error || `Upload failed (HTTP ${res.status}).`);
        return;
      }
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
        if (!addressLine && e.fields.ebill_address_line) setAddressLine(e.fields.ebill_address_line);
        if (!pincode     && e.fields.pincode)            {
          setPincode(e.fields.pincode);
          void lookupPincode(e.fields.pincode);
        }
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
    if (!/^[1-9]\d{5}$/.test(pin)) return;
    setPincodeBusy(true);
    try {
      const res = await fetch(`/api/admin/pincode-lookup?pin=${pin}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setPincodeError(data?.error || "Lookup failed — enter state manually.");
        return;
      }
      if (!state) setState(String(data.state ?? ""));
      if (!city)  setCity(String(data.city  ?? ""));
    } catch {
      setPincodeError("Lookup failed — enter state manually.");
    } finally {
      setPincodeBusy(false);
    }
  }

  async function uploadCoappPan(file: File) {
    setCoappUploadError(null);
    setCoappUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/loan-app/${loan!.id}/extract-coapp-pan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setCoappUploadError(data?.error || `Upload failed (HTTP ${res.status}).`);
        return;
      }
      setCoapp((c) => ({
        ...c,
        pan:         c.pan         || (data.fields.pan ?? ""),
        name:        c.name        || (data.fields.name ?? ""),
        father_name: c.father_name || (data.fields.father_name ?? ""),
        dob:         c.dob         || (data.fields.dob ?? ""),
        pan_path:        data.storage_path ?? null,
        pan_uploaded_at: data.uploaded_at ?? null,
        pan_signed_url:  data.signed_url ?? null,
      }));
    } catch (e) {
      setCoappUploadError((e as Error)?.message || "Network error.");
    } finally {
      setCoappUploading(false);
    }
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
    /^[1-9]\d{5}$/.test(pincode) &&
    city.trim().length > 0 &&
    state.trim().length > 0;

  const coappComplete =
    ownership === "no" &&
    !!coapp.pan_path &&
    PAN_RE.test(coapp.pan.trim().toUpperCase()) &&
    coapp.name.trim().length > 0 &&
    coapp.father_name.trim().length > 0 &&
    coapp.dob.trim().length > 0 &&
    !!coapp.relation &&
    MOBILE_RE.test(coapp.mobile) &&
    EMAIL_RE.test(coapp.email);

  const canNext =
    !!proforma && !!ebill &&
    validSize && validCost && validLoan && !loanExceedsCost &&
    addressComplete &&
    ownership !== null &&
    (ownership === "yes" || coappComplete) &&
    !saving;

  // ── Submit ─────────────────────────────────────────────────────────

  async function saveAndNext() {
    if (!loan || !canNext) return;
    setSaveError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        proforma_invoice_path: proforma!.path,
        proforma_uploaded_at:  proforma!.uploaded_at,
        ebill_path:            ebill!.path,
        ebill_uploaded_at:     ebill!.uploaded_at,
        project_size:          sizeN,
        project_size_unit:     projectUnit,
        total_project_cost:    costN,
        loan_amount_required:  loanN,
        monthly_bill_amount:   Number(monthlyBill) || null,
        discom_name:           discomName || null,
        ca_number:             caNumber || null,
        ebill_address_line:    addressLine,
        ebill_name:            ebillName || null,
        install_pincode:       pincode,
        install_state:         state,
        install_city:          city,
        bill_on_applicant_name: ownership === "yes",
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
      }
      const res = await fetch(`/api/admin/loan-app/${loan.id}/complete-step-3`, {
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
      router.push(`/admin/app/${loan.id}/step-4` as any);
    } catch (e) {
      setSaveError((e as Error)?.message || "Network error.");
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

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
              Loan Application · Step 3
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
          currentStep={3}
        />

        <div>
          <h1 className="font-display text-[26px] sm:text-[30px] font-bold">Loan requirements</h1>
          <p className="text-text-mid mt-1 text-[14px]">
            Upload the proforma invoice and the latest electricity bill. We&rsquo;ll
            prefill project, loan, and connection details from OCR — you review
            and correct before saving.
          </p>
        </div>

        {/* b. Document Upload */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Document upload</h2>
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
          {uploadError && (
            <div className="p-3 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700">
              {uploadError}
            </div>
          )}
        </Card>

        {/* c. Project & Loan Details */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Project &amp; loan details</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="block mb-1.5 text-[13px] font-medium text-text-mid">Project size</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={projectSize}
                  onChange={(e) => setProjectSize(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="e.g. 5"
                  className="flex-1 min-w-0 border border-line rounded-input px-3.5 py-2.5 text-[14px] outline-none focus:border-blue bg-white"
                />
                <select
                  value={projectUnit}
                  onChange={(e) => setProjectUnit(e.target.value as "kw" | "mw")}
                  className="w-[100px] border border-line rounded-input px-3 py-2.5 text-[14px] outline-none focus:border-blue bg-white"
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
              onChange={(e) => setTotalCost(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="e.g. 350000"
            />
            <Input
              label="Loan amount required (₹)"
              type="text"
              inputMode="numeric"
              value={loanAmount}
              onChange={(e) => setLoanAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="e.g. 250000"
              error={loanExceedsCost ? "Loan amount cannot exceed total project cost." : undefined}
            />
          </div>
        </Card>

        {/* d. Project Summary — read-only computed */}
        {(validCost || validLoan || sizeKw) && (
          <Card className="p-6 bg-[#f0faf5] border-[#cdeadd] space-y-3">
            <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">Project summary</h2>
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
                value={costPerKw !== null ? `₹${Math.round(costPerKw).toLocaleString("en-IN")}` : "—"} />
            </div>
          </Card>
        )}

        {/* e. Electricity Connection */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Electricity connection</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Monthly electricity bill (₹)"
              type="text"
              inputMode="numeric"
              value={monthlyBill}
              onChange={(e) => setMonthlyBill(e.target.value.replace(/[^\d.]/g, ""))}
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
        </Card>

        {/* f. Installation Address */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Installation address</h2>
          <Input
            label="Address line"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            placeholder="Flat / building / street"
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
        </Card>

        {/* g. Bill Ownership Confirmation */}
        <Card className="p-6 bg-[#f0faf5] border-[#cdeadd] space-y-4">
          <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">
            Bill ownership confirmation
          </h2>
          {ebillName ? (
            <p className="text-[13px]">
              Name on e-bill:{" "}
              <span className="font-semibold text-[#0f3d2e]">{ebillName}</span>
            </p>
          ) : (
            <p className="text-[13px] text-text-muted">
              Name on e-bill not detected. Confirm ownership manually below.
            </p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => { setOwnership("yes"); setCoapp(EMPTY_COAPP); }}
              className={[
                "text-left rounded-input border-2 p-4 transition-colors",
                ownership === "yes"
                  ? "border-[#178a5c] bg-white"
                  : "border-line bg-white hover:border-[#185fa5]",
              ].join(" ")}
            >
              <p className="font-semibold text-[14px] text-[#0f3d2e]">
                Yes, bill is on applicant&rsquo;s name
              </p>
              <p className="text-[12px] text-text-muted mt-1">
                No co-applicant needed.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setOwnership("no")}
              className={[
                "text-left rounded-input border-2 p-4 transition-colors",
                ownership === "no"
                  ? "border-[#178a5c] bg-white"
                  : "border-line bg-white hover:border-[#185fa5]",
              ].join(" ")}
            >
              <p className="font-semibold text-[14px] text-[#0f3d2e]">
                No, add co-applicant
              </p>
              <p className="text-[12px] text-text-muted mt-1">
                Bill is on someone else&rsquo;s name.
              </p>
            </button>
          </div>
        </Card>

        {/* h. Co-Applicant block (conditional) */}
        {ownership === "no" && (
          <Card className="p-6 space-y-4">
            <h2 className="font-display font-semibold text-[16px]">Co-applicant details</h2>

            <div>
              <p className="block mb-1.5 text-[13px] font-medium text-text-mid">
                Co-applicant PAN card
              </p>
              <CoappPanTile
                doc={coapp.pan_path ? {
                  path: coapp.pan_path,
                  uploaded_at: coapp.pan_uploaded_at ?? "",
                  signed_url: coapp.pan_signed_url,
                  file_name: "Co-applicant PAN",
                } : null}
                uploading={coappUploading}
                onFile={(f) => void uploadCoappPan(f)}
              />
              {coappUploadError && (
                <p className="mt-2 text-[12px] text-red-700">{coappUploadError}</p>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                label="PAN number"
                value={coapp.pan}
                onChange={(e) => setCoapp({ ...coapp, pan: e.target.value.toUpperCase() })}
                placeholder="AAAAA9999A"
                maxLength={10}
              />
              <Input
                label="Name"
                value={coapp.name}
                onChange={(e) => setCoapp({ ...coapp, name: e.target.value })}
              />
              <Input
                label="Father's name"
                value={coapp.father_name}
                onChange={(e) => setCoapp({ ...coapp, father_name: e.target.value })}
              />
              <Input
                label="Date of birth"
                value={coapp.dob}
                onChange={(e) => setCoapp({ ...coapp, dob: e.target.value })}
                placeholder="DD/MM/YYYY"
              />
              <Select
                label="Relation with applicant"
                placeholder="Select relation"
                options={RELATIONS.map((r) => ({ value: r, label: r }))}
                value={coapp.relation}
                onChange={(e) => setCoapp({ ...coapp, relation: e.target.value })}
              />
              <Input
                label="Mobile number"
                inputMode="numeric"
                maxLength={10}
                value={coapp.mobile}
                onChange={(e) => setCoapp({ ...coapp, mobile: e.target.value.replace(/\D/g, "") })}
                placeholder="10-digit"
              />
              <Input
                label="Email"
                type="email"
                value={coapp.email}
                onChange={(e) => setCoapp({ ...coapp, email: e.target.value })}
              />
            </div>
          </Card>
        )}

        {/* i. Prev / Next */}
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
              onClick={() => router.push(`/admin/app/${loan.id}/step-2` as any)}
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

function DocSlot({
  label, doc, uploading, onFile,
}: {
  label: string;
  doc: DocState;
  uploading: boolean;
  onFile: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const has = !!doc;
  const uploaded = has && doc ? new Date(doc.uploaded_at) : null;
  return (
    <div>
      <p className="block mb-1.5 text-[13px] font-medium text-text-mid">{label}</p>
      {has ? (
        <div className="rounded-input border-2 border-[#178a5c] bg-[#f0faf5] p-4 space-y-2">
          <p className="text-[13px] font-semibold text-[#0f3d2e]">{doc!.file_name}</p>
          {uploaded && (
            <p className="text-[11px] text-[#5a8a76]">
              Uploaded on {uploaded.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            {doc!.signed_url && (
              <a
                href={doc!.signed_url}
                target="_blank"
                rel="noopener"
                className="text-[12px] font-semibold text-[#185fa5] hover:underline"
              >
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
            <p className="text-[11px] mt-1">Photo, scan, or PDF</p>
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

function CoappPanTile({
  doc, uploading, onFile,
}: {
  doc: DocState;
  uploading: boolean;
  onFile: (f: File) => void;
}) {
  return (
    <DocSlot
      label=""
      doc={doc}
      uploading={uploading}
      onFile={onFile}
    />
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="min-w-[130px] text-text-muted">{label}</dt>
      <dd className="font-semibold text-[#0f3d2e]">{value}</dd>
    </div>
  );
}
