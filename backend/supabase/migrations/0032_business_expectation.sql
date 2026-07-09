-- =========================================================
-- 0032 — Business Expectation (admin-only field on the EPC profile)
--
-- Scale-only dropdown ('crores' | 'lakhs') shown in the admin-only
-- "EPC business info" section of the EPC Edit Profile page. Additive
-- and nullable — no backfill, no impact on existing rows or the EPC's
-- own views (the EPC client never reads this column).
--
-- Rollback:
--   alter table epc_business drop column if exists business_expectation;
-- =========================================================

alter table epc_business
  add column if not exists business_expectation text
    check (business_expectation is null or business_expectation in ('crores', 'lakhs'));
