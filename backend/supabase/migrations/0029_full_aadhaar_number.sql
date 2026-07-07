-- =========================================================
-- 0029 — Store the FULL Aadhaar number (applicant + co-applicant)
--
-- Product decision: KYC requires the full 12-digit Aadhaar number,
-- not just the masked form. The masked columns from 0023/0028 are
-- KEPT and continue to be populated (derived server-side from the
-- full number) — anything display-facing can keep using masked.
--
-- Access control: epc_applications is admin-only via RLS (0002).
--
-- Rollback:
--   alter table epc_applications drop column if exists coapp_aadhaar_number;
--   alter table epc_applications drop column if exists aadhaar_number;
-- =========================================================

alter table epc_applications
  add column if not exists aadhaar_number        text,
  add column if not exists coapp_aadhaar_number  text;
