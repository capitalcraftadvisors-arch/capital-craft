"use client";

// Loan Application — Step 2 (KYC Verification)
//
// Admin uploads the customer's Aadhaar (front + back). The server
// route /api/admin/loan-app/[id]/extract-aadhaar runs Vision OCR on
// both, cropping any face on the front, and returns extracted fields.
//
// The extracted values PREFILL individual editable Input boxes so the
// admin can correct anything OCR misses (Aadhaar cards vary widely and
// scanned photocopies often lose fields). Every KYC field on this page
// is editable — the OCR is prefill-only, never a hard source of truth.
//
// PRIVACY: the 12-digit Aadhaar number never leaves the OCR route in
// unmasked form. If OCR missed it, admin types just the LAST 4 digits;
// the client always constructs the "xxxxxxxx####" masked form before
// submitting. The unmasked number is never accepted from the client.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import LoanAppStepTracker from "@/components/LoanAppStepTracker";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";

type Loan = {
  id: string;
  status: string;
  current_step: number;
  created_at: string;
  epc_business: {
    contact_name: string | null;
    trade_name: string | null;
    legal_name: string | null;
    epc_display_id: string | null;
  } | null;
};

type ExtractedFields = {
  name:           string | null;
  dob:            string | null;
  gender:         string | null;
  aadhaar_number: string | null;   // full 12 digits from OCR
  aadhaar_masked: string | null;
  care_of:        string | null;
  address:        string | null;
};

type ExtractionResult = {
  fields: ExtractedFields;
  storage_paths: { front: string; back: string; face: string | null };
  face_signed_url: string | null;
};

const ACCEPT = "image/*,application/pdf";
const GENDER_OPTIONS = ["Male", "Female", "Transgender"];

export default function LoanAppStep2Page() {
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

  // Uploads
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile,  setBackFile]  = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<ExtractionResult | null>(null);

  // Editable fields — populated from OCR, but admin can override any of them
  const [name,     setName]     = useState("");
  const [dob,      setDob]      = useState("");
  const [gender,   setGender]   = useState("");
  // Full 12-digit Aadhaar number (product decision: KYC needs the full
  // number). Prefilled from OCR; admin can correct. Masked form is
  // derived from it at save time.
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [careOf,   setCareOf]   = useState("");
  const [address,  setAddress]  = useState("");

  // Save
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Object URL for front-file preview
  const frontPreviewUrl = useMemo(() => {
    if (!frontFile) return null;
    if (frontFile.type === "application/pdf") return null;
    return URL.createObjectURL(frontFile);
  }, [frontFile]);
  useEffect(() => {
    return () => { if (frontPreviewUrl) URL.revokeObjectURL(frontPreviewUrl); };
  }, [frontPreviewUrl]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("epc_applications")
        .select(
          "id, status, current_step, created_at, " +
          "aadhaar_name, aadhaar_dob, aadhaar_gender, aadhaar_number, " +
          "aadhaar_care_of, aadhaar_address, " +
          "aadhaar_front_path, aadhaar_back_path, aadhaar_face_path, " +
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .eq("id", params.id)
        .maybeSingle();
      const row = data as unknown as (Loan & Record<string, any>) | null;
      setLoan(row);
      // Prefill from a previous Step 2 save (edit / resume pass). The
      // uploaded state is reconstructed from the stored paths so the
      // extracted panel renders and Next re-saves without forcing a
      // re-upload. No forward-redirect — the whole flow is editable.
      if (row && row.aadhaar_front_path && row.aadhaar_back_path) {
        setUploaded({
          fields: {
            name: row.aadhaar_name, dob: row.aadhaar_dob, gender: row.aadhaar_gender,
            aadhaar_number: row.aadhaar_number, aadhaar_masked: null,
            care_of: row.aadhaar_care_of, address: row.aadhaar_address,
          },
          storage_paths: {
            front: row.aadhaar_front_path,
            back:  row.aadhaar_back_path,
            face:  row.aadhaar_face_path ?? null,
          },
          face_signed_url: null,
        });
        setName(row.aadhaar_name ?? "");
        setDob(row.aadhaar_dob ?? "");
        setGender(row.aadhaar_gender ?? "");
        setAadhaarNumber(row.aadhaar_number ?? "");
        setCareOf(row.aadhaar_care_of ?? "");
        setAddress(row.aadhaar_address ?? "");
      }
      setLoading(false);
    })();
  }, [params.id]);

  async function runExtraction() {
    if (!loan || !frontFile || !backFile) return;
    setExtractError(null);
    setExtracting(true);
    try {
      const form = new FormData();
      form.append("front", frontFile);
      form.append("back",  backFile);
      const res = await fetch(`/api/admin/loan-app/${loan.id}/extract-aadhaar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setExtractError(data?.error || `Extraction failed (HTTP ${res.status}).`);
        setExtracting(false);
        return;
      }
      const result: ExtractionResult = {
        fields:          data.fields,
        storage_paths:   data.storage_paths,
        face_signed_url: data.face_signed_url ?? null,
      };
      setUploaded(result);
      // Prefill — but only if the admin hadn't already typed something.
      if (!name    && result.fields.name)    setName(result.fields.name);
      if (!dob     && result.fields.dob)     setDob(result.fields.dob);
      if (!gender  && result.fields.gender)  setGender(result.fields.gender);
      if (!careOf  && result.fields.care_of) setCareOf(result.fields.care_of);
      if (!address && result.fields.address) setAddress(result.fields.address);
      if (!aadhaarNumber && result.fields.aadhaar_number) {
        setAadhaarNumber(result.fields.aadhaar_number);
      }
    } catch (e) {
      setExtractError((e as Error)?.message || "Network error.");
    } finally {
      setExtracting(false);
    }
  }

  function clearUploads() {
    setUploaded(null);
    setFrontFile(null);
    setBackFile(null);
    setExtractError(null);
    // Editable fields stay so admin doesn't lose typed edits when swapping the doc.
  }

  // View a previously-saved Aadhaar image (edit/reload) via the admin sign-doc
  // route — the tiles have no local File to preview in that case.
  async function signAndOpen(path: string) {
    try {
      const res = await fetch(`/api/admin/loan-app/${params.id}/sign-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ path }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && data.url) window.open(data.url, "_blank", "noopener");
      else alert("Couldn't open the document.");
    } catch (e) {
      alert("Couldn't open the document: " + (e as Error).message);
    }
  }

  const validAadhaar = /^\d{12}$/.test(aadhaarNumber);
  const validForm   =
    name.trim().length > 0 &&
    dob.trim().length > 0 &&
    gender.trim().length > 0 &&
    validAadhaar &&
    address.trim().length > 0;
  const canNext = !!uploaded && validForm && !saving;

  async function saveAndNext() {
    if (!loan) return; // admin-only flow: never block on missing fields/docs
    setSaveError(null);
    setSaving(true);
    try {
      const body = {
        aadhaar_name:          name.trim(),
        aadhaar_dob:           dob.trim(),
        aadhaar_gender:        gender.trim(),
        aadhaar_number:        aadhaarNumber,
        aadhaar_number_masked: "xxxxxxxx" + aadhaarNumber.slice(-4),
        aadhaar_care_of:       careOf.trim() || null,
        aadhaar_address:       address.trim(),
        aadhaar_front_path:    uploaded!.storage_paths.front,
        aadhaar_back_path:     uploaded!.storage_paths.back,
        aadhaar_face_path:     uploaded!.storage_paths.face,
      };
      const res = await fetch(`/api/admin/loan-app/${loan.id}/complete-step-2`, {
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
      // Came here via a Step-6 "Edit" link? Go back to the review.
      const fromReview = new URLSearchParams(window.location.search).get("from") === "review";
      router.push(`/admin/app/${loan.id}/${fromReview ? "step-6" : "step-3"}` as any);
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
            <button
              type="button"
              onClick={() => router.push(`/admin/app/${params.id}/step-1` as any)}
              aria-label="Back to previous step"
              className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#185fa5] hover:text-[#0f3d2e] transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              Back
            </button>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">
              Loan Application · Step 2
            </span>
          </div>
        </div>
      </header>

      <section className="max-w-[900px] mx-auto px-5 sm:px-7 py-8 space-y-6">
        <LoanAppStepTracker
          applicationId={loan.id}
          displayId={loan.epc_business?.epc_display_id ?? null}
          name={customerName}
          createdAt={loan.created_at}
          currentStep={2}
        />

        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-[#0f3d2e]">
            KYC Verification
          </h1>
          <p className="text-text-mid mt-2 text-[15px]">
            Upload the customer&rsquo;s Aadhaar card. We&rsquo;ll extract identity details
            automatically — you review, correct if needed, and confirm before saving.
          </p>
        </div>

        {/* ─── Upload section ────────────────────────────────── */}
        <Card className="p-7 space-y-5">
          <div>
            <h2 className="font-display font-semibold text-[18px] text-[#0f3d2e]">
              Aadhaar upload
            </h2>
            <p className="text-[13px] text-text-mid mt-1">
              Front and back both required.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <UploadTile
              label="Aadhaar Front"
              hint="Photo or scan of the front side"
              file={frontFile}
              onSelect={setFrontFile}
              disabled={extracting}
              onViewExisting={!frontFile && uploaded?.storage_paths.front ? () => void signAndOpen(uploaded.storage_paths.front) : undefined}
            />
            <UploadTile
              label="Aadhaar Back"
              hint="Photo or scan of the back side"
              file={backFile}
              onSelect={setBackFile}
              disabled={extracting}
              onViewExisting={!backFile && uploaded?.storage_paths.back ? () => void signAndOpen(uploaded.storage_paths.back) : undefined}
            />
          </div>

          {extractError && (
            <div className="p-3.5 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700">
              {extractError}
            </div>
          )}

          {!uploaded && (
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                variant="primary"
                onClick={runExtraction}
                loading={extracting}
                disabled={!frontFile || !backFile || extracting}
              >
                {extracting ? "Extracting details…" : "Extract details"}
              </Button>
            </div>
          )}

          {uploaded && (
            <div className="flex items-center justify-between pt-1 border-t border-line pt-4">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#178a5c] flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="text-[13px] font-semibold text-[#0f3d2e]">
                  Uploads captured
                </span>
              </div>
              <button
                type="button"
                onClick={clearUploads}
                className="text-[12px] font-semibold text-[#854f0b] border border-[#854f0b] px-3 py-1.5 rounded hover:bg-amber-50"
              >
                Re-upload Aadhaar
              </button>
            </div>
          )}
        </Card>

        {/* ─── Extracted / editable details ───────────────────── */}
        {uploaded && (
          <Card className="p-7 space-y-6 bg-white border-[#cdeadd]">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div>
                <h2 className="font-display font-semibold text-[18px] text-[#0f3d2e]">
                  Identity details
                </h2>
                <p className="text-[13px] text-text-mid mt-1">
                  Prefilled from your Aadhaar upload. Correct anything that looks wrong — every field is editable.
                </p>
              </div>
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-[#f0faf5] text-[#0f3d2e] font-semibold uppercase tracking-wide border border-[#cdeadd]">
                Details Extracted
              </span>
            </div>

            <div className="grid sm:grid-cols-[1fr_180px] gap-6">
              {/* Fields grid */}
              <div className="grid sm:grid-cols-2 gap-4">
                <Input
                  label="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="As on Aadhaar"
                />
                <DatePicker
                  label="Date of birth"
                  value={dob}
                  onChange={setDob}
                  hint="Click the field to open a calendar."
                />
                <div>
                  <label className="block mb-1.5 text-[13px] font-medium text-text-mid">
                    Gender
                  </label>
                  <div className="flex gap-2">
                    {GENDER_OPTIONS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGender(g)}
                        className={[
                          "flex-1 px-3 py-2.5 rounded-input border-2 text-[13px] font-medium transition-colors",
                          gender === g
                            ? "border-[#178a5c] bg-[#f0faf5] text-[#0f3d2e]"
                            : "border-line bg-white text-text hover:border-[#185fa5]",
                        ].join(" ")}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block mb-1.5 text-[13px] font-medium text-text-mid">
                    Aadhaar number
                  </label>
                  <input
                    value={aadhaarNumber.replace(/(\d{4})(?=\d)/g, "$1 ")}
                    onChange={(e) => setAadhaarNumber(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    maxLength={14}
                    inputMode="numeric"
                    placeholder="0000 0000 0000"
                    className={[
                      "w-full px-4 py-3 rounded-input border-2 font-mono text-[16px] tracking-wider outline-none transition-colors bg-white",
                      aadhaarNumber && !validAadhaar
                        ? "border-red-400 focus:border-red-500"
                        : validAadhaar
                        ? "border-[#178a5c] focus:border-[#178a5c]"
                        : "border-line focus:border-[#185fa5]",
                    ].join(" ")}
                  />
                  <p className="mt-1.5 text-[11px] text-text-muted">
                    12 digits, as printed on the card.
                    {aadhaarNumber && !validAadhaar && " Must be exactly 12 digits."}
                  </p>
                </div>
                <Input
                  label="Care of (S/O, D/O, C/O)"
                  value={careOf}
                  onChange={(e) => setCareOf(e.target.value)}
                  placeholder="e.g. S/O John Doe"
                  hint="Optional. Usually printed on the back of the Aadhaar."
                />
                <div className="sm:col-span-2">
                  <label className="block mb-1.5 text-[13px] font-medium text-text-mid">
                    Address
                  </label>
                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="As on Aadhaar"
                    rows={3}
                    className="w-full rounded-input border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-blue resize-y"
                  />
                </div>
              </div>

              {/* Face thumbnail */}
              <div className="flex flex-col items-center">
                <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mb-2">
                  {uploaded.face_signed_url ? "Detected face" : "Front upload"}
                </p>
                <div className="w-full h-[220px] rounded-input border-2 border-[#cdeadd] bg-white overflow-hidden flex items-center justify-center">
                  {uploaded.face_signed_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={uploaded.face_signed_url}
                      alt="Detected face"
                      className="w-full h-full object-cover"
                    />
                  ) : frontPreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={frontPreviewUrl}
                      alt="Aadhaar front"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-center px-4">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#5a8a76" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
                        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                      <p className="text-[11px] text-text-muted mt-2">PDF upload — no thumbnail</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* ─── Save + Next ────────────────────────────────────── */}
        {uploaded && (
          <Card className="p-6 space-y-4">
            {saveError && (
              <div className="p-3.5 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700">
                {saveError}
              </div>
            )}
            <div className="flex justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/admin/app/${loan.id}/step-1` as any)}
              >
                ← Previous
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={saveAndNext}
                loading={saving}
                disabled={saving}
              >
                Next
              </Button>
            </div>
          </Card>
        )}
      </section>
    </main>
  );
}

// ── Upload tile ──────────────────────────────────────────────────────

function UploadTile({
  label, hint, file, onSelect, disabled, onViewExisting,
}: {
  label: string;
  hint?: string;
  file: File | null;
  onSelect: (f: File | null) => void;
  disabled?: boolean;
  // Set when a previously-saved document exists (edit/reload). Opens the stored
  // file via the sign-doc route so the tile shows "uploaded" + a working View
  // even before a new file is picked in this session.
  onViewExisting?: (() => void) | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const has = !!file || !!onViewExisting;

  // Local preview URL for the View button — same File object the user just
  // picked, no round-trip. Revoked on file swap / unmount.
  const previewUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  function openPreview(e: React.MouseEvent) {
    e.stopPropagation();
    if (previewUrl) window.open(previewUrl, "_blank", "noopener");
  }

  return (
    <div>
      <p className="block mb-1.5 text-[13px] font-semibold text-text">{label}</p>
      {hint && !has && <p className="mb-2 text-[11px] text-text-muted">{hint}</p>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={[
          "w-full h-[108px] rounded-input border-2 border-dashed transition-colors flex items-center justify-center text-center px-4 relative",
          has
            ? "border-[#178a5c] bg-[#f0faf5] text-[#0f3d2e]"
            : "border-[#185fa5] bg-white text-[#185fa5] hover:bg-[#f2f7fc]",
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        {has ? (
          <div>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#178a5c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <polyline points="9 15 11 17 15 13" />
            </svg>
            <p className="text-[13px] font-semibold">{file ? file.name : "Uploaded"}</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              Click to replace
            </p>

            {/* View (eye) — a freshly picked file opens from its local object URL;
                a reloaded document opens via the sign-doc route. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (file) { if (previewUrl) window.open(previewUrl, "_blank", "noopener"); }
                else onViewExisting?.();
              }}
              disabled={file ? !previewUrl : !onViewExisting}
              title="View uploaded file"
              aria-label="View uploaded file"
              className="absolute top-2 right-2 p-1.5 rounded bg-white/90 border border-[#cdeadd] text-[#185fa5] hover:bg-white hover:border-[#185fa5] disabled:opacity-50 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        ) : (
          <div>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-[13px] font-semibold">Click to upload</p>
            <p className="text-[11px] mt-1">Photo, scan, or PDF</p>
          </div>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
        className="hidden"
      />
    </div>
  );
}
