-- =========================================================
-- 0023 — Loan application Step 2 (KYC verification)
--
-- Aadhaar OCR fields on epc_applications. All nullable and no
-- backfill (Step 2 collects them; existing rows stay NULL until
-- their EPC-in-charge walks through Step 2).
--
-- SECURITY / PRIVACY:
--   - `aadhaar_number_masked` stores the OCR'd Aadhaar number with
--     the first 8 digits replaced by 'x'. Example: xxxxxxxx3232.
--     The full 12-digit number is NEVER persisted in this schema or
--     any log — it exists only transiently in memory during the OCR
--     call, and is masked before insertion by the API route.
--   - `aadhaar_front_path` and `aadhaar_back_path` point to the
--     compressed uploads in capitalcraft-docs GCS bucket. The
--     underlying files may contain the visible full number; that
--     lives in the storage-layer document, not in the DB row.
--   - `aadhaar_face_path` is the cropped face image (when a face
--     was detected on the front). May be NULL if the front was a
--     PDF, or Vision found no face.
--
-- All fields are text (or timestamptz for the timestamp). We stay
-- text rather than DATE for aadhaar_dob because Aadhaar cards print
-- dates in multiple formats (DD/MM/YYYY, YYYY, "Year of Birth: 1990"),
-- and forcing an early parse loses information.
--
-- Rollback:
--   alter table epc_applications drop column if exists kyc_extracted_at;
--   alter table epc_applications drop column if exists aadhaar_face_path;
--   alter table epc_applications drop column if exists aadhaar_back_path;
--   alter table epc_applications drop column if exists aadhaar_front_path;
--   alter table epc_applications drop column if exists aadhaar_address;
--   alter table epc_applications drop column if exists aadhaar_care_of;
--   alter table epc_applications drop column if exists aadhaar_number_masked;
--   alter table epc_applications drop column if exists aadhaar_gender;
--   alter table epc_applications drop column if exists aadhaar_dob;
--   alter table epc_applications drop column if exists aadhaar_name;
-- =========================================================

alter table epc_applications
  add column if not exists aadhaar_name           text,
  add column if not exists aadhaar_dob            text,
  add column if not exists aadhaar_gender         text,
  add column if not exists aadhaar_number_masked  text,
  add column if not exists aadhaar_care_of        text,
  add column if not exists aadhaar_address        text,
  add column if not exists aadhaar_front_path     text,
  add column if not exists aadhaar_back_path      text,
  add column if not exists aadhaar_face_path      text,
  add column if not exists kyc_extracted_at       timestamptz;
