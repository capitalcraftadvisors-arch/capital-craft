-- =========================================================
-- 0028 — Loan application extras: co-applicant KYC + rooftop photo
--
-- Additive columns on epc_applications for:
--   - Co-applicant Aadhaar OCR (mirrors the applicant's aadhaar_*
--     columns from 0023, prefixed coapp_)
--   - Geo-tagged rooftop photo of the installation site (mirrors the
--     EPC geo-tagged office photo pattern — GPS lat/lng/captured_at
--     in a jsonb blob alongside the storage path)
--
-- All nullable, no backfill.
--
-- The bank_email column from 0025 is INTENTIONALLY KEPT — the UI
-- stops surfacing it (per spec) but the column stays so existing rows
-- aren't broken and no data is lost.
-- =========================================================


-- ── Co-applicant Aadhaar (KYC parity with applicant) ─────────
-- number_masked stores "xxxxxxxx####" — same privacy rule as
-- applicant's aadhaar_number_masked. Server rejects unmasked values.
alter table epc_applications
  add column if not exists coapp_aadhaar_name           text,
  add column if not exists coapp_aadhaar_dob            text,
  add column if not exists coapp_aadhaar_gender         text,
  add column if not exists coapp_aadhaar_number_masked  text,
  add column if not exists coapp_aadhaar_care_of        text,
  add column if not exists coapp_aadhaar_address        text,
  add column if not exists coapp_aadhaar_front_path     text,
  add column if not exists coapp_aadhaar_back_path      text,
  add column if not exists coapp_aadhaar_face_path      text;


-- ── Rooftop photo (geo-tagged installation-site verification) ──
-- rooftop_photo_gps is a jsonb blob:
--   { "lat": 26.912, "lng": 75.787, "captured_at": "2026-07-08T..." }
-- Written by the same GeoOfficeUpload / FileUpload GPS pipeline the
-- EPC onboarding uses for office photos.
alter table epc_applications
  add column if not exists rooftop_photo_path        text,
  add column if not exists rooftop_photo_uploaded_at timestamptz,
  add column if not exists rooftop_photo_gps         jsonb;


-- =========================================================
-- Rollback:
--   alter table epc_applications drop column if exists rooftop_photo_gps;
--   alter table epc_applications drop column if exists rooftop_photo_uploaded_at;
--   alter table epc_applications drop column if exists rooftop_photo_path;
--   alter table epc_applications drop column if exists coapp_aadhaar_face_path;
--   alter table epc_applications drop column if exists coapp_aadhaar_back_path;
--   alter table epc_applications drop column if exists coapp_aadhaar_front_path;
--   alter table epc_applications drop column if exists coapp_aadhaar_address;
--   alter table epc_applications drop column if exists coapp_aadhaar_care_of;
--   alter table epc_applications drop column if exists coapp_aadhaar_number_masked;
--   alter table epc_applications drop column if exists coapp_aadhaar_gender;
--   alter table epc_applications drop column if exists coapp_aadhaar_dob;
--   alter table epc_applications drop column if exists coapp_aadhaar_name;
-- =========================================================
