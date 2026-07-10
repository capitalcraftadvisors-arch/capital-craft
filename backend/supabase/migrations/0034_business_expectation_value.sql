-- =========================================================
-- 0034 — Business Expectation: numeric value alongside the unit
--
-- The admin-only "Business Expectation" field was scale-only
-- (business_expectation = 'crores' | 'lakhs', added in 0032). This
-- adds the actual NUMBER so the field reads like "5 Crores".
--
--   business_expectation        text   — unit ('crores' | 'lakhs')  [0032]
--   business_expectation_value  numeric — the number (this migration)
--
-- Additive and nullable — no backfill, no impact on existing rows or
-- the EPC's own views (the EPC client never reads these columns).
--
-- Rollback:
--   alter table epc_business drop column if exists business_expectation_value;
-- =========================================================

alter table epc_business
  add column if not exists business_expectation_value numeric(12,2);
