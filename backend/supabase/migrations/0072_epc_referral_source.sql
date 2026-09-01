-- =========================================================
-- 0072 — EPC referral source ("How did you know about us?")
--
-- Captured on the last onboarding page. A fixed dropdown plus a free-text
-- box when "Others" is chosen. Additive, nullable — legacy EPCs stay NULL.
--
-- Rollback:
--   alter table epc_business drop column if exists referral_source;
--   alter table epc_business drop column if exists referral_source_other;
-- =========================================================

alter table epc_business add column if not exists referral_source       text;
alter table epc_business add column if not exists referral_source_other  text;
