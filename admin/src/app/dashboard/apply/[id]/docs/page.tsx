"use client";

// EPC-facing loan application — Page 2 of 3 (Documents).
//
// Merge of admin Steps 2 + 3 document capture:
//   - Applicant PAN upload  (FileUpload → /api/upload, client extractPan OCR)
//   - Applicant Aadhaar     (front+back → /extract-aadhaar, same OCR as admin)
//   - Electricity bill      (→ /extract-loan-docs, ebill side only)
//   - Co-applicant toggle   → co-app Aadhaar + co-app PAN (same OCR routes)
//
// Nothing writes to the application row here — extraction results are
// held in state and stashed in sessionStorage keyed by the application
// id; Page 3's Submit sends everything to /api/epc/loan-apply
// phase=submit in one shot.

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import FileUpload from "@/components/FileUpload";
import EpcApplyTracker from "@/components/EpcApplyTracker";
import { getToken } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { extractPan } from "@/lib/ocr";
import { MOBILE_RE, EMAIL_RE } from "@/lib/validators";

export type EpcApplyDocsPayload = {
  borrower_pan: string | null;
  borrower_father_name: string | null;
  aadhaar_name: string | null;
  aadhaar_dob: string | null;
  aadhaar_gender: string | null;
  aadhaar_number: string | null;
  aadhaar_care_of: string | null;
  aadhaar_address: string | null;
  aadhaar_front_path: string | null;
  aadhaar_back_path: string | null;
  aadhaar_face_path: string | null;
  ebill_path: string | null;
  monthly_bill_amount: number | null;
  discom_name: string | null;
  ca_number: string | null;
  ebill_address_line: string | null;
  ebill_name: string | null;
  has_coapp: boolean;
  coapp_pan: string | null;
  coapp_name: string | null;
  coapp_dob: string | null;
  coapp_mobile: string | null;
  coapp_email: string | null;
  coapp_pan_path: string | null;
  coapp_aadhaar_name: string | null;
  coapp_aadhaar_dob: string | null;
  coapp_aadhaar_gender: string | null;
  coapp_aadhaar_number: string | null;
  coapp_aadhaar_care_of: string | null;
  coapp_aadhaar_address: string | null;
  coapp_aadhaar_front_path: string | null;
  coapp_aadhaar_back_path: string | null;
  // Bill-ownership flag mirrors admin Step 3 (bill_on_applicant_name).
  bill_on_applicant_name: boolean;
  // Quotation / proforma invoice + geo-tagged rooftop photo.
  proforma_invoice_path: string | null;
  rooftop_photo_path: string | null;
  rooftop_photo_gps: { lat: number; lng: number; captured_at: string } | null;
};

export default function EpcApplyDocsPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const appId = params.id;

  // Applicant PAN
  const [panUploaded, setPanUploaded] = useState(false);
  const [panNumber, setPanNumber]     = useState("");
  // Father's name — read from the PAN OCR, editable. Persisted to
  // borrower_father_name (migration 0050).
  const [panFather, setPanFather]     = useState("");

  // Applicant Aadhaar
  const [aFront, setAFront] = useState<File | null>(null);
  const [aBack,  setABack]  = useState<File | null>(null);
  const [aBusy,  setABusy]  = useState(false);
  const [aErr,   setAErr]   = useState<string | null>(null);
  const [aPaths, setAPaths] = useState<{ front: string; back: string; face: string | null } | null>(null);
  const [aName, setAName]   = useState("");
  const [aDob, setADob]     = useState("");
  const [aGender, setAGender] = useState("");
  const [aNumber, setANumber] = useState("");
  const [aCareOf, setACareOf] = useState("");
  const [aAddress, setAAddress] = useState("");

  // E-bill
  const [ebillBusy, setEbillBusy] = useState(false);
  const [ebillErr,  setEbillErr]  = useState<string | null>(null);
  const [ebill, setEbill] = useState<{
    path: string; monthly_bill_amount: number | null; discom_name: string | null;
    ca_number: string | null; ebill_address_line: string | null; ebill_name: string | null;
    file_name: string;
  } | null>(null);

  // Applicant contact (from Page 1) — loaded so we can block a co-applicant
  // that reuses the applicant's own email or phone.
  const [applicantMobile, setApplicantMobile] = useState("");
  const [applicantEmail,  setApplicantEmail]  = useState("");

  // Quotation / proforma invoice
  const [quotePath, setQuotePath] = useState<string | null>(null);

  // Rooftop photo (geo-tagged)
  const [rooftopPath, setRooftopPath] = useState<string | null>(null);
  const [rooftopGps,  setRooftopGps]  = useState<{ lat: number; lng: number; captured_at: string } | null>(null);

  // Co-applicant
  const [hasCoapp, setHasCoapp] = useState<boolean | null>(null);
  const [cFront, setCFront] = useState<File | null>(null);
  const [cBack,  setCBack]  = useState<File | null>(null);
  const [cBusy,  setCBusy]  = useState(false);
  const [cErr,   setCErr]   = useState<string | null>(null);
  const [cPaths, setCPaths] = useState<{ front: string; back: string } | null>(null);
  const [cName, setCName]   = useState("");
  const [cDob, setCDob]     = useState("");
  const [cGender, setCGender] = useState("");
  const [cNumber, setCNumber] = useState("");
  const [cCareOf, setCCareOf] = useState("");
  const [cAddress, setCAddress] = useState("");
  const [cMobile, setCMobile] = useState("");
  const [cEmail,  setCEmail]  = useState("");
  const [cPanBusy, setCPanBusy] = useState(false);
  const [cPanErr,  setCPanErr]  = useState<string | null>(null);
  const [cPan, setCPan]         = useState("");
  const [cPanPath, setCPanPath] = useState<string | null>(null);

  // Load applicant contact for the co-applicant conflict check.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("epc_applications")
        .select("borrower_mobile, borrower_email")
        .eq("id", appId)
        .maybeSingle();
      if (data) {
        setApplicantMobile(String((data as any).borrower_mobile ?? "").trim());
        setApplicantEmail(String((data as any).borrower_email ?? "").trim());
      }
    })();
  }, [appId]);

  // Run applicant-Aadhaar extraction once both sides are picked.
  useEffect(() => {
    if (aFront && aBack && !aBusy && !aPaths) void runAadhaar(aFront, aBack, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aFront, aBack]);
  useEffect(() => {
    if (cFront && cBack && !cBusy && !cPaths) void runAadhaar(cFront, cBack, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cFront, cBack]);

  async function runAadhaar(front: File, back: File, isCoapp: boolean) {
    const setBusy = isCoapp ? setCBusy : setABusy;
    const setErr  = isCoapp ? setCErr  : setAErr;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("front", front);
      fd.append("back",  back);
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-aadhaar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setErr(data?.error || `Extraction failed (HTTP ${res.status}).`);
        return;
      }
      const f = data.fields ?? {};
      if (isCoapp) {
        setCPaths({ front: data.storage_paths.front, back: data.storage_paths.back });
        setCName((v) => v || f.name || "");
        setCDob((v) => v || f.dob || "");
        setCGender((v) => v || f.gender || "");
        setCNumber((v) => v || f.aadhaar_number || "");
        setCCareOf((v) => v || f.care_of || "");
        setCAddress((v) => v || f.address || "");
      } else {
        setAPaths({ front: data.storage_paths.front, back: data.storage_paths.back, face: data.storage_paths.face ?? null });
        setAName((v) => v || f.name || "");
        setADob((v) => v || f.dob || "");
        setAGender((v) => v || f.gender || "");
        setANumber((v) => v || f.aadhaar_number || "");
        setACareOf((v) => v || f.care_of || "");
        setAAddress((v) => v || f.address || "");
      }
    } catch (e) {
      setErr((e as Error)?.message || "Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadEbill(file: File) {
    setEbillBusy(true); setEbillErr(null);
    try {
      const fd = new FormData();
      fd.append("ebill", file);
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-loan-docs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data.ebill) {
        setEbillErr(data?.error || `Upload failed (HTTP ${res.status}).`);
        return;
      }
      setEbill({
        path: data.ebill.storage_path,
        monthly_bill_amount: data.ebill.fields.monthly_bill_amount,
        discom_name: data.ebill.fields.discom_name,
        ca_number: data.ebill.fields.ca_number,
        ebill_address_line: data.ebill.fields.ebill_address_line,
        ebill_name: data.ebill.fields.ebill_name,
        file_name: file.name,
      });
    } catch (e) {
      setEbillErr((e as Error)?.message || "Network error.");
    } finally {
      setEbillBusy(false);
    }
  }

  async function uploadCoappPan(file: File) {
    setCPanBusy(true); setCPanErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/loan-app/${appId}/extract-coapp-pan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setCPanErr(data?.error || `Upload failed (HTTP ${res.status}).`);
        return;
      }
      setCPanPath(data.storage_path ?? null);
      setCPan((v) => v || data.fields?.pan || "");
      setCName((v) => v || data.fields?.name || "");
      setCDob((v) => v || data.fields?.dob || "");
    } catch (e) {
      setCPanErr((e as Error)?.message || "Network error.");
    } finally {
      setCPanBusy(false);
    }
  }

  async function onPanUploaded(info: { file: File }) {
    setPanUploaded(true);
    try {
      const r = await extractPan(info.file);
      if (r.ok && r.pan && !panNumber) setPanNumber(r.pan);
      if (r.ok && r.father_name && !panFather) setPanFather(r.father_name);
    } catch { /* manual entry fallback */ }
  }

  const PAN_FMT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

  // Co-applicant email / phone must NOT match the applicant's.
  const coappMobileConflict =
    hasCoapp === true &&
    cMobile.trim().length > 0 &&
    applicantMobile.length > 0 &&
    cMobile.trim() === applicantMobile;
  const coappEmailConflict =
    hasCoapp === true &&
    cEmail.trim().length > 0 &&
    applicantEmail.length > 0 &&
    cEmail.trim().toLowerCase() === applicantEmail.toLowerCase();

  const coappOk =
    hasCoapp === false ||
    (hasCoapp === true &&
      !!cPaths && !!cPanPath &&
      PAN_FMT.test(cPan.trim().toUpperCase()) &&
      MOBILE_RE.test(cMobile) &&
      EMAIL_RE.test(cEmail) &&
      !coappMobileConflict &&
      !coappEmailConflict);

  const canContinue =
    panUploaded && PAN_FMT.test(panNumber.trim().toUpperCase()) &&
    !!aPaths && /^\d{12}$/.test(aNumber) &&
    !!ebill &&
    !!quotePath &&
    !!rooftopPath &&
    hasCoapp !== null && coappOk;

  function continueToLoan() {
    const payload: EpcApplyDocsPayload = {
      borrower_pan: panNumber.trim().toUpperCase(),
      borrower_father_name: panFather.trim() || null,
      aadhaar_name: aName || null,
      aadhaar_dob: aDob || null,
      aadhaar_gender: aGender || null,
      aadhaar_number: aNumber || null,
      aadhaar_care_of: aCareOf || null,
      aadhaar_address: aAddress || null,
      aadhaar_front_path: aPaths?.front ?? null,
      aadhaar_back_path: aPaths?.back ?? null,
      aadhaar_face_path: aPaths?.face ?? null,
      ebill_path: ebill?.path ?? null,
      monthly_bill_amount: ebill?.monthly_bill_amount ?? null,
      discom_name: ebill?.discom_name ?? null,
      ca_number: ebill?.ca_number ?? null,
      ebill_address_line: ebill?.ebill_address_line ?? null,
      ebill_name: ebill?.ebill_name ?? null,
      has_coapp: hasCoapp === true,
      coapp_pan: hasCoapp ? cPan.trim().toUpperCase() || null : null,
      coapp_name: hasCoapp ? cName || null : null,
      coapp_dob: hasCoapp ? cDob || null : null,
      coapp_mobile: hasCoapp ? cMobile || null : null,
      coapp_email: hasCoapp ? cEmail.trim() || null : null,
      coapp_pan_path: hasCoapp ? cPanPath : null,
      coapp_aadhaar_name: hasCoapp ? cName || null : null,
      coapp_aadhaar_dob: hasCoapp ? cDob || null : null,
      coapp_aadhaar_gender: hasCoapp ? cGender || null : null,
      coapp_aadhaar_number: hasCoapp ? cNumber || null : null,
      coapp_aadhaar_care_of: hasCoapp ? cCareOf || null : null,
      coapp_aadhaar_address: hasCoapp ? cAddress || null : null,
      coapp_aadhaar_front_path: hasCoapp ? cPaths?.front ?? null : null,
      coapp_aadhaar_back_path: hasCoapp ? cPaths?.back ?? null : null,
      // Bill is on the applicant's name when there is NO co-applicant.
      bill_on_applicant_name: hasCoapp === false,
      proforma_invoice_path: quotePath,
      rooftop_photo_path: rooftopPath,
      rooftop_photo_gps: rooftopGps,
    };
    sessionStorage.setItem(`epcApply:${appId}`, JSON.stringify(payload));
    router.push(`/dashboard/apply/${appId}/loan` as any);
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <a href="/dashboard" className="font-display font-bold text-[20px] grad-text">Capital Craft</a>
          <span className="text-[13px] text-text-muted">Loan Application</span>
        </div>
      </header>

      <section className="max-w-[760px] mx-auto px-5 sm:px-7 py-10 space-y-6">
        <EpcApplyTracker step={2} />

        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-[#0f3d2e]">
            Customer documents
          </h1>
          <p className="text-text-mid mt-2 text-[15px]">
            Upload the customer&rsquo;s documents — details are read automatically
            and every field stays editable.
          </p>
        </div>

        {/* PAN */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">PAN card</h2>
          <FileUpload
            applicationId={appId}
            category="borrower_pan"
            table="user_application_docs"
            uploadedBy="epc"
            onUploaded={(info) => void onPanUploaded(info)}
            hint="Photo, scan, or PDF."
          />
          <Input
            label="PAN number"
            value={panNumber}
            onChange={(e) => setPanNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
            placeholder="AAAAA9999A"
            maxLength={10}
            hint="Read from the card automatically — correct it if wrong."
          />
        </Card>

        {/* Aadhaar */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">Aadhaar card</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <PickTile label="Aadhaar Front" file={aFront} onPick={setAFront} busy={aBusy} done={!!aPaths} />
            <PickTile label="Aadhaar Back"  file={aBack}  onPick={setABack}  busy={aBusy} done={!!aPaths} />
          </div>
          {aBusy && <p className="text-[12px] text-text-muted">Extracting details…</p>}
          {aErr && <p className="text-[12px] text-red-700">{aErr}</p>}
          {aPaths && (
            <div className="grid sm:grid-cols-2 gap-4 pt-1">
              <Input label="Name" value={aName} onChange={(e) => setAName(e.target.value)} />
              <DatePicker label="Date of birth" value={aDob} onChange={setADob} />
              <Input label="Gender" value={aGender} onChange={(e) => setAGender(e.target.value)} />
              <Input
                label="Aadhaar number"
                value={aNumber.replace(/(\d{4})(?=\d)/g, "$1 ")}
                onChange={(e) => setANumber(e.target.value.replace(/\D/g, "").slice(0, 12))}
                placeholder="0000 0000 0000"
                maxLength={14}
              />
              <Input label="Care of" value={aCareOf} onChange={(e) => setACareOf(e.target.value)} />
              <div className="sm:col-span-2">
                <label className="block mb-1.5 text-[13px] font-medium text-text-mid">Address</label>
                <textarea
                  value={aAddress}
                  onChange={(e) => setAAddress(e.target.value)}
                  rows={2}
                  className="w-full rounded-input border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-blue resize-y"
                />
              </div>
            </div>
          )}
        </Card>

        {/* E-bill */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">Latest electricity bill</h2>
          <EbillTile ebill={ebill} busy={ebillBusy} onFile={(f) => void uploadEbill(f)} />
          {ebillErr && <p className="text-[12px] text-red-700">{ebillErr}</p>}
        </Card>

        {/* Quotation / Proforma invoice */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">Quotation / Proforma invoice</h2>
          <p className="text-[13px] text-text-mid -mt-2">
            Upload the project quotation or proforma invoice for the solar system.
          </p>
          <FileUpload
            applicationId={appId}
            category="quotation"
            table="user_application_docs"
            uploadedBy="epc"
            onUploaded={(info) => setQuotePath(info.storagePath)}
            hint="Photo, scan, or PDF."
          />
        </Card>

        {/* Rooftop photo — geo-tagged */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">Rooftop photo (geo-tagged)</h2>
          <p className="text-[13px] text-text-mid -mt-2">
            Take a photo of the installation rooftop so the site can be verified.
            Location is captured with the photo.
          </p>
          <FileUpload
            applicationId={appId}
            category="borrower_photo"
            table="user_application_docs"
            uploadedBy="epc"
            captureGps
            hint="Location is captured with the upload."
            onUploaded={(info) => {
              setRooftopPath(info.storagePath);
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
        </Card>

        {/* Co-applicant toggle */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px] text-[#0f3d2e]">
            Please confirm the electricity bill is in the name of the applicant.
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <ToggleTile
              active={hasCoapp === false}
              onClick={() => setHasCoapp(false)}
              title="Yes, the bill is in the applicant's name"
              desc="No co-applicant needed."
            />
            <ToggleTile
              active={hasCoapp === true}
              onClick={() => setHasCoapp(true)}
              title="No, the bill is not in the applicant's name (add a co-applicant)"
              desc="Capture the co-applicant's Aadhaar + PAN."
            />
          </div>

          {hasCoapp && (
            <div className="space-y-4 pt-2 border-t border-line">
              <p className="text-[13px] font-semibold text-text">Co-applicant Aadhaar</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <PickTile label="Aadhaar Front" file={cFront} onPick={setCFront} busy={cBusy} done={!!cPaths} />
                <PickTile label="Aadhaar Back"  file={cBack}  onPick={setCBack}  busy={cBusy} done={!!cPaths} />
              </div>
              {cBusy && <p className="text-[12px] text-text-muted">Extracting details…</p>}
              {cErr && <p className="text-[12px] text-red-700">{cErr}</p>}

              <p className="text-[13px] font-semibold text-text pt-1">Co-applicant PAN</p>
              <PanTile path={cPanPath} busy={cPanBusy} onFile={(f) => void uploadCoappPan(f)} />
              {cPanErr && <p className="text-[12px] text-red-700">{cPanErr}</p>}

              {(cPaths || cPanPath) && (
                <div className="grid sm:grid-cols-2 gap-4 pt-1">
                  <Input label="Name" value={cName} onChange={(e) => setCName(e.target.value)} />
                  <DatePicker label="Date of birth" value={cDob} onChange={setCDob} />
                  <Input
                    label="PAN number"
                    value={cPan}
                    onChange={(e) => setCPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
                    placeholder="AAAAA9999A"
                    maxLength={10}
                  />
                  <Input
                    label="Aadhaar number"
                    value={cNumber.replace(/(\d{4})(?=\d)/g, "$1 ")}
                    onChange={(e) => setCNumber(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    placeholder="0000 0000 0000"
                    maxLength={14}
                  />
                  <Input
                    label="Mobile number"
                    inputMode="numeric"
                    maxLength={10}
                    value={cMobile}
                    onChange={(e) => setCMobile(e.target.value.replace(/\D/g, ""))}
                    placeholder="10-digit"
                    error={
                      coappMobileConflict
                        ? "Cannot be the same as the applicant's mobile."
                        : cMobile && !MOBILE_RE.test(cMobile)
                        ? "Enter a valid 10-digit mobile."
                        : undefined
                    }
                  />
                  <Input
                    label="Email"
                    type="email"
                    value={cEmail}
                    onChange={(e) => setCEmail(e.target.value)}
                    placeholder="coapplicant@example.com"
                    error={
                      coappEmailConflict
                        ? "Cannot be the same as the applicant's email."
                        : cEmail && !EMAIL_RE.test(cEmail)
                        ? "Enter a valid email address."
                        : undefined
                    }
                  />
                  <div className="sm:col-span-2">
                    <label className="block mb-1.5 text-[13px] font-medium text-text-mid">Address</label>
                    <textarea
                      value={cAddress}
                      onChange={(e) => setCAddress(e.target.value)}
                      rows={2}
                      className="w-full rounded-input border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-blue resize-y"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex justify-between gap-2">
            <Button type="button" variant="outline" onClick={() => router.push("/dashboard/apply" as any)}>
              ← Previous
            </Button>
            <Button type="button" variant="primary" onClick={continueToLoan} disabled={!canContinue}>
              Save &amp; continue
            </Button>
          </div>
        </Card>
      </section>
    </main>
  );
}

// ── Small tiles ──────────────────────────────────────────────────────

function PickTile({
  label, file, onPick, busy, done,
}: {
  label: string; file: File | null; onPick: (f: File | null) => void;
  busy: boolean; done: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const has = !!file || done;
  return (
    <div>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className={[
          "w-full h-[110px] rounded-input border-2 border-dashed flex items-center justify-center text-center px-3 transition-colors",
          has ? "border-[#178a5c] bg-[#f0faf5] text-[#0f3d2e]" : "border-[#185fa5] bg-white text-[#185fa5] hover:bg-[#f2f7fc]",
          busy ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <div>
          <p className="text-[13px] font-semibold">{label}</p>
          <p className="text-[10px] mt-0.5">{file ? file.name : has ? "Uploaded" : "Click to select"}</p>
        </div>
      </button>
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
    </div>
  );
}

function EbillTile({
  ebill, busy, onFile,
}: {
  ebill: { file_name: string } | null; busy: boolean; onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className={[
          "w-full h-[110px] rounded-input border-2 border-dashed flex items-center justify-center text-center px-3 transition-colors",
          ebill ? "border-[#178a5c] bg-[#f0faf5] text-[#0f3d2e]" : "border-[#185fa5] bg-white text-[#185fa5] hover:bg-[#f2f7fc]",
          busy ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <div>
          <p className="text-[13px] font-semibold">
            {busy ? "Uploading & reading…" : ebill ? ebill.file_name : "Click to upload"}
          </p>
          <p className="text-[10px] mt-0.5">{ebill ? "Click to replace" : "Photo, scan, or PDF"}</p>
        </div>
      </button>
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
    </div>
  );
}

function PanTile({
  path, busy, onFile,
}: {
  path: string | null; busy: boolean; onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className={[
          "w-full h-[90px] rounded-input border-2 border-dashed flex items-center justify-center text-center px-3 transition-colors",
          path ? "border-[#178a5c] bg-[#f0faf5] text-[#0f3d2e]" : "border-[#185fa5] bg-white text-[#185fa5] hover:bg-[#f2f7fc]",
          busy ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <p className="text-[13px] font-semibold">
          {busy ? "Uploading & reading…" : path ? "Uploaded — click to replace" : "Click to upload PAN"}
        </p>
      </button>
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
    </div>
  );
}

function ToggleTile({
  active, onClick, title, desc,
}: {
  active: boolean; onClick: () => void; title: string; desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "text-left rounded-input border-2 p-4 transition-colors relative",
        active ? "border-[#178a5c] bg-[#f0faf5]" : "border-line bg-white hover:border-[#185fa5]",
      ].join(" ")}
    >
      <span className={[
        "absolute top-3 right-3 w-4 h-4 rounded-full border-2 flex items-center justify-center",
        active ? "border-[#178a5c]" : "border-line",
      ].join(" ")} aria-hidden>
        {active && <span className="w-2 h-2 rounded-full bg-[#178a5c]" />}
      </span>
      <p className={"font-display font-semibold text-[14px] pr-6 " + (active ? "text-[#0f3d2e]" : "text-text")}>{title}</p>
      <p className="text-[12px] text-text-muted mt-1">{desc}</p>
    </button>
  );
}
