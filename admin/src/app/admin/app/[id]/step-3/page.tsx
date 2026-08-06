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
import DatePicker from "@/components/ui/DatePicker";
import FileUpload from "@/components/FileUpload";
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
  borrower_mobile: string | null;
  borrower_email:  string | null;
  rooftop_photo_path: string | null;
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
  // Co-applicant Aadhaar OCR (mirrors applicant KYC — Step 2 shape).
  aadhaar_name:   string;
  aadhaar_dob:    string;
  aadhaar_gender: string;
  aadhaar_number: string;              // full 12 digits
  aadhaar_care_of: string;
  aadhaar_address: string;
  aadhaar_front_path: string | null;
  aadhaar_back_path:  string | null;
  aadhaar_face_path:  string | null;
  aadhaar_front_signed_url: string | null;
  aadhaar_back_signed_url:  string | null;
  aadhaar_uploading:  boolean;
  aadhaar_error:      string | null;
};

const EMPTY_COAPP: Coapp = {
  pan: "", name: "", father_name: "", dob: "",
  relation: "", mobile: "", email: "",
  pan_path: null, pan_uploaded_at: null, pan_signed_url: null,
  aadhaar_name: "", aadhaar_dob: "", aadhaar_gender: "",
  aadhaar_number: "", aadhaar_care_of: "", aadhaar_address: "",
  aadhaar_front_path: null, aadhaar_back_path: null, aadhaar_face_path: null,
  aadhaar_front_signed_url: null, aadhaar_back_signed_url: null,
  aadhaar_uploading: false, aadhaar_error: null,
};

// Sign a whitelisted *_path column via the admin sign-doc route; returns the
// signed URL (or null). Used to make View work on reload for docs that are
// only persisted as a path column (no user_application_docs row yet).
async function signLoanPath(id: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/admin/loan-app/${id}/sign-doc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
      body: JSON.stringify({ path }),
    });
    const data = await res.json().catch(() => ({}));
    return data?.ok && data.url ? (data.url as string) : null;
  } catch {
    return null;
  }
}

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
  const [rooftopDoc,       setRooftopDoc]       = useState<{ id: string; storage_path: string; file_name: string | null } | null>(null);
  const [rooftopGps,       setRooftopGps]       = useState<{ lat: number; lng: number; captured_at: string } | null>(null);

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
          "install_pincode, install_state, install_city, step3_completed_at, " +
          "borrower_mobile, borrower_email, rooftop_photo_path, " +
          "proforma_invoice_path, proforma_uploaded_at, ebill_path, ebill_uploaded_at, " +
          "project_size, project_size_unit, total_project_cost, loan_amount_required, " +
          "monthly_bill_amount, discom_name, ca_number, ebill_address_line, ebill_name, " +
          "bill_on_applicant_name, " +
          "coapp_pan, coapp_name, coapp_father_name, coapp_dob, coapp_relation, " +
          "coapp_mobile, coapp_email, coapp_pan_path, " +
          "coapp_aadhaar_name, coapp_aadhaar_dob, coapp_aadhaar_gender, coapp_aadhaar_number, " +
          "coapp_aadhaar_care_of, coapp_aadhaar_address, coapp_aadhaar_front_path, coapp_aadhaar_back_path, " +
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .eq("id", params.id)
        .maybeSingle();
      const l = data as unknown as (Loan & Record<string, any>) | null;
      setLoan(l);
      // Full prefill from a PREVIOUS Step 3 save (edit / resume pass).
      // On first visit everything starts blank — including the pincode,
      // which is intentionally NOT copied from the registration page
      // because the installation site may be at a different place.
      if (l && l.step3_completed_at) {
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
            pan_uploaded_at: l.step3_completed_at,
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

  // Co-applicant Aadhaar OCR — reuses the same server route the applicant
  // KYC on Step 2 uses. Uploads FRONT + BACK together, prefills fields.
  async function uploadCoappAadhaar(front: File, back: File) {
    setCoapp((c) => ({ ...c, aadhaar_uploading: true, aadhaar_error: null }));
    try {
      const fd = new FormData();
      fd.append("front", front);
      fd.append("back",  back);
      const res = await fetch(`/api/admin/loan-app/${loan!.id}/extract-aadhaar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setCoapp((c) => ({ ...c, aadhaar_uploading: false, aadhaar_error: data?.error || `Upload failed (HTTP ${res.status}).` }));
        return;
      }
      const f = data.fields ?? {};
      const frontPath = data.storage_paths?.front ?? null;
      const backPath  = data.storage_paths?.back  ?? null;
      // Sign the freshly-uploaded front/back so View is available immediately.
      const [frontU, backU] = await Promise.all([
        frontPath ? signLoanPath(params.id, frontPath) : Promise.resolve(null),
        backPath  ? signLoanPath(params.id, backPath)  : Promise.resolve(null),
      ]);
      setCoapp((c) => ({
        ...c,
        aadhaar_uploading: false,
        aadhaar_error: null,
        aadhaar_name:    c.aadhaar_name    || (f.name    ?? ""),
        aadhaar_dob:     c.aadhaar_dob     || (f.dob     ?? ""),
        aadhaar_gender:  c.aadhaar_gender  || (f.gender  ?? ""),
        aadhaar_care_of: c.aadhaar_care_of || (f.care_of ?? ""),
        aadhaar_address: c.aadhaar_address || (f.address ?? ""),
        aadhaar_number:  c.aadhaar_number  || (f.aadhaar_number ?? ""),
        aadhaar_front_path: frontPath,
        aadhaar_back_path:  backPath,
        aadhaar_face_path:  data.storage_paths?.face  ?? null,
        aadhaar_front_signed_url: frontU,
        aadhaar_back_signed_url:  backU,
        // Cross-fill the co-applicant's MAIN fields from the Aadhaar
        // when they're still empty — same "fetch details properly"
        // behavior the applicant gets. PAN OCR may already have filled
        // name/dob; empty-only guard means neither source clobbers.
        name: c.name || (f.name ?? ""),
        dob:  c.dob  || (f.dob  ?? ""),
      }));
    } catch (e) {
      setCoapp((c) => ({ ...c, aadhaar_uploading: false, aadhaar_error: (e as Error)?.message || "Network error." }));
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
    !!proforma && !!ebill &&
    validSize && validCost && validLoan && !loanExceedsCost &&
    addressComplete &&
    ownership !== null &&
    (ownership === "yes" || coappComplete) &&
    !saving;

  // ── Submit ─────────────────────────────────────────────────────────

  async function saveAndNext() {
    if (!loan) return; // admin-only flow: never block on missing fields/docs
    // The quotation and e-bill uploads must have succeeded before we can
    // persist their storage paths. If one was skipped or its upload/OCR call
    // failed silently, `proforma`/`ebill` are null — stop with a clear message
    // instead of crashing on `.path` ("Cannot read properties of null").
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
        monthly_bill_amount:   Number(monthlyBill) || null,
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
        if (coapp.aadhaar_number && /^\d{12}$/.test(coapp.aadhaar_number)) {
          body.coapp_aadhaar_number = coapp.aadhaar_number;
        }
        if (coapp.aadhaar_front_path)  body.coapp_aadhaar_front_path  = coapp.aadhaar_front_path;
        if (coapp.aadhaar_back_path)   body.coapp_aadhaar_back_path   = coapp.aadhaar_back_path;
        if (coapp.aadhaar_face_path)   body.coapp_aadhaar_face_path   = coapp.aadhaar_face_path;
      }
      // Rooftop photo — optional (spec adds it under installation address).
      if (rooftopDoc) {
        body.rooftop_photo_path = rooftopDoc.storage_path;
        body.rooftop_photo_uploaded_at = new Date().toISOString();
        if (rooftopGps) body.rooftop_photo_gps = rooftopGps;
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
      const fromReview = new URLSearchParams(window.location.search).get("from") === "review";
      router.push(`/admin/app/${loan.id}/${fromReview ? "step-6" : "step-4"}` as any);
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
            <button
              type="button"
              onClick={() => router.push(`/admin/app/${params.id}/view` as any)}
              aria-label="Back to previous page"
              className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#185fa5] hover:text-[#0f3d2e] transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              Back
            </button>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">
              Loan Application · Step 3
            </span>
          </div>
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
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-[#0f3d2e]">
            Loan Requirements
          </h1>
          <p className="text-text-mid mt-2 text-[15px]">
            Upload the proforma invoice and the latest electricity bill. Project,
            loan, and connection details are prefilled from OCR — every field below
            is editable so you can correct anything before saving.
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
                });
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
        </Card>

        {/* g. Bill Ownership Confirmation */}
        <Card className="p-6 bg-[#f0faf5] border-[#cdeadd] space-y-4">
          <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">
            Please confirm the electricity bill is in the name of the applicant.
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
                Yes, the bill is in the applicant&rsquo;s name
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
                No, the bill is not in the applicant&rsquo;s name (add a co-applicant)
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
              <DatePicker
                label="Date of birth"
                value={coapp.dob}
                onChange={(v) => setCoapp({ ...coapp, dob: v })}
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
                error={coappMobileConflict ? "Cannot be the same as the applicant's mobile." : undefined}
              />
              <Input
                label="Email"
                type="email"
                value={coapp.email}
                onChange={(e) => setCoapp({ ...coapp, email: e.target.value })}
                error={coappEmailConflict ? "Cannot be the same as the applicant's email." : undefined}
              />
            </div>

            {/* Co-applicant Aadhaar KYC — mirrors the applicant's Step 2. */}
            <div className="pt-4 border-t border-line space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-text">Co-applicant Aadhaar (KYC)</p>
                {(coapp.aadhaar_front_path || coapp.aadhaar_back_path) && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f0faf5] text-[#0f3d2e] font-semibold uppercase tracking-wide border border-[#cdeadd]">
                    Uploaded
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-muted">
                Upload the co-applicant&rsquo;s Aadhaar front and back. Details are extracted automatically.
              </p>
              <CoappAadhaarPicker
                onFiles={(front, back) => void uploadCoappAadhaar(front, back)}
                uploading={coapp.aadhaar_uploading}
                error={coapp.aadhaar_error}
                hasFront={!!coapp.aadhaar_front_path}
                hasBack={!!coapp.aadhaar_back_path}
                frontUrl={coapp.aadhaar_front_signed_url}
                backUrl={coapp.aadhaar_back_signed_url}
              />

              {(coapp.aadhaar_name || coapp.aadhaar_dob || coapp.aadhaar_number) && (
                <div className="grid sm:grid-cols-2 gap-4 pt-2">
                  <Input
                    label="Aadhaar name"
                    value={coapp.aadhaar_name}
                    onChange={(e) => setCoapp({ ...coapp, aadhaar_name: e.target.value })}
                  />
                  <DatePicker
                    label="Aadhaar DOB"
                    value={coapp.aadhaar_dob}
                    onChange={(v) => setCoapp({ ...coapp, aadhaar_dob: v })}
                  />
                  <Input
                    label="Gender"
                    value={coapp.aadhaar_gender}
                    onChange={(e) => setCoapp({ ...coapp, aadhaar_gender: e.target.value })}
                  />
                  <div>
                    <label className="block mb-1.5 text-[13px] font-medium text-text-mid">
                      Aadhaar number
                    </label>
                    <input
                      value={coapp.aadhaar_number.replace(/(\d{4})(?=\d)/g, "$1 ")}
                      onChange={(e) => setCoapp({ ...coapp, aadhaar_number: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                      maxLength={14}
                      inputMode="numeric"
                      placeholder="0000 0000 0000"
                      className="w-full px-4 py-3 rounded-input border-2 border-line font-mono text-[15px] tracking-wider outline-none focus:border-[#178a5c] bg-white"
                    />
                    <p className="mt-1 text-[11px] text-text-muted">12 digits, as printed on the card.</p>
                  </div>
                  <Input
                    label="Care of"
                    value={coapp.aadhaar_care_of}
                    onChange={(e) => setCoapp({ ...coapp, aadhaar_care_of: e.target.value })}
                  />
                  <div className="sm:col-span-2">
                    <label className="block mb-1.5 text-[13px] font-medium text-text-mid">
                      Aadhaar address
                    </label>
                    <textarea
                      value={coapp.aadhaar_address}
                      onChange={(e) => setCoapp({ ...coapp, aadhaar_address: e.target.value })}
                      rows={3}
                      className="w-full rounded-input border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-blue resize-y"
                    />
                  </div>
                </div>
              )}
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
              disabled={saving}
              title={canNext ? undefined : "Some fields are incomplete — you can still continue as admin."}
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
            "border-[#185fa5] bg-white text-[#185fa5] hover:bg-[#f2f7fc]",
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

// Two-file picker for co-applicant Aadhaar (front + back). Fires the
// callback only once BOTH files are selected so the server route can
// process them together (same shape the applicant Step 2 uses).
function CoappAadhaarPicker({
  onFiles, uploading, error, hasFront, hasBack, frontUrl, backUrl,
}: {
  onFiles: (front: File, back: File) => void;
  uploading: boolean;
  error: string | null;
  hasFront: boolean;
  hasBack: boolean;
  frontUrl?: string | null;
  backUrl?: string | null;
}) {
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef  = useRef<HTMLInputElement>(null);
  const [front, setFront] = useState<File | null>(null);
  const [back,  setBack]  = useState<File | null>(null);

  useEffect(() => {
    if (front && back) onFiles(front, back);
  }, [front, back, onFiles]);

  return (
    <div className="space-y-2">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <button
            type="button"
            onClick={() => frontRef.current?.click()}
            disabled={uploading}
            className={[
              "w-full h-[100px] rounded-input border-2 border-dashed text-center flex items-center justify-center px-3 transition-colors",
              hasFront || front
                ? "border-[#178a5c] bg-[#f0faf5] text-[#0f3d2e]"
                : "border-[#185fa5] bg-white text-[#185fa5] hover:bg-[#f2f7fc]",
              uploading ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            <div>
              <p className="text-[12px] font-semibold">Aadhaar Front</p>
              <p className="text-[10px] mt-0.5">{front ? front.name : hasFront ? "Uploaded — click to replace" : "Click to select"}</p>
            </div>
          </button>
          {frontUrl && (
            <a href={frontUrl} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#185fa5] hover:underline">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              View
            </a>
          )}
        </div>
        <div>
          <button
            type="button"
            onClick={() => backRef.current?.click()}
            disabled={uploading}
            className={[
              "w-full h-[100px] rounded-input border-2 border-dashed text-center flex items-center justify-center px-3 transition-colors",
              hasBack || back
                ? "border-[#178a5c] bg-[#f0faf5] text-[#0f3d2e]"
                : "border-[#185fa5] bg-white text-[#185fa5] hover:bg-[#f2f7fc]",
              uploading ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            <div>
              <p className="text-[12px] font-semibold">Aadhaar Back</p>
              <p className="text-[10px] mt-0.5">{back ? back.name : hasBack ? "Uploaded — click to replace" : "Click to select"}</p>
            </div>
          </button>
          {backUrl && (
            <a href={backUrl} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#185fa5] hover:underline">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              View
            </a>
          )}
        </div>
      </div>
      <input ref={frontRef} type="file" accept="image/*,application/pdf" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) setFront(f); e.target.value = ""; }} />
      <input ref={backRef} type="file" accept="image/*,application/pdf" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) setBack(f); e.target.value = ""; }} />
      {uploading && <p className="text-[12px] text-text-muted">Extracting Aadhaar details…</p>}
      {error && <p className="text-[12px] text-red-700">{error}</p>}
    </div>
  );
}
