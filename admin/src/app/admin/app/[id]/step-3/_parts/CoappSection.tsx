"use client";

// Loan Application — Step 3 · the co-applicant: its fields, the PAN and Aadhaar
// OCR uploads (useCoappUploads — state the page owns, so it keeps it while the
// section is hidden) and the "Co-applicant details" section.

import type { Dispatch, SetStateAction } from "react";
import { useId, useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import DatePicker from "@/components/ui/DatePicker";
import { signLoanPath } from "@/lib/storage";
import { FormSection, FIELD_LABEL, GreenPill, TextAreaField, postLoanFiles } from "@/components/loan-form";
import { CoappAadhaarPicker, DocSlot } from "./tiles";

const RELATIONS = [
  "Father", "Mother", "Spouse", "Son", "Daughter", "Brother", "Sister", "Other",
];

export type Coapp = {
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

export const EMPTY_COAPP: Coapp = {
  pan: "", name: "", father_name: "", dob: "",
  relation: "", mobile: "", email: "",
  pan_path: null, pan_uploaded_at: null, pan_signed_url: null,
  aadhaar_name: "", aadhaar_dob: "", aadhaar_gender: "",
  aadhaar_number: "", aadhaar_care_of: "", aadhaar_address: "",
  aadhaar_front_path: null, aadhaar_back_path: null, aadhaar_face_path: null,
  aadhaar_front_signed_url: null, aadhaar_back_signed_url: null,
  aadhaar_uploading: false, aadhaar_error: null,
};

/** The co-applicant PAN / Aadhaar OCR uploads (into the page's `coapp`). */
export function useCoappUploads(appId: string, setCoapp: Dispatch<SetStateAction<Coapp>>) {
  const [coappUploading, setCoappUploading] = useState(false);
  const [coappUploadError, setCoappUploadError] = useState<string | null>(null);

  async function uploadPan(file: File) {
    setCoappUploadError(null);
    setCoappUploading(true);
    try {
      const r = await postLoanFiles(appId, "extract-coapp-pan", { file });
      if (!r.ok) {
        setCoappUploadError(r.error);
        return;
      }
      const data = r.data;
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
  async function uploadAadhaar(front: File, back: File) {
    setCoapp((c) => ({ ...c, aadhaar_uploading: true, aadhaar_error: null }));
    try {
      const r = await postLoanFiles(appId, "extract-aadhaar", { front, back });
      if (!r.ok) {
        setCoapp((c) => ({ ...c, aadhaar_uploading: false, aadhaar_error: r.error }));
        return;
      }
      const data = r.data;
      const f = data.fields ?? {};
      const frontPath = data.storage_paths?.front ?? null;
      const backPath  = data.storage_paths?.back  ?? null;
      // Sign the freshly-uploaded front/back so View is available immediately.
      const [frontU, backU] = await Promise.all([
        frontPath ? signLoanPath(appId, frontPath) : Promise.resolve(null),
        backPath  ? signLoanPath(appId, backPath)  : Promise.resolve(null),
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

  return { uploading: coappUploading, error: coappUploadError, uploadPan, uploadAadhaar };
}
export type CoappUploads = ReturnType<typeof useCoappUploads>;

export default function CoappSection({ coapp, setCoapp, uploads, mobileConflict, emailConflict }: {
  coapp: Coapp;
  setCoapp: Dispatch<SetStateAction<Coapp>>;
  uploads: CoappUploads;
  mobileConflict: boolean;
  emailConflict: boolean;
}) {
  const aadhaarInputId = useId(); // ties the "Aadhaar number" label to its box
  return (
    <FormSection title="Co-applicant details">
      <div>
        <p className={FIELD_LABEL}>
          Co-applicant PAN card
        </p>
        <DocSlot
          label=""
          doc={coapp.pan_path ? {
            path: coapp.pan_path,
            uploaded_at: coapp.pan_uploaded_at,
            signed_url: coapp.pan_signed_url,
            file_name: "Co-applicant PAN",
          } : null}
          uploading={uploads.uploading}
          onFile={(f) => void uploads.uploadPan(f)}
        />
        {uploads.error && (
          <p className="mt-2 text-[12px] text-red-700">{uploads.error}</p>
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
          error={mobileConflict ? "Cannot be the same as the applicant's mobile." : undefined}
        />
        <Input
          label="Email"
          type="email"
          value={coapp.email}
          onChange={(e) => setCoapp({ ...coapp, email: e.target.value })}
          error={emailConflict ? "Cannot be the same as the applicant's email." : undefined}
        />
      </div>

      {/* Co-applicant Aadhaar KYC — mirrors the applicant's Step 2. */}
      <div className="pt-4 border-t border-line space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-text">Co-applicant Aadhaar (KYC)</p>
          {(coapp.aadhaar_front_path || coapp.aadhaar_back_path) && (
            <GreenPill>Uploaded</GreenPill>
          )}
        </div>
        <p className="text-[11px] text-text-muted">
          Upload the co-applicant&rsquo;s Aadhaar front and back. Details are extracted automatically.
        </p>
        <CoappAadhaarPicker
          onFiles={(front, back) => void uploads.uploadAadhaar(front, back)}
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
              <label htmlFor={aadhaarInputId} className={FIELD_LABEL}>
                Aadhaar number
              </label>
              <input
                id={aadhaarInputId}
                value={coapp.aadhaar_number.replace(/(\d{4})(?=\d)/g, "$1 ")}
                onChange={(e) => setCoapp({ ...coapp, aadhaar_number: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                maxLength={14}
                inputMode="numeric"
                placeholder="0000 0000 0000"
                className="w-full px-4 py-3 rounded-input border-2 border-line font-mono text-[15px] tracking-wider outline-none focus:border-cc-green bg-white"
              />
              <p className="mt-1 text-[11px] text-text-muted">12 digits, as printed on the card.</p>
            </div>
            <Input
              label="Care of"
              value={coapp.aadhaar_care_of}
              onChange={(e) => setCoapp({ ...coapp, aadhaar_care_of: e.target.value })}
            />
            <TextAreaField
              label="Aadhaar address"
              value={coapp.aadhaar_address}
              onChange={(v) => setCoapp({ ...coapp, aadhaar_address: v })}
            />
          </div>
        )}
      </div>
    </FormSection>
  );
}
