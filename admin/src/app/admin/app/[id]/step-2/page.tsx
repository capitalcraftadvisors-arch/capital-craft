"use client";

// Loan Application — Step 2 (KYC Verification)
//
// Admin uploads the customer's Aadhaar (front + back). The server
// route /api/admin/loan-app/[id]/extract-aadhaar runs Vision OCR on
// both, cropping any face on the front, and returns:
//   { fields: { name, dob, gender, aadhaar_masked, care_of, address },
//     storage_paths: { front, back, face }, face_signed_url }
//
// The extracted fields render in a green "Details Extracted" panel.
// If any field looks wrong the admin clears everything with the amber
// "Re-upload Aadhaar" button. Next persists the extracted fields via
// /api/admin/loan-app/[id]/complete-step-2 and routes to Step 3.
//
// PRIVACY: aadhaar_masked is the only form of the number the client
// ever sees or persists. The unmasked 12 digits never cross the wire.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
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

  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile,  setBackFile]  = useState<File | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractionResult | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Object URL for the client-side front-file preview (used as thumbnail
  // fallback when no face was detected). Revoked on unmount / re-upload
  // to avoid a memory leak.
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
          "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
        )
        .eq("id", params.id)
        .maybeSingle();
      setLoan(data as unknown as Loan | null);
      setLoading(false);
    })();
  }, [params.id]);

  // Route guard — if this app is already past Step 2, kick to Step 3.
  useEffect(() => {
    if (loan && loan.current_step > 2) {
      router.replace(`/admin/app/${loan.id}/step-3` as any);
    }
  }, [loan, router]);

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
      setExtracted({
        fields:          data.fields,
        storage_paths:   data.storage_paths,
        face_signed_url: data.face_signed_url ?? null,
      });
    } catch (e) {
      setExtractError((e as Error)?.message || "Network error.");
    } finally {
      setExtracting(false);
    }
  }

  function resetExtraction() {
    setExtracted(null);
    setExtractError(null);
    setFrontFile(null);
    setBackFile(null);
  }

  async function saveAndNext() {
    if (!loan || !extracted) return;
    setSaveError(null);
    setSaving(true);
    try {
      const body = {
        aadhaar_name:          extracted.fields.name,
        aadhaar_dob:           extracted.fields.dob,
        aadhaar_gender:        extracted.fields.gender,
        aadhaar_number_masked: extracted.fields.aadhaar_masked,
        aadhaar_care_of:       extracted.fields.care_of,
        aadhaar_address:       extracted.fields.address,
        aadhaar_front_path:    extracted.storage_paths.front,
        aadhaar_back_path:     extracted.storage_paths.back,
        aadhaar_face_path:     extracted.storage_paths.face,
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
      router.push(`/admin/app/${loan.id}/step-3` as any);
    } catch (e) {
      setSaveError((e as Error)?.message || "Network error.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-text-muted">Loading…</p>
      </main>
    );
  }
  if (!loan) {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-red-700">Loan application not found.</p>
      </main>
    );
  }

  const customerName =
    loan.epc_business?.trade_name ||
    loan.epc_business?.legal_name ||
    loan.epc_business?.contact_name ||
    "(customer)";

  const canExtract = !!frontFile && !!backFile && !extracting && !extracted;
  const canNext    = !!extracted && !saving;

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-[20px] grad-text">Capital Craft</span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">
              Loan Application · Step 2
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
          currentStep={2}
        />

        <div>
          <h1 className="font-display text-[26px] sm:text-[30px] font-bold">KYC verification</h1>
          <p className="text-text-mid mt-1 text-[14px]">
            Upload the customer&rsquo;s Aadhaar card. The system extracts identity
            details automatically — you review and confirm before saving.
          </p>
        </div>

        {/* Upload section — only shown until we have extracted data */}
        {!extracted && (
          <Card className="p-6 space-y-4">
            <h2 className="font-display font-semibold text-[16px]">Aadhaar upload</h2>

            <div className="grid sm:grid-cols-2 gap-4">
              <UploadTile
                label="Aadhaar Front"
                file={frontFile}
                onSelect={setFrontFile}
                disabled={extracting}
              />
              <UploadTile
                label="Aadhaar Back"
                file={backFile}
                onSelect={setBackFile}
                disabled={extracting}
              />
            </div>

            {extractError && (
              <div className="p-3 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700">
                {extractError}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <Button
                type="button"
                variant="primary"
                onClick={runExtraction}
                loading={extracting}
                disabled={!canExtract}
              >
                {extracting ? "Extracting…" : "Extract details"}
              </Button>
            </div>
          </Card>
        )}

        {/* Extracted panel */}
        {extracted && (
          <>
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

              <div className="grid sm:grid-cols-[1fr_180px] gap-6">
                {/* Fields */}
                <dl className="text-[13px] space-y-2.5">
                  <FieldRow label="Name"           value={extracted.fields.name} />
                  <FieldRow label="Date of birth"  value={extracted.fields.dob} />
                  <FieldRow label="Gender"         value={extracted.fields.gender} />
                  <FieldRow
                    label="Aadhaar number"
                    value={extracted.fields.aadhaar_masked}
                    mono
                    hint="Masked. Full number is never stored."
                  />
                  <FieldRow label="Care of"        value={extracted.fields.care_of} />
                  <FieldRow label="Address"        value={extracted.fields.address} />
                </dl>

                {/* Face / front thumbnail */}
                <div className="flex flex-col items-center">
                  <div className="w-[160px] h-[200px] rounded-lg border border-[#cdeadd] bg-white overflow-hidden flex items-center justify-center">
                    {extracted.face_signed_url ? (
                      // Cropped face wins when available.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={extracted.face_signed_url}
                        alt="Detected face"
                        className="w-full h-full object-cover"
                      />
                    ) : frontPreviewUrl ? (
                      // Front upload as fallback (only for images; PDFs
                      // fall through to the placeholder).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={frontPreviewUrl}
                        alt="Aadhaar front"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="text-center px-3">
                        <p className="text-[11px] text-text-muted">Front doc</p>
                        <p className="text-[10px] text-text-muted mt-1">
                          (No preview — PDF upload)
                        </p>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-text-muted mt-2 text-center">
                    {extracted.face_signed_url ? "Detected face" : "Front upload"}
                  </p>
                </div>
              </div>
            </Card>

            {/* Amber "wrong info" — resets the flow */}
            <Card className="p-4 bg-amber-50 border-amber-200 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#854f0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <p className="text-[13px] text-[#854f0b]">
                  <span className="font-semibold">Wrong information?</span>{" "}
                  Re-upload the Aadhaar and we&rsquo;ll extract details again.
                </p>
              </div>
              <button
                type="button"
                onClick={resetExtraction}
                className="text-[13px] font-semibold text-[#854f0b] border border-[#854f0b] px-3 py-1.5 rounded hover:bg-amber-100"
              >
                Re-upload Aadhaar
              </button>
            </Card>

            {/* Save + advance */}
            <Card className="p-6 space-y-4">
              {saveError && (
                <div className="p-3 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700">
                  {saveError}
                </div>
              )}
              <div className="flex justify-end">
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
          </>
        )}
      </section>
    </main>
  );
}

// ── Small helpers ────────────────────────────────────────────────────

function UploadTile({
  label, file, onSelect, disabled,
}: {
  label: string;
  file: File | null;
  onSelect: (f: File | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const has = !!file;
  return (
    <div>
      <p className="block mb-1.5 text-[13px] font-medium text-text-mid">{label}</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={[
          "w-full h-[140px] rounded-input border-2 border-dashed transition-colors flex items-center justify-center text-center px-4",
          has
            ? "border-[#178a5c] bg-[#f0faf5] text-[#0f3d2e]"
            : "border-line bg-white text-text-muted hover:border-[#185fa5] hover:text-[#185fa5]",
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        {has ? (
          <div>
            <p className="text-[13px] font-semibold">{file!.name}</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              {(file!.size / 1024 / 1024).toFixed(2)} MB · click to replace
            </p>
          </div>
        ) : (
          <div>
            <p className="text-[13px] font-semibold">Click to upload</p>
            <p className="text-[11px] mt-1">Photo, scan, or PDF</p>
          </div>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
        className="hidden"
      />
    </div>
  );
}

function FieldRow({
  label, value, mono, hint,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <dt className="min-w-[120px] text-text-muted">{label}</dt>
      <dd className={mono ? "font-mono font-semibold text-[#0f3d2e]" : "font-semibold text-text"}>
        {value || <span className="text-text-muted font-normal">—</span>}
      </dd>
      {hint && <p className="basis-full text-[11px] text-text-muted italic pl-[128px]">{hint}</p>}
    </div>
  );
}
